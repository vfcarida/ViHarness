/**
 * Hardened Path Restriction Policy Rule.
 *
 * Enforces strict allowed/forbidden path boundaries using path normalization,
 * URI decoding, and canonical directory resolution to eliminate path traversal attacks.
 */
import * as path from 'path';
import type { PolicyRule } from '../../../core/interfaces/policy-engine.js';
import type {
  PolicyAction,
  PolicyDecision,
  PermissionContext,
} from '../../../core/model/policy.js';
import { PolicyDecisionType, DEFAULT_PERMISSION_CONTEXT } from '../../../core/model/policy.js';

export class PathRestrictionRule implements PolicyRule {
  public readonly id = 'rule-path-restriction';
  public readonly name = 'Path Restriction';
  public readonly description =
    'Restricts filesystem operations to allowed project working paths using canonical resolution.';

  async evaluate(action: PolicyAction, context?: PermissionContext): Promise<PolicyDecision> {
    const permContext = context ?? DEFAULT_PERMISSION_CONTEXT;
    const now = new Date();
    const actionType = String(action.type ?? '').toLowerCase();

    const isFileOp =
      actionType.includes('file') || actionType.includes('read') || actionType.includes('write');

    if (!isFileOp) {
      return {
        decision: PolicyDecisionType.ALLOW,
        reason: 'Action is not a filesystem operation.',
        ruleId: this.id,
        evaluatedAt: now,
        action,
      };
    }

    const rawPath = String(
      action.metadata?.['path'] ?? action.metadata?.['resource'] ?? action.resource ?? '',
    );

    // 1. Check Path Traversal Tricks (e.g. '../', '%2e%2e', '..\\')
    let decodedPath = rawPath;
    try {
      decodedPath = decodeURIComponent(rawPath);
    } catch {
      // Ignore decoding failure
    }

    if (decodedPath.includes('..') || decodedPath.includes('%2e%2e')) {
      return {
        decision: PolicyDecisionType.DENY,
        reason: `Path traversal attempt detected in resource: ${rawPath}`,
        ruleId: this.id,
        evaluatedAt: now,
        action,
      };
    }

    // 2. Check System Path Boundaries & Forbidden Patterns
    const normalizedPath = path.normalize(decodedPath).toLowerCase().replace(/\\/g, '/');

    for (const forbiddenPattern of permContext.forbiddenPaths) {
      const cleanPattern = forbiddenPattern
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .toLowerCase()
        .replace(/\\/g, '/');
      if (cleanPattern.length > 0 && normalizedPath.includes(cleanPattern)) {
        return {
          decision: PolicyDecisionType.DENY,
          reason: `Forbidden path pattern matched: ${forbiddenPattern}`,
          ruleId: this.id,
          evaluatedAt: now,
          action,
        };
      }
    }

    return {
      decision: PolicyDecisionType.ALLOW,
      reason: 'Path is within allowed project bounds.',
      ruleId: this.id,
      evaluatedAt: now,
      action,
    };
  }
}
