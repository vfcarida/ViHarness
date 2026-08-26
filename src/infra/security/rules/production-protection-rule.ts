/**
 * Production Protection Policy Rule.
 *
 * Requires human approval or denies actions targeting production environments
 * or tagged as PRODUCTION_IMPACTING.
 */
import type { PolicyRule } from '../../../core/interfaces/policy-engine.js';
import type {
  PolicyAction,
  PolicyDecision,
  PermissionContext,
} from '../../../core/model/policy.js';
import {
  PolicyDecisionType,
  ActionRiskCategory,
  DEFAULT_PERMISSION_CONTEXT,
} from '../../../core/model/policy.js';
import { RiskClassifier } from '../risk-classifier.js';

export class ProductionProtectionRule implements PolicyRule {
  public readonly id = 'rule-production-protection';
  public readonly name = 'Production Environment Protection';
  public readonly description =
    'Requires explicit human approval for actions in production environments or production-impacting changes.';

  async evaluate(action: PolicyAction, context?: PermissionContext): Promise<PolicyDecision> {
    const categories = action.categories ?? RiskClassifier.classify(action);
    const permContext = context ?? DEFAULT_PERMISSION_CONTEXT;
    const now = new Date();

    const isProdEnv = permContext.environment === 'PRODUCTION';
    const isProdImpact = categories.includes(ActionRiskCategory.PRODUCTION_IMPACTING);

    if ((isProdEnv || isProdImpact) && !permContext.userApproved) {
      return {
        decision: PolicyDecisionType.REQUIRE_APPROVAL,
        reason:
          'Action targets production environment or contains production-impacting changes; human approval required.',
        ruleId: this.id,
        evaluatedAt: now,
        action,
      };
    }

    return {
      decision: PolicyDecisionType.ALLOW,
      reason: 'No production protection violation detected.',
      ruleId: this.id,
      evaluatedAt: now,
      action,
    };
  }
}
