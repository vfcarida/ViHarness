/**
 * Command Restriction Policy Rule.
 *
 * Denies forbidden shell commands and unsafe execution vectors.
 */
import type { PolicyRule } from '../../../core/interfaces/policy-engine.js';
import type {
  PolicyAction,
  PolicyDecision,
  PermissionContext,
} from '../../../core/model/policy.js';
import { PolicyDecisionType, DEFAULT_PERMISSION_CONTEXT } from '../../../core/model/policy.js';
import { CommandSanitizer } from '../../tools/command-sanitizer.js';

export class CommandRestrictionRule implements PolicyRule {
  public readonly id = 'rule-command-restriction';
  public readonly name = 'Command Restriction';
  public readonly description =
    'Blocks forbidden shell commands and unsafe process execution vectors.';

  async evaluate(action: PolicyAction, context?: PermissionContext): Promise<PolicyDecision> {
    const permContext = context ?? DEFAULT_PERMISSION_CONTEXT;
    const now = new Date();
    const actionType = String(action.type ?? '').toLowerCase();

    const isExec =
      actionType.includes('exec') ||
      actionType.includes('cmd') ||
      actionType.includes('shell') ||
      actionType.includes('run');

    if (!isExec) {
      return {
        decision: PolicyDecisionType.ALLOW,
        reason: 'Action is not a shell command execution.',
        ruleId: this.id,
        evaluatedAt: now,
        action,
      };
    }

    const command = action.resource ?? '';

    // Command Sanitizer evaluation
    const sanitization = CommandSanitizer.sanitize(command);
    if (!sanitization.allowed) {
      return {
        decision: PolicyDecisionType.DENY,
        reason: `Command rejected by policy sanitizer: ${sanitization.reason}`,
        ruleId: this.id,
        evaluatedAt: now,
        action,
      };
    }

    // Check context forbiddenCommands list
    const cmdLower = sanitization.normalizedCommand.toLowerCase();
    for (const forbidden of permContext.forbiddenCommands) {
      if (cmdLower.includes(forbidden.toLowerCase())) {
        return {
          decision: PolicyDecisionType.DENY,
          reason: `Forbidden command pattern detected: ${forbidden}`,
          ruleId: this.id,
          evaluatedAt: now,
          action,
        };
      }
    }

    return {
      decision: PolicyDecisionType.ALLOW,
      reason: 'Command is permitted under policy controls.',
      ruleId: this.id,
      evaluatedAt: now,
      action,
    };
  }
}
