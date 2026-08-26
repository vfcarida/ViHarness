/**
 * Agent Client Protocol (ACP) Request Handlers.
 *
 * Implements session management, agent turn execution, cancellation, event derivation,
 * and idle synchronization for headless and CI workflows.
 */
import type {
  AcpNewSessionParams,
  AcpNewSessionResult,
  AcpSendMessageParams,
  AcpSendMessageResult,
  AcpSessionStatusParams,
  AcpSessionStatusResult,
  AcpCancelSessionParams,
  AcpCancelSessionResult,
  AcpSessionHistoryParams,
  AcpSessionHistoryResult,
  AcpAgentIdleParams,
  AcpAgentIdleResult,
  AcpAgentStatus,
} from './acp-types.js';
import type { AgentRuntime } from '../../core/interfaces/agent-runtime.js';
import type { IdFactory } from '../../core/types/identifiers.js';
import type { Clock } from '../../core/interfaces/clock.js';
import { DefaultSession } from '../../core/session/session.js';
import type { Goal } from '../../core/model/goal.js';
import { GoalStatus, DEFAULT_GOAL_CONSTRAINTS } from '../../core/model/goal.js';
import type { ExecutionId } from '../../core/types/identifiers.js';

interface AcpSessionRecord {
  readonly sessionId: string;
  readonly session: DefaultSession;
  status: AcpAgentStatus;
  phase?: string;
  activeExecutionId?: ExecutionId;
  totalTokens: number;
  totalCostDollars: number;
  iterationCount: number;
  goal?: Goal;
  readonly idleWaiters: Array<(status: AcpAgentStatus) => void>;
}

export interface AcpHandlerOptions {
  readonly runtime: AgentRuntime;
  readonly idFactory: IdFactory;
  readonly clock: Clock;
}

export class AcpHandlers {
  private readonly runtime: AgentRuntime;
  private readonly idFactory: IdFactory;
  private readonly clock: Clock;
  private readonly sessions = new Map<string, AcpSessionRecord>();

  constructor(options: AcpHandlerOptions) {
    this.runtime = options.runtime;
    this.idFactory = options.idFactory;
    this.clock = options.clock;
  }

  async handleNewSession(params?: AcpNewSessionParams): Promise<AcpNewSessionResult> {
    const sessionId = this.idFactory.create<'Session'>();
    const session = new DefaultSession({
      header: {
        id: sessionId,
        version: 1,
        createdAt: this.clock.now().getTime(),
      },
      idFactory: this.idFactory,
      clock: this.clock,
    });

    const record: AcpSessionRecord = {
      sessionId,
      session,
      status: 'IDLE',
      totalTokens: 0,
      totalCostDollars: 0,
      iterationCount: 0,
      idleWaiters: [],
    };

    this.sessions.set(sessionId, record);

    if (params?.goalDescription) {
      const now = new Date();
      record.goal = {
        id: this.idFactory.create<'Goal'>(),
        description: params.goalDescription,
        status: GoalStatus.ACTIVE,
        createdAt: now,
        updatedAt: now,
        constraints: { ...DEFAULT_GOAL_CONSTRAINTS, maxIterations: 25, requireVerification: false },
        metadata: {},
      };
    }

    return { sessionId };
  }

  async handleSendMessage(params: AcpSendMessageParams): Promise<AcpSendMessageResult> {
    const record = this.sessions.get(params.sessionId);
    if (!record) {
      throw new Error(`ACP Session not found: ${params.sessionId}`);
    }

    const messageId = this.idFactory.create<'Evidence'>();
    record.session.append('user_message', {
      content: params.message,
    });

    // Prepare Goal
    if (!record.goal) {
      const now = new Date();
      record.goal = {
        id: this.idFactory.create<'Goal'>(),
        description: params.message,
        status: GoalStatus.ACTIVE,
        createdAt: now,
        updatedAt: now,
        constraints: { ...DEFAULT_GOAL_CONSTRAINTS, maxIterations: 25, requireVerification: false },
        metadata: {},
      };
    }

    record.status = 'RUNNING';

    try {
      const result = await this.runtime.execute(record.goal, {
        ...(params.options ?? {}),
      });

      record.activeExecutionId = result.executionId;
      record.totalTokens += result.totalTokens;
      record.totalCostDollars += result.totalCostDollars;
      record.iterationCount += result.iterationCount;
      record.status = result.success ? 'COMPLETED' : 'FAILED';

      record.session.append('agent_message', {
        content: result.summary,
      });

      this.notifyIdleWaiters(record);

      return {
        messageId,
        executionId: result.executionId,
        success: result.success,
        summary: result.summary,
      };
    } catch (err: any) {
      record.status = 'FAILED';
      this.notifyIdleWaiters(record);
      throw err;
    }
  }

  async handleSessionStatus(params: AcpSessionStatusParams): Promise<AcpSessionStatusResult> {
    const record = this.sessions.get(params.sessionId);
    if (!record) {
      throw new Error(`ACP Session not found: ${params.sessionId}`);
    }

    return {
      sessionId: record.sessionId,
      status: record.status,
      phase: record.phase,
      iterationCount: record.iterationCount,
      totalTokens: record.totalTokens,
      totalCostDollars: Number(record.totalCostDollars.toFixed(4)),
      activeExecutionId: record.activeExecutionId,
    };
  }

  async handleCancelSession(params: AcpCancelSessionParams): Promise<AcpCancelSessionResult> {
    const record = this.sessions.get(params.sessionId);
    if (!record) {
      throw new Error(`ACP Session not found: ${params.sessionId}`);
    }

    if (record.activeExecutionId && record.status === 'RUNNING') {
      try {
        await (this.runtime as any).cancel?.(
          record.activeExecutionId,
          params.reason ?? 'Cancelled via ACP',
        );
      } catch {
        // Ignore cancellation error
      }
    }

    record.status = 'CANCELLED';

    record.session.append('custom', {
      type: 'session_cancelled',
      payload: { reason: params.reason },
    });

    this.notifyIdleWaiters(record);
    return { sessionId: record.sessionId, cancelled: true };
  }

  async handleSessionHistory(params: AcpSessionHistoryParams): Promise<AcpSessionHistoryResult> {
    const record = this.sessions.get(params.sessionId);
    if (!record) {
      throw new Error(`ACP Session not found: ${params.sessionId}`);
    }

    return {
      sessionId: record.sessionId,
      events: record.session.log,
    };
  }

  async handleAgentIdle(params: AcpAgentIdleParams): Promise<AcpAgentIdleResult> {
    const record = this.sessions.get(params.sessionId);
    if (!record) {
      throw new Error(`ACP Session not found: ${params.sessionId}`);
    }

    if (record.status !== 'RUNNING') {
      return {
        sessionId: record.sessionId,
        idle: true,
        status: record.status,
      };
    }

    const timeoutMs = params.timeoutMs ?? 30000;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          sessionId: record.sessionId,
          idle: record.status !== 'RUNNING',
          status: record.status,
        });
      }, timeoutMs);

      record.idleWaiters.push((status) => {
        clearTimeout(timer);
        resolve({
          sessionId: record.sessionId,
          idle: true,
          status,
        });
      });
    });
  }

  private notifyIdleWaiters(record: AcpSessionRecord): void {
    while (record.idleWaiters.length > 0) {
      const waiter = record.idleWaiters.shift();
      if (waiter) waiter(record.status);
    }
  }
}
