/**
 * Contradictory Evidence Resolver & Safeguard.
 *
 * Detects contradictory verification evidence (e.g. unit tests PASSing while
 * static analysis or verification checks FAIL) and forces human escalation to prevent false completion.
 */
import type { Evidence } from '../../core/model/evidence.js';
import { EvidenceOutcome, EvidenceType } from '../../core/model/evidence.js';

export interface ContradictionResolution {
  readonly hasContradiction: boolean;
  readonly conflictingEvidence: ReadonlyArray<Evidence>;
  readonly rationale?: string;
  readonly requiresEscalation: boolean;
}

export class ContradictoryEvidenceResolver {
  /**
   * Evaluate a collection of task evidence for internal contradictions.
   */
  static evaluate(evidenceList: ReadonlyArray<Evidence>): ContradictionResolution {
    const passes = evidenceList.filter(
      (e) => e.outcome === EvidenceOutcome.PASS || e.pass === true,
    );
    const fails = evidenceList.filter(
      (e) =>
        e.outcome === EvidenceOutcome.FAIL ||
        e.outcome === EvidenceOutcome.REGRESSION ||
        e.pass === false,
    );

    // Contradiction Case 1: Unit tests PASS but Static Analysis or Verification FAILS for the target
    const verificationFails = fails.filter(
      (e) => e.type === EvidenceType.LINT_RESULT || e.type === EvidenceType.VERIFICATION,
    );

    if (passes.length > 0 && verificationFails.length > 0) {
      return {
        hasContradiction: true,
        conflictingEvidence: [...passes, ...verificationFails],
        rationale:
          'Contradictory evidence detected: functional unit tests pass, but static analysis or verification checks failed.',
        requiresEscalation: true,
      };
    }

    // Contradiction Case 2: Same checkId reported both PASS and FAIL within recent window
    const checkStatusMap = new Map<string, Set<EvidenceOutcome>>();
    for (const ev of evidenceList) {
      if (ev.checkId) {
        const existing = checkStatusMap.get(ev.checkId) ?? new Set();
        existing.add(ev.outcome);
        checkStatusMap.set(ev.checkId, existing);
      }
    }

    for (const [checkId, outcomes] of checkStatusMap.entries()) {
      if (outcomes.has(EvidenceOutcome.PASS) && outcomes.has(EvidenceOutcome.FAIL)) {
        const conflicting = evidenceList.filter((e) => e.checkId === checkId);
        return {
          hasContradiction: true,
          conflictingEvidence: conflicting,
          rationale: `Contradictory outcomes reported for check [${checkId}]: contains both PASS and FAIL results.`,
          requiresEscalation: true,
        };
      }
    }

    return {
      hasContradiction: false,
      conflictingEvidence: [],
      requiresEscalation: false,
    };
  }
}
