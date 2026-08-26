/**
 * Default Escalation Manager.
 *
 * Implements EscalationManager interface:
 * "Human decisions must become durable state/evidence.
 * A human decision must never be represented only as transient prompt text."
 *
 * Supports escalation creation, approval/rejection/modification/cancellation resolution,
 * expiration handling, policy enforcement, and audit trail retrieval.
 */
import type {
  EscalationManager,
  EscalationResolution,
} from '../../core/interfaces/escalation-manager.js';
import type { EvidenceStore } from '../../core/interfaces/evidence-store.js';
import type { IdFactory, EscalationId, TaskId } from '../../core/types/identifiers.js';
import type { Clock } from '../../core/interfaces/clock.js';
import type {
  EscalationRequest,
  CreateEscalationParams,
  HumanDecisionRecord,
  ApprovalPolicy,
} from '../../core/model/escalation.js';
import { EscalationReason, EscalationStatus, HumanDecision } from '../../core/model/escalation.js';
import type { Evidence } from '../../core/model/evidence.js';
import { EvidenceOutcome, EvidenceType } from '../../core/model/evidence.js';
import { ActionRiskCategory } from '../../core/model/policy.js';
import { HarnessError } from '../../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../core/errors/error-codes.js';

export interface DefaultEscalationManagerOptions {
  readonly idFactory: IdFactory;
  readonly clock: Clock;
  readonly evidenceStore?: EvidenceStore;
}

export class DefaultEscalationManager implements EscalationManager {
  private readonly requests = new Map<EscalationId, EscalationRequest>();
  private readonly auditTrail = new Map<TaskId, HumanDecisionRecord[]>();
  private readonly idFactory: IdFactory;
  private readonly clock: Clock;
  private readonly evidenceStore?: EvidenceStore;

  constructor(options: DefaultEscalationManagerOptions) {
    this.idFactory = options.idFactory;
    this.clock = options.clock;
    this.evidenceStore = options.evidenceStore;
  }

  async requestEscalation(params: CreateEscalationParams): Promise<EscalationRequest> {
    const now = this.clock.now();
    const id = params.id ?? this.idFactory.create<'Escalation'>();
    const ttl = params.ttlMs ?? 300000; // 5 minute default TTL

    const request: EscalationRequest = {
      id,
      taskId: params.taskId,
      reason: params.reason,
      status: EscalationStatus.PENDING,
      summary: params.summary,
      context: params.context ?? {},
      evidence: params.evidence ?? [],
      proposedAction: params.proposedAction,
      risk: params.risk ?? ActionRiskCategory.EXECUTE,
      alternatives: params.alternatives ?? [],
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttl),
    };

    this.requests.set(id, request);
    return request;
  }

  async resolveEscalation(
    escalationId: EscalationId,
    decisionInput: Omit<HumanDecisionRecord, 'escalationId' | 'decidedAt'>,
  ): Promise<EscalationResolution> {
    const req = this.requests.get(escalationId);
    if (!req) {
      throw new HarnessError({
        code: ErrorCode.STATE_INVALID_TRANSITION,
        category: ErrorCategory.STATE,
        message: `Escalation request not found: ${escalationId}`,
      });
    }

    // Check expiration first
    await this.checkExpiration(escalationId);
    const updatedReq = this.requests.get(escalationId)!;

    if (updatedReq.status === EscalationStatus.EXPIRED) {
      throw new HarnessError({
        code: ErrorCode.STATE_INVALID_TRANSITION,
        category: ErrorCategory.STATE,
        message: `Cannot resolve expired escalation request: ${escalationId}`,
      });
    }

    const now = this.clock.now();
    const record: HumanDecisionRecord = {
      escalationId,
      taskId: req.taskId,
      decision: decisionInput.decision,
      decidedBy: decisionInput.decidedBy,
      decidedAt: now,
      modifiedAction: decisionInput.modifiedAction,
      rationale: decisionInput.rationale,
    };

    // Update request status to RESOLVED
    const resolvedRequest: EscalationRequest = {
      ...req,
      status: EscalationStatus.RESOLVED,
    };
    this.requests.set(escalationId, resolvedRequest);

    // Save to audit trail
    const trail = this.auditTrail.get(req.taskId) ?? [];
    trail.push(record);
    this.auditTrail.set(req.taskId, trail);

    // Persist as durable Evidence in EvidenceStore
    if (this.evidenceStore) {
      const outcome =
        decisionInput.decision === HumanDecision.APPROVE
          ? EvidenceOutcome.PASS
          : decisionInput.decision === HumanDecision.REJECT
            ? EvidenceOutcome.FAIL
            : EvidenceOutcome.WARNING;

      const evidenceRecord: Evidence = {
        id: this.idFactory.create<'Evidence'>(),
        taskId: req.taskId,
        type: EvidenceType.HUMAN_FEEDBACK,
        outcome,
        summary: `Human Decision [${decisionInput.decision}] by ${decisionInput.decidedBy} for escalation [${req.reason}]`,
        data: {
          escalationId,
          decision: decisionInput.decision,
          rationale: decisionInput.rationale,
          modifiedAction: decisionInput.modifiedAction,
        },
        createdAt: now,
        pass: decisionInput.decision === HumanDecision.APPROVE,
        confidence: 1.0,
        affectedFiles: [],
      };

      await this.evidenceStore.record(evidenceRecord);
    }

    return {
      request: resolvedRequest,
      record,
    };
  }

  async getPendingEscalation(id: EscalationId): Promise<EscalationRequest | undefined> {
    await this.checkExpiration(id);
    const req = this.requests.get(id);
    return req?.status === EscalationStatus.PENDING ? req : undefined;
  }

  async listPending(taskId: TaskId): Promise<ReadonlyArray<EscalationRequest>> {
    const pending: EscalationRequest[] = [];

    for (const [id, req] of this.requests.entries()) {
      if (req.taskId === taskId) {
        await this.checkExpiration(id);
        const current = this.requests.get(id)!;
        if (current.status === EscalationStatus.PENDING) {
          pending.push(current);
        }
      }
    }
    return pending;
  }

  async checkExpiration(id: EscalationId): Promise<boolean> {
    const req = this.requests.get(id);
    if (!req || req.status !== EscalationStatus.PENDING) {
      return false;
    }

    const now = this.clock.now();
    if (req.expiresAt && now.getTime() >= req.expiresAt.getTime()) {
      const expiredReq: EscalationRequest = {
        ...req,
        status: EscalationStatus.EXPIRED,
      };
      this.requests.set(id, expiredReq);
      return true;
    }
    return false;
  }

  async getAuditTrail(taskId: TaskId): Promise<ReadonlyArray<HumanDecisionRecord>> {
    return this.auditTrail.get(taskId) ?? [];
  }

  requiresApproval(reason: string | any, policy?: ApprovalPolicy): boolean {
    if (!policy) {
      // Default: HIGH_RISK, IRREVERSIBLE_ACTION, and POLICY_REQUIREMENT require approval
      const reasonStr = String(reason);
      return (
        reasonStr === EscalationReason.HIGH_RISK ||
        reasonStr === EscalationReason.IRREVERSIBLE_ACTION ||
        reasonStr === EscalationReason.POLICY_REQUIREMENT ||
        reasonStr === ActionRiskCategory.DESTRUCTIVE ||
        reasonStr === ActionRiskCategory.PRODUCTION_IMPACTING
      );
    }

    const reasonMatch = policy.requiredReasons.includes(reason as EscalationReason);
    const riskMatch = policy.autoEscalateOnRisk.includes(reason as ActionRiskCategory);
    return reasonMatch || riskMatch;
  }
}
