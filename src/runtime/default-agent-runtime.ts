/**
 * Default Stateful Agent Runtime.
 *
 * Implements AgentRuntime interface:
 * "The agent is not a persistent conversation. The agent is a stateful,
 * evidence-driven state machine."
 *
 * Features:
 * - Iterative non-recursive execution loop (`while` loop with safety bounds)
 * - Durable state & checkpoint saving/restoration
 * - Subscription hub for observable runtime events
 * - Support for pause, resume from checkpoint, cancellation, human escalation
 */
import type { AgentRuntime, AgentObserver } from '../core/interfaces/agent-runtime.js';
import type { IdFactory, ExecutionId, CheckpointId } from '../core/types/identifiers.js';
import type { Clock } from '../core/interfaces/clock.js';
import type { ModelRouter } from '../core/interfaces/model-router.js';
import type { ContextCompiler } from '../core/interfaces/context-compiler.js';
import type { PolicyEngine } from '../core/interfaces/policy-engine.js';
import type { ToolExecutor } from '../core/interfaces/tool-executor.js';
import type { VerificationEngine } from '../core/interfaces/verification-engine.js';
import type { EvidenceStore } from '../core/interfaces/evidence-store.js';
import type { CheckpointStore } from '../core/interfaces/checkpoint-store.js';
import type { Goal } from '../core/model/goal.js';
import type { Task } from '../core/model/task.js';
import { TaskStatus } from '../core/model/task.js';
import { StateMachine } from '../core/state-machine/state-machine.js';
import { AgentPhase } from '../core/model/state.js';
import type {
  ExecutionOptions,
  ExecutionResult,
  AgentExecutionStatus,
  IterationRecord,
} from '../core/model/runtime-types.js';
import { AgentEventType } from '../core/model/runtime-types.js';

import { AgentObserverHub } from './agent-observer.js';
import { IterationExecutor } from './iteration-executor.js';
import { HarnessError } from '../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../core/errors/error-codes.js';
import { TerminationReason } from '../core/model/termination.js';

import type { MemoryStore } from '../core/interfaces/memory-store.js';
import type { SkillRegistry, SelfModification } from '../core/interfaces/skill-registry.js';
import { FrozenMemorySnapshot } from '../infra/memory/frozen-memory-snapshot.js';
import { SkillExtractor } from '../infra/memory/skill-extractor.js';
import { SkillCurator } from '../infra/memory/skill-curator.js';

import type { ExperienceStore } from '../infra/telemetry/experience-store.js';
import { HarnessDiagnosticEngine } from '../infra/telemetry/harness-diagnostic-engine.js';
import { HarnessAutoTuner } from '../infra/telemetry/harness-auto-tuner.js';
import type { Logger } from '../core/interfaces/logger.js';
import { ConsoleLogger } from '../infra/logging/console-logger.js';

export interface DefaultAgentRuntimeOptions {
  readonly router: ModelRouter;
  readonly compiler: ContextCompiler;
  readonly logger?: Logger;
  readonly policyEngine?: PolicyEngine;
  readonly toolExecutor?: ToolExecutor;
  readonly verificationEngine?: VerificationEngine;
  readonly evidenceStore?: EvidenceStore;
  readonly checkpointStore?: CheckpointStore;
  readonly memoryStore?: MemoryStore;
  readonly skillRegistry?: SkillRegistry;
  readonly skillExtractor?: SkillExtractor;
  readonly skillCurator?: SkillCurator;
  readonly experienceStore?: ExperienceStore;
  readonly idFactory: IdFactory;
  readonly clock: Clock;
}

interface ActiveExecution {
  readonly executionId: ExecutionId;
  readonly goal: Goal;
  readonly task: Task;
  stateMachine: StateMachine;
  readonly startTimeMs: number;
  readonly observerHub: AgentObserverHub;
  status: AgentExecutionStatus;
  iterations: IterationRecord[];
  totalCostDollars: number;
  totalTokens: number;
  abortController: AbortController;
  latestCheckpointId?: CheckpointId;
}

export class DefaultAgentRuntime implements AgentRuntime {
  private readonly router: ModelRouter;
  private readonly compiler: ContextCompiler;
  private readonly policyEngine?: PolicyEngine;
  private readonly toolExecutor?: ToolExecutor;
  private readonly verificationEngine?: VerificationEngine;
  private readonly evidenceStore?: EvidenceStore;
  private readonly checkpointStore?: CheckpointStore;
  private readonly memoryStore?: MemoryStore;
  private readonly skillRegistry?: SkillRegistry;
  private readonly skillExtractor?: SkillExtractor;
  private readonly skillCurator?: SkillCurator;
  private readonly experienceStore?: ExperienceStore;
  private readonly idFactory: IdFactory;
  private readonly clock: Clock;
  private readonly logger: Logger;

  private readonly globalObserverHub = new AgentObserverHub();
  private readonly activeExecutions = new Map<ExecutionId, ActiveExecution>();

  constructor(options: DefaultAgentRuntimeOptions) {
    this.router = options.router;
    this.compiler = options.compiler;
    this.logger = options.logger ?? new ConsoleLogger();
    this.policyEngine = options.policyEngine;
    this.toolExecutor = options.toolExecutor;
    this.verificationEngine = options.verificationEngine;
    this.evidenceStore = options.evidenceStore;
    this.checkpointStore = options.checkpointStore;
    this.memoryStore = options.memoryStore;
    this.skillRegistry = options.skillRegistry;
    this.skillExtractor = options.skillExtractor;
    this.skillCurator = options.skillCurator;
    this.experienceStore = options.experienceStore;
    this.idFactory = options.idFactory;
    this.clock = options.clock;
  }

  subscribe(observer: AgentObserver): () => void {
    return this.globalObserverHub.subscribe(observer);
  }

  async execute(goal: Goal, options?: ExecutionOptions): Promise<ExecutionResult> {
    const executionId = this.idFactory.create<'Execution'>();
    const taskId = this.idFactory.create<'Task'>();

    const task: Task = {
      id: taskId,
      goalId: goal.id,
      description: goal.description,
      status: TaskStatus.ACTIVE,
      priority: 1,
      createdAt: this.clock.now(),
      updatedAt: this.clock.now(),
      metadata: {},
    };

    const stateMachine = new StateMachine({
      taskId,
      idFactory: this.idFactory,
      clock: this.clock,
    });

    const execution: ActiveExecution = {
      executionId,
      goal,
      task,
      stateMachine,
      startTimeMs: this.clock.now().getTime(),
      observerHub: this.globalObserverHub,
      status: 'RUNNING',
      iterations: [],
      totalCostDollars: 0,
      totalTokens: 0,
      abortController: new AbortController(),
    };

    this.activeExecutions.set(executionId, execution);

    this.globalObserverHub.emit({
      type: AgentEventType.AgentStarted,
      executionId,
      taskId,
      timestamp: this.clock.now(),
      data: { goalId: goal.id, description: goal.description },
    });

    // Capture frozen memory snapshot ONCE at execution start (Hermes)
    let frozenMemoryObjects = options?.frozenMemoryObjects;
    if (!frozenMemoryObjects && this.memoryStore && options?.useFrozenMemorySnapshot !== false) {
      try {
        const snapshotManager = new FrozenMemorySnapshot({
          memoryStore: this.memoryStore,
          idFactory: this.idFactory,
          clock: this.clock,
        });
        frozenMemoryObjects = await snapshotManager.capture({
          taskDescription: task.description,
          goalDescription: goal.description,
        });
      } catch {
        // Fallback gracefully
      }
    }

    const skillRegistry = options?.skillRegistry ?? this.skillRegistry;
    const selfModification =
      options?.selfModification ??
      (skillRegistry && 'mountSkill' in skillRegistry
        ? (skillRegistry as unknown as SelfModification)
        : undefined);

    const mergedOptions: ExecutionOptions = {
      ...options,
      frozenMemoryObjects,
      skillRegistry,
      selfModification,
    };

    const result = await this.runLoop(execution, mergedOptions);

    // Background self-improvement: extract learned pattern skills on completion (Hermes)
    if (result.success && result.status === 'COMPLETED') {
      const extractor =
        this.skillExtractor ??
        (this.memoryStore
          ? new SkillExtractor({
              memoryStore: this.memoryStore,
              idFactory: this.idFactory,
              clock: this.clock,
            })
          : undefined);

      if (extractor) {
        try {
          await extractor.extractFromExecution(result, task.description, goal.description);
        } catch (err: any) {
          this.logger.error(`Skill extraction error: ${err?.message ?? String(err)}`);
        }
      }

      if (this.skillCurator) {
        try {
          await this.skillCurator.advanceIterationCounter(result.iterationCount);
          await this.skillCurator.curate();
        } catch {
          // Curator is best-effort background work
        }
      }
    }

    // Outer-Loop Experience Store: Accumulate traces across runs (Meta-Harness Pattern)
    const expStore = options?.experienceStore ?? this.experienceStore;
    if (expStore) {
      try {
        await expStore.recordRun({
          runId: execution.executionId,
          goalId: goal.id,
          taskId: task.id,
          goalDescription: goal.description,
          executionResult: result,
          harnessConfig: {
            architectMode: options?.architectMode,
            maxAutoCorrectionsPerFile: options?.maxAutoCorrectionsPerFile,
            autoLintAfterWrite: options?.autoLintAfterWrite,
            autoTestAfterWrite: options?.autoTestAfterWrite,
            preserveUserChanges: options?.preserveUserChanges,
          },
        });

        // If autoTune enabled, formulate and apply high-confidence recommendations
        if (options?.autoTune) {
          const recentTraces = await expStore.getRecentTraces(5);
          const crossReport = HarnessDiagnosticEngine.analyzeAcrossRuns(recentTraces);
          if (crossReport.recommendations.length > 0) {
            await HarnessAutoTuner.applyRecommendations({}, crossReport.recommendations, {
              experienceStore: expStore,
              idFactory: this.idFactory,
            });
          }
        }
      } catch {
        // Experience store accumulation is best-effort outer loop
      }
    }

    return result;
  }

  async pause(executionId: ExecutionId): Promise<void> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      throw new HarnessError({
        code: ErrorCode.STATE_INVALID_TRANSITION,
        category: ErrorCategory.STATE,
        message: `Active execution not found for pause: ${executionId}`,
      });
    }

    execution.status = 'PAUSED';
    execution.abortController.abort();

    // Save Checkpoint if CheckpointStore is available
    if (this.checkpointStore) {
      const checkpoint = await this.checkpointStore.create(execution.stateMachine.state, 'paused');
      execution.latestCheckpointId = checkpoint.id;
    }

    this.globalObserverHub.emit({
      type: AgentEventType.AgentPaused,
      executionId,
      taskId: execution.task.id,
      timestamp: this.clock.now(),
      data: { checkpointId: execution.latestCheckpointId },
    });
  }

  async resume(executionId: ExecutionId, options?: ExecutionOptions): Promise<ExecutionResult> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      throw new HarnessError({
        code: ErrorCode.STATE_INVALID_TRANSITION,
        category: ErrorCategory.STATE,
        message: `Execution not found to resume: ${executionId}`,
      });
    }

    // Restore from Checkpoint if requested
    if (options?.checkpointId && this.checkpointStore) {
      const restoredState = await this.checkpointStore.restore(options.checkpointId);
      if (restoredState) {
        const restoredMachine = new StateMachine({
          taskId: restoredState.taskId,
          idFactory: this.idFactory,
          clock: this.clock,
          initialPhase: restoredState.phase,
        });
        execution.stateMachine = restoredMachine;
      }
    }

    execution.status = 'RUNNING';
    execution.abortController = new AbortController();

    this.globalObserverHub.emit({
      type: AgentEventType.AgentResumed,
      executionId,
      taskId: execution.task.id,
      timestamp: this.clock.now(),
      data: {},
    });

    return this.runLoop(execution, options);
  }

  async cancel(executionId: ExecutionId, reason?: string): Promise<void> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      throw new HarnessError({
        code: ErrorCode.STATE_INVALID_TRANSITION,
        category: ErrorCategory.STATE,
        message: `Execution not found to cancel: ${executionId}`,
      });
    }

    execution.status = 'CANCELLED';
    execution.abortController.abort();

    this.globalObserverHub.emit({
      type: AgentEventType.AgentCancelled,
      executionId,
      taskId: execution.task.id,
      timestamp: this.clock.now(),
      data: { reason: reason ?? 'User cancelled execution' },
    });
  }

  async abort(executionId: ExecutionId): Promise<void> {
    return this.cancel(executionId);
  }

  private async runLoop(
    execution: ActiveExecution,
    options?: ExecutionOptions,
  ): Promise<ExecutionResult> {
    const { executionId, goal, task, stateMachine, observerHub } = execution;

    while (
      execution.status === 'RUNNING' &&
      !stateMachine.isTerminal &&
      (stateMachine.phase as AgentPhase) !== AgentPhase.DONE
    ) {
      if (execution.abortController.signal.aborted || options?.signal?.aborted) {
        execution.status = 'CANCELLED';
        break;
      }

      try {
        const iterationRecord = await IterationExecutor.executeIteration({
          executionId,
          goal,
          task,
          stateMachine,
          router: this.router,
          compiler: this.compiler,
          policyEngine: this.policyEngine,
          toolExecutor: options?.toolExecutor ?? this.toolExecutor,
          verificationEngine: this.verificationEngine,
          evidenceStore: this.evidenceStore,
          observerHub,
          idFactory: this.idFactory,
          clock: this.clock,
          options,
          iterationsSoFar: execution.iterations,
          startTimeMs: execution.startTimeMs,
          totalCostDollars: execution.totalCostDollars,
        });

        execution.iterations.push(iterationRecord);
        execution.totalCostDollars += iterationRecord.costDollars;
        execution.totalTokens +=
          iterationRecord.tokenUsage.inputTokens + iterationRecord.tokenUsage.outputTokens;

        // Save automatic checkpoint if CheckpointStore is provided
        if (this.checkpointStore && iterationRecord.sequenceNumber % 5 === 0) {
          const cp = await this.checkpointStore.create(
            stateMachine.state,
            `auto-checkpoint-iter-${iterationRecord.sequenceNumber}`,
          );
          execution.latestCheckpointId = cp.id;
        }

        // Handle termination decision
        if (
          iterationRecord.terminationDecision.terminal ||
          (stateMachine.phase as AgentPhase) === AgentPhase.DONE
        ) {
          if (
            iterationRecord.terminationDecision.reason === TerminationReason.SUCCESS ||
            (stateMachine.phase as AgentPhase) === AgentPhase.DONE
          ) {
            execution.status = 'COMPLETED';
          } else if (iterationRecord.terminationDecision.humanRequired) {
            execution.status = 'AWAITING_HUMAN';
          } else {
            execution.status = 'FAILED';
          }
          break;
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? (err.stack ?? err.message) : String(err);
        this.logger.error(`RunLoop caught error: ${errorMessage}`);
        observerHub.emit({
          type: AgentEventType.AgentFailed,
          executionId,
          taskId: execution.task.id,
          timestamp: this.clock.now(),
          data: { error: errorMessage, phase: stateMachine.phase },
        });
        execution.status = 'FAILED';
        break;
      }
    }

    const durationMs = this.clock.now().getTime() - execution.startTimeMs;
    const success = execution.status === 'COMPLETED';

    const summary = success
      ? `Goal completed successfully in ${execution.iterations.length} iterations.`
      : `Execution terminated with status ${execution.status}. Phase: ${stateMachine.phase}.`;

    const finalEventType = success
      ? AgentEventType.AgentCompleted
      : execution.status === 'CANCELLED'
        ? AgentEventType.AgentCancelled
        : AgentEventType.AgentFailed;

    observerHub.emit({
      type: finalEventType,
      executionId,
      taskId: execution.task.id,
      timestamp: this.clock.now(),
      data: {
        status: execution.status,
        phase: stateMachine.phase,
        totalCostDollars: execution.totalCostDollars,
        totalTokens: execution.totalTokens,
        iterationsCount: execution.iterations.length,
      },
    });

    return {
      executionId,
      taskId: execution.task.id,
      goalId: goal.id,
      success,
      status: execution.status,
      iterationCount: execution.iterations.length,
      totalCostDollars: execution.totalCostDollars,
      totalTokens: execution.totalTokens,
      durationMs,
      iterations: execution.iterations,
      summary,
    };
  }
}
