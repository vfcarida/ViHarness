/**
 * Multi-Rollout Best-of-N Candidate Selector.
 *
 * Evaluates candidate rollouts from parallel or exploratory trajectories and selects
 * the winning solution based on a multi-objective scoring function:
 * 1. Test / Reproducer pass rate (primary weight)
 * 2. Execution success status
 * 3. Strict compiler compliance (penalty for compiler warnings)
 * 4. Patch churn penalty (penalizes excessive or unnecessary file rewrites)
 * 5. Efficiency tie-breakers (latency & token consumption)
 */

export interface RolloutCandidate {
  readonly rolloutId: string;
  readonly workspacePath: string;
  readonly patch: string;
  readonly success: boolean;
  readonly testPassRate: number; // 0.0 - 1.0
  readonly compilerWarningsCount: number;
  readonly linesChanged: number;
  readonly durationMs: number;
  readonly totalTokens?: number;
  readonly costDollars?: number;
}

export interface CandidateEvaluation {
  readonly candidate: RolloutCandidate;
  readonly compositeScore: number;
  readonly rationale: string;
}

export interface RolloutSelectionResult {
  readonly winner: RolloutCandidate;
  readonly ranking: ReadonlyArray<CandidateEvaluation>;
}

export class RolloutSelector {
  /**
   * Evaluates all candidates and returns the best rollout with full ranking rationale.
   */
  static selectBestRollout(
    candidates: ReadonlyArray<RolloutCandidate>,
  ): RolloutSelectionResult | null {
    if (!candidates || candidates.length === 0) {
      return null;
    }

    const evaluations: CandidateEvaluation[] = candidates.map((candidate) => {
      let score = 0;
      const rationaleParts: string[] = [];

      // 1. Test pass rate (0 to 100 points)
      const testScore = Math.max(0, Math.min(1, candidate.testPassRate)) * 100;
      score += testScore;
      rationaleParts.push(`Tests: +${testScore.toFixed(1)}pts (${(candidate.testPassRate * 100).toFixed(1)}%)`);

      // 2. Success bonus (+20 points)
      if (candidate.success) {
        score += 20;
        rationaleParts.push('Success: +20pts');
      }

      // 3. Compiler warnings penalty (-5 pts per warning, capped at -30 pts)
      const warningPenalty = Math.min(30, candidate.compilerWarningsCount * 5);
      if (warningPenalty > 0) {
        score -= warningPenalty;
        rationaleParts.push(`Warnings: -${warningPenalty}pts (${candidate.compilerWarningsCount} warnings)`);
      }

      // 4. Code churn penalty (-0.1 pts per line changed, capped at -25 pts)
      const churnPenalty = Math.min(25, candidate.linesChanged * 0.1);
      if (churnPenalty > 0) {
        score -= churnPenalty;
        rationaleParts.push(`Churn: -${churnPenalty.toFixed(1)}pts (${candidate.linesChanged} lines)`);
      }

      // 5. Token efficiency tie-breaker (minor penalty for excessive token usage)
      if (candidate.totalTokens && candidate.totalTokens > 50000) {
        const tokenPenalty = Math.min(10, ((candidate.totalTokens - 50000) / 10000) * 0.5);
        score -= tokenPenalty;
        rationaleParts.push(`Tokens: -${tokenPenalty.toFixed(1)}pts`);
      }

      return {
        candidate,
        compositeScore: Number(score.toFixed(2)),
        rationale: rationaleParts.join(', '),
      };
    });

    // Sort descending by composite score, then by durationMs ascending
    evaluations.sort((a, b) => {
      if (b.compositeScore !== a.compositeScore) {
        return b.compositeScore - a.compositeScore;
      }
      return a.candidate.durationMs - b.candidate.durationMs;
    });

    return {
      winner: evaluations[0]!.candidate,
      ranking: evaluations,
    };
  }
}
