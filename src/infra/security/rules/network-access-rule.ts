/**
 * Network Access Policy Rule.
 *
 * Denies outbound network requests unless explicitly enabled in PermissionContext.
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

export class NetworkAccessRule implements PolicyRule {
  public readonly id = 'rule-network-access';
  public readonly name = 'Network Access Control';
  public readonly description =
    'Controls outbound network access based on permission context settings.';

  async evaluate(action: PolicyAction, context?: PermissionContext): Promise<PolicyDecision> {
    const categories = action.categories ?? RiskClassifier.classify(action);
    const permContext = context ?? DEFAULT_PERMISSION_CONTEXT;
    const now = new Date();

    const actionType = String(action.type ?? '').toLowerCase();
    const actionResource = String(action.resource ?? '').toLowerCase();

    const isNetwork =
      categories.includes(ActionRiskCategory.NETWORK) ||
      actionType.includes('network') ||
      actionType.includes('http') ||
      actionResource.startsWith('http://') ||
      actionResource.startsWith('https://');

    if (isNetwork && !permContext.networkAccess) {
      return {
        decision: PolicyDecisionType.DENY,
        reason: 'Outbound network access is disabled in current permission context.',
        ruleId: this.id,
        evaluatedAt: now,
        action,
      };
    }

    return {
      decision: PolicyDecisionType.ALLOW,
      reason: 'Network access permitted or non-network action.',
      ruleId: this.id,
      evaluatedAt: now,
      action,
    };
  }
}
