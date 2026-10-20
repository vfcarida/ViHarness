/**
 * Behavioral Contrast Analyzer (Milestone B — Propose–Probe–Compose).
 *
 * Computes paired behavioral deltas between baseline and candidate probe runs,
 * estimates repetition variance and 95% confidence intervals, detects candidate
 * diversity collapse, and evaluates the pre-declared HarnessChangeHypothesis.
 */
import type { IdFactory, ContrastId } from '../../core/types/identifiers.js';
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';
import type { FailureSignalType } from '../../core/evolution/failure-taxonomy.js';
import type {
  EvidenceBundle,
  BehavioralContrast,
  HypothesisOutcome,
  HypothesisVerdict,
  ProbeTrialMetrics,
} from '../../core/evolution/hypothesis.js';
import type {
  BehavioralContrastAnalyzer,
  ProposedCandidate,
} from '../../core/evolution/interfaces.js';
import { StatisticalCalculator } from '../eval/statistical-calculator.js';
import { UuidV7IdFactory } from '../id/uuid-id-factory.js';

export class DefaultBehavioralContrastAnalyzer implements BehavioralContrastAnalyzer {
  private readonly idFactory: IdFactory;

  constructor(options?: { readonly idFactory?: IdFactory }) {
    this.idFactory = options?.idFactory ?? new UuidV7IdFactory();
  }

  analyze(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidate: ProposedCandidate;
    readonly evidenceBundle: EvidenceBundle;
    readonly peerContrasts?: ReadonlyArray<BehavioralContrast>;
  }): BehavioralContrast {
    const { baseManifest, candidate, evidenceBundle, peerContrasts } = params;
    const baseTrials = evidenceBundle.baseTrials;
    const candTrials = evidenceBundle.candidateTrials;

    const avg = (items: ReadonlyArray<ProbeTrialMetrics>, fn: (m: ProbeTrialMetrics) => number) =>
      items.length === 0 ? 0 : items.reduce((sum, m) => sum + fn(m), 0) / items.length;

    const basePassRate = avg(baseTrials, (m) => (m.success ? 1 : 0));
    const candPassRate = avg(candTrials, (m) => (m.success ? 1 : 0));
    const passRateDelta = Number((candPassRate - basePassRate).toFixed(4));

    const basePartial = avg(baseTrials, (m) => m.partialScore);
    const candPartial = avg(candTrials, (m) => m.partialScore);
    const partialScoreDelta = Number((candPartial - basePartial).toFixed(4));

    const baseTokens = avg(baseTrials, (m) => m.totalTokens);
    const candTokens = avg(candTrials, (m) => m.totalTokens);
    const meanTokensDelta = Math.round(candTokens - baseTokens);

    const baseCost = avg(baseTrials, (m) => m.costDollars);
    const candCost = avg(candTrials, (m) => m.costDollars);
    const meanCostDollarsDelta = Number((candCost - baseCost).toFixed(6));

    const baseLatency = avg(baseTrials, (m) => m.durationMs);
    const candLatency = avg(candTrials, (m) => m.durationMs);
    const meanLatencyMsDelta = Math.round(candLatency - baseLatency);

    const baseCache = avg(baseTrials, (m) => m.cacheHitRatio);
    const candCache = avg(candTrials, (m) => m.cacheHitRatio);
    const cacheHitRatioDelta = Number((candCache - baseCache).toFixed(4));

    const baseToolErrRate = avg(baseTrials, (m) =>
      m.toolCalls > 0 ? m.toolErrors / m.toolCalls : 0,
    );
    const candToolErrRate = avg(candTrials, (m) =>
      m.toolCalls > 0 ? m.toolErrors / m.toolCalls : 0,
    );
    const toolErrorRateDelta = Number((candToolErrRate - baseToolErrRate).toFixed(4));

    const basePolicyViolations = avg(baseTrials, (m) => m.policyViolations);
    const candPolicyViolations = avg(candTrials, (m) => m.policyViolations);
    const policyViolationDelta = Number((candPolicyViolations - basePolicyViolations).toFixed(4));

    const baseRegressions = avg(baseTrials, (m) => m.regressionsDetected);
    const candRegressions = avg(candTrials, (m) => m.regressionsDetected);
    const regressionDelta = Number((candRegressions - baseRegressions).toFixed(4));

    // Variance & 95% confidence interval across candidate trials
    const candScores = candTrials.map((m) => m.partialScore);
    const stats = StatisticalCalculator.computeDistribution(candScores);
    const candidateVariance = Number((stats.stdDev * stats.stdDev).toFixed(6));
    const margin =
      candScores.length > 1 ? 1.96 * (stats.stdDev / Math.sqrt(candScores.length)) : 0;
    const confidenceInterval95: readonly [number, number] = [
      Number((partialScoreDelta - margin).toFixed(4)),
      Number((partialScoreDelta + margin).toFixed(4)),
    ];

    // Failure signal resolution vs introduction
    const baseSignals = new Set<FailureSignalType>();
    for (const t of baseTrials) {
      for (const s of t.failureSignalsObserved) baseSignals.add(s);
    }
    const candSignals = new Set<FailureSignalType>();
    for (const t of candTrials) {
      for (const s of t.failureSignalsObserved) candSignals.add(s);
    }

    const resolvedFailureSignals = Array.from(baseSignals).filter((s) => !candSignals.has(s));
    const newlyIntroducedFailureSignals = Array.from(candSignals).filter(
      (s) => !baseSignals.has(s),
    );

    // Behavioral diversity score relative to baseline and peers
    const surfaceCount = candidate.diffFromBase.changedSurfaces.length;
    let diversityScore = Math.min(
      1.0,
      0.2 * surfaceCount +
        Math.abs(partialScoreDelta) * 1.5 +
        Math.min(0.4, Math.abs(meanTokensDelta) / 5000),
    );
    if (peerContrasts && peerContrasts.length > 0) {
      const identicalPeer = peerContrasts.some(
        (p) =>
          Math.abs(p.partialScoreDelta - partialScoreDelta) < 0.001 &&
          Math.abs(p.meanTokensDelta - meanTokensDelta) < 10,
      );
      if (identicalPeer) {
        diversityScore = Math.max(0.05, diversityScore * 0.25);
      }
    }

    // Evaluate HypothesisOutcome
    const hypothesisOutcome = this.evaluateHypothesisOutcome({
      candidate,
      evidenceBundle,
      passRateDelta,
      partialScoreDelta,
      meanTokensDelta,
      meanCostDollarsDelta,
      meanLatencyMsDelta,
      cacheHitRatioDelta,
      toolErrorRateDelta,
      regressionDelta,
      policyViolationDelta,
      newlyIntroducedFailureSignals,
    });

    const contrastId = this.idFactory.create<'Contrast'>() as ContrastId;

    return {
      id: contrastId,
      evidenceBundleId: evidenceBundle.id,
      baseManifestId: baseManifest.id,
      candidateManifestId: candidate.manifest.id,
      hypothesisId: candidate.hypothesis.id,
      passRateDelta,
      partialScoreDelta,
      meanTokensDelta,
      meanCostDollarsDelta,
      meanLatencyMsDelta,
      cacheHitRatioDelta,
      toolErrorRateDelta,
      policyViolationDelta,
      regressionDelta,
      candidateVariance,
      confidenceInterval95,
      resolvedFailureSignals,
      newlyIntroducedFailureSignals,
      behavioralDiversityScore: Number(diversityScore.toFixed(4)),
      hypothesisOutcome,
      summary:
        `Contrast [${baseManifest.id} -> ${candidate.manifest.id}]: ` +
        `passDelta=${passRateDelta >= 0 ? '+' : ''}${(passRateDelta * 100).toFixed(1)}%, ` +
        `scoreDelta=${partialScoreDelta >= 0 ? '+' : ''}${partialScoreDelta.toFixed(3)}, ` +
        `tokenDelta=${meanTokensDelta}, costDelta=$${meanCostDollarsDelta.toFixed(5)} ` +
        `(${hypothesisOutcome.verdict})`,
    };
  }

  private evaluateHypothesisOutcome(params: {
    readonly candidate: ProposedCandidate;
    readonly evidenceBundle: EvidenceBundle;
    readonly passRateDelta: number;
    readonly partialScoreDelta: number;
    readonly meanTokensDelta: number;
    readonly meanCostDollarsDelta: number;
    readonly meanLatencyMsDelta: number;
    readonly cacheHitRatioDelta: number;
    readonly toolErrorRateDelta: number;
    readonly regressionDelta: number;
    readonly policyViolationDelta: number;
    readonly newlyIntroducedFailureSignals: ReadonlyArray<FailureSignalType>;
  }): HypothesisOutcome {
    const { candidate, evidenceBundle } = params;
    const metricMap: Record<string, number> = {
      pass_rate: params.passRateDelta || params.partialScoreDelta,
      tokens: params.meanTokensDelta,
      cost_dollars: params.meanCostDollarsDelta,
      latency_ms: params.meanLatencyMsDelta,
      cache_hit_ratio: params.cacheHitRatioDelta,
      tool_error_rate: params.toolErrorRateDelta,
      regression_rate: params.regressionDelta,
      security_violations: params.policyViolationDelta,
    };

    const observedEffects = candidate.hypothesis.predictedEffects.map((pred) => {
      const delta = metricMap[pred.metric] ?? 0;
      let matched = false;
      if (pred.direction === 'INCREASE') matched = delta > 0;
      else if (pred.direction === 'DECREASE') matched = delta < 0;
      else matched = Math.abs(delta) <= 0.001;
      return {
        metric: pred.metric,
        delta,
        matchedPrediction: matched,
      };
    });

    const unexpectedEffects: string[] = [];
    if (params.regressionDelta > 0) {
      unexpectedEffects.push(`Introduced ${params.regressionDelta} regression(s)`);
    }
    if (params.policyViolationDelta > 0) {
      unexpectedEffects.push(`Triggered ${params.policyViolationDelta} new policy violation(s)`);
    }
    for (const sig of params.newlyIntroducedFailureSignals) {
      unexpectedEffects.push(`Introduced new failure signal '${sig}'`);
    }

    const hasInfraFailure = evidenceBundle.candidateTrials.some((t) =>
      Boolean(t.infrastructureError),
    );

    let verdict: HypothesisVerdict = 'inconclusive';
    if (hasInfraFailure) {
      verdict = 'inconclusive';
    } else if (
      params.regressionDelta > 0 ||
      params.policyViolationDelta > 0 ||
      params.passRateDelta < 0 ||
      params.partialScoreDelta < -0.01
    ) {
      verdict = 'contradicted';
    } else if (
      params.passRateDelta > 0 ||
      params.partialScoreDelta > 0 ||
      (params.passRateDelta === 0 &&
        (params.meanTokensDelta < -100 || params.toolErrorRateDelta < 0))
    ) {
      verdict = 'supported';
    }

    const confidence =
      verdict === 'supported'
        ? Math.min(0.95, 0.7 + evidenceBundle.repetitions * 0.08)
        : verdict === 'contradicted'
          ? 0.85
          : 0.4;

    return {
      hypothesisId: candidate.hypothesis.id,
      candidateId: candidate.candidateId,
      verdict,
      observedEffects,
      unexpectedEffects,
      evidenceRefs: [evidenceBundle.id],
      confidence,
      summary: `Hypothesis ${candidate.hypothesis.id} is ${verdict} (confidence ${(confidence * 100).toFixed(0)}%).`,
    };
  }
}
