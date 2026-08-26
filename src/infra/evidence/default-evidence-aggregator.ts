/**
 * Default Evidence Aggregator.
 *
 * Implements EvidenceAggregator:
 * - Aggregates task evidence
 * - Detects regressions against baselines (unrelated test failure when target passes)
 * - Evaluates completion against explicit AcceptancePolicy criteria
 */
import type { EvidenceAggregator } from '../../core/interfaces/evidence-aggregator.js';
import type { EvidenceStore } from '../../core/interfaces/evidence-store.js';
import type { TaskId } from '../../core/types/identifiers.js';
import type { Evidence } from '../../core/model/evidence.js';
import { EvidenceOutcome } from '../../core/model/evidence.js';
import type { AcceptancePolicy, AcceptanceEvaluation } from '../../core/model/acceptance-policy.js';
import { DEFAULT_ACCEPTANCE_POLICY } from '../../core/model/acceptance-policy.js';

export class DefaultEvidenceAggregator implements EvidenceAggregator {
  async aggregate(taskId: TaskId, store: EvidenceStore): Promise<ReadonlyArray<Evidence>> {
    return store.listForTask(taskId);
  }

  detectRegressions(
    _taskId: TaskId,
    currentEvidence: ReadonlyArray<Evidence>,
    baselineEvidence: ReadonlyArray<Evidence>,
  ): ReadonlyArray<Evidence> {
    const regressions: Evidence[] = [];

    // Map baseline checkId -> baseline evidence
    const baselineMap = new Map<string, Evidence>();
    for (const base of baselineEvidence) {
      if (base.checkId && base.outcome === EvidenceOutcome.PASS) {
        baselineMap.set(base.checkId, base);
      }
    }

    for (const current of currentEvidence) {
      if (current.checkId && baselineMap.has(current.checkId)) {
        if (
          current.outcome === EvidenceOutcome.FAIL ||
          current.outcome === EvidenceOutcome.REGRESSION
        ) {
          regressions.push({
            ...current,
            outcome: EvidenceOutcome.REGRESSION,
            summary: `Regression detected on check [${current.checkId}]: passed in baseline, failing now.`,
          });
        }
      }
    }

    return regressions;
  }

  evaluateAcceptance(
    _taskId: TaskId,
    evidenceList: ReadonlyArray<Evidence>,
    policy: AcceptancePolicy = DEFAULT_ACCEPTANCE_POLICY,
  ): AcceptanceEvaluation {
    const missingRequirements: string[] = [];
    const regressionsDetected: Evidence[] = [];
    const warnings: string[] = [];

    // 1. Incomplete verification check
    if (evidenceList.length === 0) {
      missingRequirements.push('No verification evidence recorded for task.');
    }

    // 2. Check outcomes
    const passedCheckIds = new Set<string>();
    const minConfidence = policy.minConfidence ?? 0.8;

    for (const ev of evidenceList) {
      if (ev.outcome === EvidenceOutcome.REGRESSION) {
        regressionsDetected.push(ev);
      } else if (ev.outcome === EvidenceOutcome.FAIL) {
        missingRequirements.push(`Failed verification check: ${ev.summary}`);
      } else if (ev.outcome === EvidenceOutcome.WARNING) {
        warnings.push(ev.summary);
        if (policy.allowWarnings === false) {
          missingRequirements.push(`Warning not permitted by acceptance policy: ${ev.summary}`);
        }
      } else if (ev.outcome === EvidenceOutcome.INCONCLUSIVE) {
        missingRequirements.push(`Inconclusive verification result: ${ev.summary}`);
      }

      if (ev.confidence < minConfidence) {
        missingRequirements.push(
          `Evidence confidence (${ev.confidence.toFixed(2)}) below required threshold (${minConfidence.toFixed(2)}) for ${ev.summary}`,
        );
      }

      if (ev.outcome === EvidenceOutcome.PASS && ev.checkId) {
        passedCheckIds.add(ev.checkId);
      }
    }

    // 3. Required Checks enforcement
    if (policy.requiredChecks && policy.requiredChecks.length > 0) {
      for (const requiredCheck of policy.requiredChecks) {
        if (!passedCheckIds.has(requiredCheck)) {
          missingRequirements.push(`Required check [${requiredCheck}] missing or not passed.`);
        }
      }
    }

    // 4. Regression check
    if (policy.zeroRegressionsRequired && regressionsDetected.length > 0) {
      missingRequirements.push(
        `Zero regressions required, but ${regressionsDetected.length} regression(s) detected.`,
      );
    }

    const satisfied = missingRequirements.length === 0 && regressionsDetected.length === 0;

    return {
      satisfied,
      missingRequirements,
      regressionsDetected,
      warnings,
    };
  }
}
