/**
 * Reliability Engineering Fault Injector.
 *
 * Simulates 16 failure modes at system boundaries to validate runtime recovery,
 * state persistence, escalation triggers, and terminal state invariants.
 */
import { HarnessError } from '../../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../core/errors/error-codes.js';

export enum FaultMode {
  MODEL_TIMEOUT = 'MODEL_TIMEOUT',
  PROVIDER_OUTAGE = 'PROVIDER_OUTAGE',
  RATE_LIMITING = 'RATE_LIMITING',
  MALFORMED_MODEL_RESPONSE = 'MALFORMED_MODEL_RESPONSE',
  TOOL_TIMEOUT = 'TOOL_TIMEOUT',
  TOOL_CRASH = 'TOOL_CRASH',
  VERIFIER_CRASH = 'VERIFIER_CRASH',
  CORRUPTED_STATE = 'CORRUPTED_STATE',
  PROCESS_CRASH = 'PROCESS_CRASH',
  DISK_FAILURE_SIMULATION = 'DISK_FAILURE_SIMULATION',
  INTERRUPTED_CHECKPOINT = 'INTERRUPTED_CHECKPOINT',
  INTERRUPTED_ROLLBACK = 'INTERRUPTED_ROLLBACK',
  REPEATED_TEST_FAILURE = 'REPEATED_TEST_FAILURE',
  CONTRADICTORY_EVIDENCE = 'CONTRADICTORY_EVIDENCE',
  SUBAGENT_TIMEOUT = 'SUBAGENT_TIMEOUT',
  CONTEXT_COMPILER_FAILURE = 'CONTEXT_COMPILER_FAILURE',
}

export class FaultInjector {
  private activeFaults = new Set<FaultMode>();

  enableFault(fault: FaultMode): void {
    this.activeFaults.add(fault);
  }

  disableFault(fault: FaultMode): void {
    this.activeFaults.delete(fault);
  }

  clearAll(): void {
    this.activeFaults.clear();
  }

  isFaultActive(fault: FaultMode): boolean {
    return this.activeFaults.has(fault);
  }

  maybeTrigger(fault: FaultMode): void {
    if (!this.activeFaults.has(fault)) return;

    switch (fault) {
      case FaultMode.MODEL_TIMEOUT:
        throw new HarnessError({
          code: ErrorCode.MODEL_TIMEOUT,
          category: ErrorCategory.MODEL,
          message: 'Simulated Model Execution Timeout (408)',
        });
      case FaultMode.PROVIDER_OUTAGE:
        throw new HarnessError({
          code: ErrorCode.MODEL_UNAVAILABLE,
          category: ErrorCategory.MODEL,
          message: 'Simulated LLM Provider Outage (503)',
        });
      case FaultMode.RATE_LIMITING:
        throw new HarnessError({
          code: ErrorCode.MODEL_RATE_LIMITED,
          category: ErrorCategory.MODEL,
          message: 'Simulated Rate Limit Exceeded (429)',
        });
      case FaultMode.MALFORMED_MODEL_RESPONSE:
        throw new HarnessError({
          code: ErrorCode.MODEL_INVALID_RESPONSE,
          category: ErrorCategory.MODEL,
          message: 'Simulated Malformed JSON Model Output',
        });
      case FaultMode.TOOL_TIMEOUT:
        throw new HarnessError({
          code: ErrorCode.TOOL_TIMEOUT,
          category: ErrorCategory.TOOL,
          message: 'Simulated Tool Execution Timeout',
        });
      case FaultMode.TOOL_CRASH:
        throw new HarnessError({
          code: ErrorCode.TOOL_EXECUTION_FAILED,
          category: ErrorCategory.TOOL,
          message: 'Simulated Native Tool Process Crash (SIGSEGV)',
        });
      case FaultMode.VERIFIER_CRASH:
        throw new HarnessError({
          code: ErrorCode.VERIFICATION_FAILED,
          category: ErrorCategory.VERIFICATION,
          message: 'Simulated Verification Engine Internal Exception',
        });
      case FaultMode.CORRUPTED_STATE:
        throw new HarnessError({
          code: ErrorCode.STATE_CORRUPTED,
          category: ErrorCategory.STATE,
          message: 'Simulated Corrupted Agent State Snapshot',
        });
      case FaultMode.DISK_FAILURE_SIMULATION:
        throw new HarnessError({
          code: ErrorCode.RUNTIME_EXECUTION_FAILED,
          category: ErrorCategory.RUNTIME,
          message: 'Simulated Disk I/O Write Failure (ENOSPC)',
        });
      case FaultMode.INTERRUPTED_CHECKPOINT:
        throw new HarnessError({
          code: ErrorCode.RUNTIME_EXECUTION_FAILED,
          category: ErrorCategory.RUNTIME,
          message: 'Simulated Interrupted Checkpoint Commit',
        });
      case FaultMode.INTERRUPTED_ROLLBACK:
        throw new HarnessError({
          code: ErrorCode.RUNTIME_EXECUTION_FAILED,
          category: ErrorCategory.RUNTIME,
          message: 'Simulated Interrupted Rollback Operation',
        });
      case FaultMode.SUBAGENT_TIMEOUT:
        throw new HarnessError({
          code: ErrorCode.RUNTIME_EXECUTION_FAILED,
          category: ErrorCategory.RUNTIME,
          message: 'Simulated Subagent Execution Timeout',
        });
      case FaultMode.CONTEXT_COMPILER_FAILURE:
        throw new HarnessError({
          code: ErrorCode.CONTEXT_COMPILATION_FAILED,
          category: ErrorCategory.CONTEXT,
          message: 'Simulated Context Compiler Budget Failure',
        });
      default:
        throw new HarnessError({
          code: ErrorCode.RUNTIME_EXECUTION_FAILED,
          category: ErrorCategory.RUNTIME,
          message: `Simulated Fault Triggered: ${fault}`,
        });
    }
  }
}
