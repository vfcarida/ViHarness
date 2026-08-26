/**
 * Acceptance Policy Evaluator.
 *
 * "The agent cannot declare success — DONE requires explicit acceptance evaluation."
 *
 * Evaluates whether a task's verification evidence, policy record, and regression history
 * satisfy the task's AcceptancePolicy.
 */
import type { AcceptancePolicy, AcceptanceEvaluation } from '../../core/model/acceptance-policy.js';
import type { Evidence } from '../../core/model/evidence.js';
import type { Regression } from '../../core/model/regression.js';
import type { PolicyDecision } from '../../core/model/policy.js';
import { PolicyDecisionType } from '../../core/model/policy.js';

export class AcceptanceEvaluator {
  /**
   * Evaluate whether current evidence and system state satisfy the AcceptancePolicy.
   */
  static evaluate(params: {
    policy: AcceptancePolicy;
    evidence: ReadonlyArray<Evidence>;
    regressions?: ReadonlyArray<Regression>;
    policyDecisions?: ReadonlyArray<PolicyDecision>;
  }): AcceptanceEvaluation {
    const { policy, evidence, regressions = [], policyDecisions = [] } = params;
    const missingRequirements: string[] = [];
    const regressionsDetected: Evidence[] = [];
    const warnings: string[] = [];

    // 1. Required Checks Check
    if (policy.requiredChecks && policy.requiredChecks.length > 0) {
      for (const requiredCheck of policy.requiredChecks) {
        const checkEv = evidence.find(
          (e) => (e.checkId === requiredCheck || e.data?.['checkId'] === requiredCheck) && e.pass,
        );
        if (!checkEv) {
          missingRequirements.push(`Required check [${requiredCheck}] has not passed`);
        }
      }
    }

    // 2. Zero Regressions Check
    if (policy.zeroRegressionsRequired && regressions.length > 0) {
      missingRequirements.push(
        `Zero regressions required, but ${regressions.length} regression(s) detected`,
      );
      for (const reg of regressions) {
        const failEv = evidence.find((e) => e.id === reg.currentFailEvidenceId);
        if (failEv) regressionsDetected.push(failEv);
      }
    }

    // 3. Unresolved Policy Violations Check
    const unresolvedPolicy = policyDecisions.filter(
      (d) =>
        d.decision === PolicyDecisionType.DENY ||
        d.decision === PolicyDecisionType.REQUIRE_APPROVAL,
    );
    if (unresolvedPolicy.length > 0) {
      missingRequirements.push(
        `Task has ${unresolvedPolicy.length} unresolved policy violation(s) or pending approval(s)`,
      );
    }

    // 4. Confidence Threshold Check
    const passEvidence = evidence.filter((e) => e.pass);
    if (passEvidence.length === 0) {
      missingRequirements.push('No passing verification evidence recorded');
    } else {
      const avgConfidence =
        passEvidence.reduce((acc, e) => acc + (e.confidence ?? 0.8), 0) / passEvidence.length;
      const minConfidence = policy.minConfidence ?? 0.8;
      if (avgConfidence < minConfidence) {
        missingRequirements.push(
          `Evidence confidence (${avgConfidence.toFixed(2)}) below required threshold (${minConfidence})`,
        );
      }
    }

    const satisfied = missingRequirements.length === 0;

    return {
      satisfied,
      missingRequirements,
      regressionsDetected,
      warnings,
    };
  }
}
