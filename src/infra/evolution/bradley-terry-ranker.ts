/**
 * Wave 6.4 — Longitudinal Tournament & Glicko-2 / Bradley-Terry Harness Ranker (`BradleyTerryHarnessRanker`).
 *
 * Maintains longitudinal rating estimates across multiple generations of evolved harnesses:
 * - Tracks skill rating $\mu_H$ (initialized at 1500) and uncertainty Rating Deviation
 *   $\text{RD}_H$ (initialized at 350, shrinking toward `minRd=30` as paired trials accumulate).
 * - Computes pairwise win probabilities under the logistic Bradley-Terry model:
 *     P(H_i > H_j) = 1 / (1 + 10^(-(mu_i - mu_j) / 400))
 * - Produces conservative lower-confidence-bound leaderboards:
 *     ConservativeRating = mu_H - 1.96 * RD_H
 * - Recommends high-value active-learning matchups (`suggestNextMatchups`) between top
 *   contenders with overlapping confidence intervals.
 */
import type { EvidenceBundle } from '../../core/evolution/hypothesis.js';

export interface HarnessRatingRecord {
  readonly manifestId: string;
  readonly ratingMu: number;
  readonly ratingDeviationRd: number;
  readonly conservativeLowerBound: number;
  readonly matchesPlayed: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly meanCostDollars: number;
}

export interface SuggestedMatchup {
  readonly manifestA: string;
  readonly manifestB: string;
  readonly winProbabilityA: number;
  readonly informationGainScore: number;
  readonly rationale: string;
}

export interface BradleyTerryRankerOptions {
  readonly initialRating?: number;
  readonly initialRd?: number;
  readonly minRd?: number;
  readonly baseKFactor?: number;
}

interface InternalRatingState {
  manifestId: string;
  mu: number;
  rd: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  totalCost: number;
}

export class BradleyTerryHarnessRanker {
  private readonly ratings = new Map<string, InternalRatingState>();
  private readonly initialRating: number;
  private readonly initialRd: number;
  private readonly minRd: number;
  private readonly baseKFactor: number;

  constructor(options?: BradleyTerryRankerOptions) {
    this.initialRating = options?.initialRating ?? 1500;
    this.initialRd = options?.initialRd ?? 350;
    this.minRd = options?.minRd ?? 30;
    this.baseKFactor = options?.baseKFactor ?? 32;
  }

  /**
   * Computes the Bradley-Terry win probability that `manifestA` outperforms `manifestB`.
   */
  predictWinProbability(manifestA: string, manifestB: string): number {
    const stateA = this.getOrCreate(manifestA);
    const stateB = this.getOrCreate(manifestB);
    const exponent = -(stateA.mu - stateB.mu) / 400;
    return Number((1 / (1 + Math.pow(10, exponent))).toFixed(4));
  }

  /**
   * Records a single head-to-head outcome (`scoreA` in [0, 1], where 1 = A wins, 0.5 = draw, 0 = B wins).
   */
  recordHeadToHead(params: {
    readonly manifestA: string;
    readonly manifestB: string;
    readonly scoreA: number; // in [0, 1]
    readonly costDollarsA?: number;
    readonly costDollarsB?: number;
  }): void {
    const stateA = this.getOrCreate(params.manifestA);
    const stateB = this.getOrCreate(params.manifestB);

    const expectedA = 1 / (1 + Math.pow(10, -(stateA.mu - stateB.mu) / 400));
    const expectedB = 1 - expectedA;
    const scoreA = Math.max(0, Math.min(1, params.scoreA));
    const scoreB = 1 - scoreA;

    // Uncertainty-scaled Glicko step: higher RD yields faster rating updates
    const scaleA = this.baseKFactor * (stateA.rd / this.initialRd + 0.5);
    const scaleB = this.baseKFactor * (stateB.rd / this.initialRd + 0.5);

    stateA.mu = Number((stateA.mu + scaleA * (scoreA - expectedA)).toFixed(2));
    stateB.mu = Number((stateB.mu + scaleB * (scoreB - expectedB)).toFixed(2));

    // Shrink Rating Deviation as empirical evidence accumulates
    stateA.rd = Number(
      Math.max(this.minRd, stateA.rd * 0.88).toFixed(2),
    );
    stateB.rd = Number(
      Math.max(this.minRd, stateB.rd * 0.88).toFixed(2),
    );

    stateA.matches += 1;
    stateB.matches += 1;
    stateA.totalCost += params.costDollarsA ?? 0;
    stateB.totalCost += params.costDollarsB ?? 0;

    if (scoreA > 0.55) {
      stateA.wins += 1;
      stateB.losses += 1;
    } else if (scoreA < 0.45) {
      stateA.losses += 1;
      stateB.wins += 1;
    } else {
      stateA.draws += 1;
      stateB.draws += 1;
    }
  }

  /**
   * Ingests all paired trials from an `EvidenceBundle` into the longitudinal tournament ratings.
   */
  recordEvidenceBundle(bundle: EvidenceBundle): void {
    const count = Math.min(
      bundle.baseTrials.length,
      bundle.candidateTrials.length,
    );
    for (let i = 0; i < count; i++) {
      const baseTrial = bundle.baseTrials[i];
      const candTrial = bundle.candidateTrials[i];
      if (!baseTrial || !candTrial) continue;
      if (baseTrial.infrastructureError || candTrial.infrastructureError) {
        continue;
      }

      const diff = candTrial.partialScore - baseTrial.partialScore;
      let scoreCand = 0.5;
      if (diff > 0.05) {
        scoreCand = 1.0;
      } else if (diff < -0.05) {
        scoreCand = 0.0;
      } else if (candTrial.costDollars < baseTrial.costDollars * 0.85) {
        scoreCand = 0.65; // Tie-breaker bonus for significantly lower cost
      }

      this.recordHeadToHead({
        manifestA: String(bundle.candidateManifestId),
        manifestB: String(bundle.baseManifestId),
        scoreA: scoreCand,
        costDollarsA: candTrial.costDollars,
        costDollarsB: baseTrial.costDollars,
      });
    }
  }

  /**
   * Returns the longitudinal leaderboard sorted by conservative lower bound ($\mu - 1.96 \cdot \text{RD}$).
   */
  getLeaderboard(): ReadonlyArray<HarnessRatingRecord> {
    const records: HarnessRatingRecord[] = Array.from(this.ratings.values()).map(
      (s) => ({
        manifestId: s.manifestId,
        ratingMu: s.mu,
        ratingDeviationRd: s.rd,
        conservativeLowerBound: Number((s.mu - 1.96 * s.rd).toFixed(2)),
        matchesPlayed: s.matches,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        meanCostDollars:
          s.matches > 0 ? Number((s.totalCost / s.matches).toFixed(4)) : 0,
      }),
    );

    records.sort((a, b) => b.conservativeLowerBound - a.conservativeLowerBound);
    return records;
  }

  /**
   * Recommends the top active-learning matchups among registered harnesses that maximize
   * expected information gain (close win probability near 0.5 + high combined RD uncertainty).
   */
  suggestNextMatchups(maxSuggestions = 3): ReadonlyArray<SuggestedMatchup> {
    const list = Array.from(this.ratings.values());
    const suggestions: SuggestedMatchup[] = [];

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        const p = this.predictWinProbability(a.manifestId, b.manifestId);
        // Binary entropy of outcome * combined RD uncertainty
        const competitiveness = 4 * p * (1 - p); // peaks at 1.0 when p = 0.5
        const combinedUncertainty = (a.rd + b.rd) / (2 * this.initialRd);
        const infoGain = Number(
          (competitiveness * 0.65 + combinedUncertainty * 0.35).toFixed(4),
        );

        suggestions.push({
          manifestA: a.manifestId,
          manifestB: b.manifestId,
          winProbabilityA: p,
          informationGainScore: infoGain,
          rationale: `High-information matchup: P(${a.manifestId} > ${b.manifestId})=${(p * 100).toFixed(1)}%, combined RD=(${a.rd}, ${b.rd}).`,
        });
      }
    }

    suggestions.sort((a, b) => b.informationGainScore - a.informationGainScore);
    return suggestions.slice(0, maxSuggestions);
  }

  private getOrCreate(manifestId: string): InternalRatingState {
    const existing = this.ratings.get(manifestId);
    if (existing) return existing;
    const created: InternalRatingState = {
      manifestId,
      mu: this.initialRating,
      rd: this.initialRd,
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      totalCost: 0,
    };
    this.ratings.set(manifestId, created);
    return created;
  }
}
