/**
 * EscalationManager Interface.
 *
 * Manages human escalation requests and durable decision recording.
 * "Human decisions must become durable state/evidence.
 * A human decision must never be represented only as transient prompt text."
 */
import type { EscalationId, TaskId } from '../types/identifiers.js';
import type {
  EscalationRequest,
  CreateEscalationParams,
  HumanDecisionRecord,
  ApprovalPolicy,
} from '../model/escalation.js';

export interface EscalationResolution {
  readonly request: EscalationRequest;
  readonly record: HumanDecisionRecord;
}

export interface EscalationManager {
  /** Create a new human escalation request. */
  requestEscalation(params: CreateEscalationParams): Promise<EscalationRequest>;

  /** Record a durable human decision resolving an escalation. */
  resolveEscalation(
    escalationId: EscalationId,
    decisionRecord: Omit<HumanDecisionRecord, 'escalationId' | 'decidedAt'>,
  ): Promise<EscalationResolution>;

  /** Fetch pending escalation by ID. */
  getPendingEscalation(id: EscalationId): Promise<EscalationRequest | undefined>;

  /** List pending escalations for a task. */
  listPending(taskId: TaskId): Promise<ReadonlyArray<EscalationRequest>>;

  /** Check and expire an escalation request if TTL has elapsed. */
  checkExpiration(id: EscalationId): Promise<boolean>;

  /** Get complete audit trail of human decision records for a task. */
  getAuditTrail(taskId: TaskId): Promise<ReadonlyArray<HumanDecisionRecord>>;

  /** Evaluate whether an action/reason requires human approval per ApprovalPolicy. */
  requiresApproval(reason: string | any, policy?: ApprovalPolicy): boolean;
}
