/**
 * Hardened Credential Protection Policy Rule.
 *
 * Denies any action attempting to access, modify, or exfiltrate secrets, .env files,
 * private SSH keys, AWS credentials, or API tokens.
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

const SECRET_CONTENT_PATTERNS = [
  /-----BEGIN\s+(RSA\s+|OPENSSH\s+|EC\s+|DSA\s+)?PRIVATE\s+KEY-----/i,
  /sk-[a-zA-Z0-9\-_]{16,}/i, // OpenAI / API Keys
  /ghp_[a-zA-Z0-9]{30,}/i, // GitHub Personal Access Tokens
  /AKIA[0-9A-Z]{16}/i, // AWS Access Key IDs
  /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/i, // Bearer Tokens
];

export class CredentialProtectionRule implements PolicyRule {
  public readonly id = 'rule-credential-protection';
  public readonly name = 'Credential Protection';
  public readonly description =
    'Denies access to secret files, .env configurations, private keys, and credential stores.';

  async evaluate(action: PolicyAction, context?: PermissionContext): Promise<PolicyDecision> {
    const categories = action.categories ?? RiskClassifier.classify(action);
    const permContext = context ?? DEFAULT_PERMISSION_CONTEXT;
    const now = new Date();

    const isCredentialCategory = categories.includes(ActionRiskCategory.CREDENTIALS);
    const resourceLower = (action.resource ?? '').toLowerCase();

    // 1. Check Resource File Path Patterns
    const matchesForbiddenPath = permContext.forbiddenPaths.some((pattern) => {
      const cleanPattern = pattern.replace(/\*\*/g, '').replace(/\*/g, '').toLowerCase();
      return cleanPattern.length > 0 && resourceLower.includes(cleanPattern);
    });

    if (isCredentialCategory || matchesForbiddenPath) {
      return {
        decision: PolicyDecisionType.DENY,
        reason: `Denied access to sensitive credential or secret resource: ${action.resource}`,
        ruleId: this.id,
        evaluatedAt: now,
        action,
      };
    }

    // 2. Check Action Parameter Contents for Exfiltrated Secret Tokens
    const paramsString = JSON.stringify(action.metadata ?? {});
    for (const secretPattern of SECRET_CONTENT_PATTERNS) {
      if (secretPattern.test(paramsString) || secretPattern.test(action.resource)) {
        return {
          decision: PolicyDecisionType.DENY,
          reason: `Secret token pattern detected in action payload or resource: ${action.resource}`,
          ruleId: this.id,
          evaluatedAt: now,
          action,
        };
      }
    }

    return {
      decision: PolicyDecisionType.ALLOW,
      reason: 'No credential protection violation detected.',
      ruleId: this.id,
      evaluatedAt: now,
      action,
    };
  }
}
