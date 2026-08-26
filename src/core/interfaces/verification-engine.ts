/**
 * VerificationEngine interface.
 *
 * Verifies artifacts and execution targets using verification checks & suites.
 * "Tests generate evidence" — verification outputs feed the evidence store.
 */
import type { TaskId } from '../types/identifiers.js';
import type {
  VerificationResult,
  VerificationSuite,
  VerificationProfile,
} from '../model/verification.js';

export interface VerificationTarget {
  /** Type of artifact/target to verify (e.g. 'file', 'test-suite', 'build', 'security'). */
  readonly type: string;

  /** Optional path to target file or module. */
  readonly path?: string;

  /** Optional inline content. */
  readonly content?: string;

  /** Task ID for correlation. */
  readonly taskId?: TaskId;

  /** Metadata for strategy execution. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface VerificationEngine {
  /** Verify a target with optional profile override. */
  verify(target: VerificationTarget, profile?: VerificationProfile): Promise<VerificationResult>;

  /** Execute a full VerificationSuite for a task. */
  runSuite(suite: VerificationSuite, taskId: TaskId): Promise<VerificationResult>;
}
