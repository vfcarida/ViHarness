/**
 * Context Ranker & Invariant Enforcement.
 *
 * Calculates retention score:
 * R = w_imp * importance + w_dep * dependency + w_ver * verification + w_fail * failure + w_rec * recency - w_cost * costPenalty
 *
 * Enforces MUST-PRESERVE invariants:
 * - User instructions / requirements
 * - Security rules
 * - Architecture facts
 * - Approved constraints
 * - Known regressions
 * - Explicit human decisions
 */
import type { ContextObject } from '../../core/model/context-object.js';
import { ContextObjectType } from '../../core/model/context-object.js';
import type { CompilerScoringWeights } from '../../core/model/compiler-types.js';
import { DEFAULT_SCORING_WEIGHTS } from '../../core/model/compiler-types.js';

export interface ScoredContextObject {
  readonly object: ContextObject;
  readonly score: number;
  readonly mustPreserve: boolean;
}

export class ContextRanker {
  /**
   * Check if a context object MUST BE PRESERVED under non-negotiable architectural rules.
   */
  static isMustPreserve(obj: ContextObject): boolean {
    // 1. Core structural invariants
    if (
      obj.type === ContextObjectType.USER_INSTRUCTION ||
      obj.type === ContextObjectType.REQUIREMENT ||
      obj.type === ContextObjectType.SECURITY_RULE ||
      obj.type === ContextObjectType.ARCHITECTURE_FACT ||
      obj.type === ContextObjectType.CONSTRAINT
    ) {
      return true;
    }

    // 2. Explicit human decisions & critical architectural decisions
    if (
      obj.type === ContextObjectType.DECISION &&
      (obj.source === 'human' ||
        obj.source === 'user' ||
        obj.importance >= 0.8 ||
        obj.tags.includes('critical_decision'))
    ) {
      return true;
    }

    if (
      obj.tags.includes('regression') ||
      obj.tags.includes('must_preserve') ||
      obj.tags.includes('critical_decision') ||
      obj.tags.includes('security')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Calculate Retention Score R for a ContextObject.
   */
  static scoreObject(
    obj: ContextObject,
    nowMs: number,
    weights: CompilerScoringWeights = DEFAULT_SCORING_WEIGHTS,
  ): ScoredContextObject {
    const mustPreserve = this.isMustPreserve(obj);
    if (mustPreserve) {
      return {
        object: obj,
        score: 999.0, // Top priority
        mustPreserve: true,
      };
    }

    // 1. Dependency score
    const dependencyScore = Math.min(1.0, obj.dependencies.length * 0.25);

    // 2. Verification score
    const verificationScore = obj.lastVerified !== null ? 1.0 : 0.0;

    // 3. Failure relevance score
    const failureRelevance =
      obj.type === ContextObjectType.FAILURE || obj.type === ContextObjectType.EVIDENCE ? 0.9 : 0.2;

    // 4. Recency decay score
    const ageHours = Math.max(0, (nowMs - obj.lastUsed.getTime()) / (1000 * 60 * 60));
    const recencyScore = 1 / (1 + ageHours / 12);

    // 5. Token cost penalty
    const costPenalty = Math.min(1.0, obj.costTokens / 4000);

    // Retention Formula
    const score =
      weights.importanceWeight * obj.importance +
      weights.dependencyWeight * dependencyScore +
      weights.verificationWeight * verificationScore +
      weights.failureRelevanceWeight * failureRelevance +
      weights.recencyWeight * recencyScore -
      weights.tokenCostPenaltyWeight * costPenalty;

    return {
      object: obj,
      score,
      mustPreserve: false,
    };
  }
}
