/**
 * Regularized Recursive Self-Improvement (RRSI / HarnessCompass) Candidate Regularizer.
 *
 * Implements:
 * 1. Temporally annealed edit budgets (caps simultaneous surface count, magnitude, and risk)
 * 2. Novelty scoring against prior candidate trajectories
 * 3. Benchmark-specificity critic (rejects task-ID / rubric / fixture / answer memorization)
 * 4. Generalization critic (verifies reusable mechanism vs one-task patch)
 * 5. Pruner (detects no-op edits, duplicate skills/scripts, or excessive-cost components)
 * 6. Complexity penalty (Occam's razor preference for simpler harnesses)
 */
import type { Clock } from '../../core/interfaces/clock.js';
import { CAPABILITY_CLASS_RISK_RANK } from '../../core/evolution/constitution.js';
import type {
  CandidateRegularizer,
  ProposedCandidate,
  RegularizationBatchResult,
  RegularizationVerdict,
} from '../../core/evolution/interfaces.js';
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';

export interface CandidateRegularizerOptions {
  readonly clock?: Clock;
  readonly baseMaxSimultaneousSurfaces?: number;
  readonly annealingDecayFactor?: number;
  readonly maxCapabilityRiskRank?: number;
  readonly minNoveltyScore?: number;
  readonly maxBenchmarkSpecificityScore?: number;
  readonly minGeneralizationScore?: number;
}

const BENCHMARK_MEMORIZATION_PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly label: string;
  readonly weight: number;
}> = [
  {
    pattern: /\b(?:swe[-_]?bench|swebench|terminal[-_]?bench|harnessopt[-_]?bench|evoharness)\b/i,
    label: 'benchmark_name_reference',
    weight: 0.45,
  },
  {
    pattern: /\b(?:django__django|sympy__sympy|scikit-learn__scikit-learn|pytest-dev__pytest|astropy__astropy)-\d+\b/i,
    label: 'hardcoded_swebench_instance_id',
    weight: 0.85,
  },
  {
    pattern: /\b(?:FAIL_TO_PASS|PASS_TO_PASS|rubric_score|gold_patch|expected_test_output)\b/i,
    label: 'rubric_or_gold_patch_leak',
    weight: 0.9,
  },
  {
    pattern: /\bif\s*\(\s*(?:taskId|instance_id|task\.id)\s*===\s*['"][^'"]+['"]\s*\)/i,
    label: 'conditional_task_id_memorization',
    weight: 1.0,
  },
  {
    pattern: /\/(?:testbed\/_secret_rubric|benchmark-results\/|\.vi-evolution\/admissions\/)/i,
    label: 'fixture_or_evaluation_path_leak',
    weight: 0.85,
  },
  {
    pattern: /\b(?:hardcoded_answer|memorized_solution|bypass_verifier_for_task)\b/i,
    label: 'explicit_answer_memorization',
    weight: 1.0,
  },
];

export class BenchmarkSpecificityCritic {
  evaluate(candidate: ProposedCandidate): {
    readonly score: number;
    readonly findings: ReadonlyArray<string>;
  } {
    const serializedPayloads = JSON.stringify({
      changedComponents: candidate.diffFromBase.componentDiffs.map((e) => ({
        surfaceId: e.surfaceId,
        afterHash: e.afterHash,
      })),
      components: candidate.manifest.components,
      rationale: candidate.hypothesis.rationale,
      generalizationClaim: candidate.hypothesis.generalizationClaim,
    });

    let totalWeight = 0;
    const findings: string[] = [];

    for (const rule of BENCHMARK_MEMORIZATION_PATTERNS) {
      if (rule.pattern.test(serializedPayloads)) {
        totalWeight += rule.weight;
        findings.push(
          `BenchmarkSpecificityCritic matched '${rule.label}' in candidate ${candidate.candidateId}`,
        );
      }
    }

    return {
      score: Math.min(1.0, Number(totalWeight.toFixed(4))),
      findings,
    };
  }
}

export class GeneralizationCritic {
  evaluate(candidate: ProposedCandidate): {
    readonly score: number;
    readonly reasons: ReadonlyArray<string>;
  } {
    let score = 0.5;
    const reasons: string[] = [];
    const hyp = candidate.hypothesis;

    if (hyp.generalizationClaim && hyp.generalizationClaim.trim().length >= 20) {
      score += 0.2;
    } else {
      score -= 0.25;
      reasons.push('Generalization claim is missing or too terse (< 20 chars).');
    }

    if (hyp.rationale && hyp.rationale.trim().length >= 15) {
      score += 0.15;
    } else {
      score -= 0.2;
      reasons.push('Hypothesis rationale is missing or too brief.');
    }

    if (hyp.predictedEffects.length > 0) {
      score += 0.1;
    } else {
      score -= 0.15;
      reasons.push('Candidate does not declare falsifiable predictedEffects.');
    }

    if (hyp.observedFailureSignals.length > 0) {
      score += 0.05;
    } else {
      score -= 0.1;
      reasons.push('Candidate does not reference motivating failure signals.');
    }

    return {
      score: Math.max(0.0, Math.min(1.0, Number(score.toFixed(4)))),
      reasons,
    };
  }
}

export class HarnessPruner {
  findPrunableSurfaces(
    baseManifest: HarnessManifest,
    candidate: ProposedCandidate,
  ): ReadonlyArray<string> {
    const prunable: string[] = [];

    const actuallyModified = new Set(candidate.diffFromBase.changedSurfaces);
    for (const target of candidate.hypothesis.targetComponents) {
      if (!actuallyModified.has(String(target))) {
        prunable.push(`${String(target)}:no_op_change`);
      }
    }

    const seenSkillHashes = new Set<string>();
    for (const skill of candidate.manifest.components.skills) {
      if (seenSkillHashes.has(skill.contentHash)) {
        prunable.push(`skills:duplicate_hash_${skill.contentHash.slice(0, 8)}`);
      }
      seenSkillHashes.add(skill.contentHash);
    }

    const seenScriptHashes = new Set<string>();
    for (const script of candidate.manifest.components.scripts) {
      if (seenScriptHashes.has(script.contentHash)) {
        prunable.push(`scripts:duplicate_hash_${script.contentHash.slice(0, 8)}`);
      }
      seenScriptHashes.add(script.contentHash);
    }

    if (candidate.manifest.contentHash === baseManifest.contentHash) {
      prunable.push('manifest:identical_to_baseline');
    }

    return prunable;
  }
}

const DEFAULT_CLOCK: Clock = {
  now: () => new Date(),
  timestamp: () => Date.now(),
};

export class DefaultCandidateRegularizer implements CandidateRegularizer {
  private readonly clock: Clock;
  private readonly baseMaxSimultaneousSurfaces: number;
  private readonly annealingDecayFactor: number;
  private readonly maxCapabilityRiskRank: number;
  private readonly minNoveltyScore: number;
  private readonly maxBenchmarkSpecificityScore: number;
  private readonly minGeneralizationScore: number;
  private readonly specificityCritic = new BenchmarkSpecificityCritic();
  private readonly generalizationCritic = new GeneralizationCritic();
  private readonly pruner = new HarnessPruner();

  constructor(options: CandidateRegularizerOptions = {}) {
    this.clock = options.clock ?? DEFAULT_CLOCK;
    this.baseMaxSimultaneousSurfaces = options.baseMaxSimultaneousSurfaces ?? 3;
    this.annealingDecayFactor = options.annealingDecayFactor ?? 0.85;
    this.maxCapabilityRiskRank = options.maxCapabilityRiskRank ?? 3; // EXECUTABLE (3), blocks CONSTITUTIONAL (4)
    this.minNoveltyScore = options.minNoveltyScore ?? 0.25;
    this.maxBenchmarkSpecificityScore = options.maxBenchmarkSpecificityScore ?? 0.2;
    this.minGeneralizationScore = options.minGeneralizationScore ?? 0.4;
  }

  regularize(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidates: ReadonlyArray<ProposedCandidate>;
    readonly priorCandidates: ReadonlyArray<ProposedCandidate>;
    readonly iterationStep: number;
  }): RegularizationBatchResult {
    const approved: ProposedCandidate[] = [];
    const rejected: Array<{
      readonly candidate: ProposedCandidate;
      readonly verdict: RegularizationVerdict;
    }> = [];
    const verdicts: RegularizationVerdict[] = [];

    const annealedMaxSurfaces = Math.max(
      1,
      Math.round(
        this.baseMaxSimultaneousSurfaces *
          Math.pow(this.annealingDecayFactor, Math.max(0, params.iterationStep)),
      ),
    );

    const historyPool: ProposedCandidate[] = [...params.priorCandidates];

    for (const candidate of params.candidates) {
      const rejectionReasons: string[] = [];

      const changedSurfaceCount = candidate.diffFromBase.changedSurfaces.length;
      const declaredMaxSurfaces = Math.min(
        annealedMaxSurfaces,
        candidate.hypothesis.editBudget.maxSurfacesModified,
      );
      const riskRank =
        CAPABILITY_CLASS_RISK_RANK[candidate.diffFromBase.highestRiskClassTouched];

      const editBudgetPassed =
        changedSurfaceCount > 0 &&
        changedSurfaceCount <= declaredMaxSurfaces &&
        riskRank <= this.maxCapabilityRiskRank;

      if (changedSurfaceCount === 0) {
        rejectionReasons.push('Candidate makes 0 surface modifications relative to baseManifest.');
      }
      if (changedSurfaceCount > declaredMaxSurfaces) {
        rejectionReasons.push(
          `Edit budget exceeded: modified ${changedSurfaceCount} surfaces, annealed limit is ${declaredMaxSurfaces} at step ${params.iterationStep}.`,
        );
      }
      if (riskRank > this.maxCapabilityRiskRank) {
        rejectionReasons.push(
          `Capability risk rank ${riskRank} exceeds maximum allowed ${this.maxCapabilityRiskRank}.`,
        );
      }

      const noveltyScore = this.computeNoveltyScore(candidate, historyPool);
      if (noveltyScore < this.minNoveltyScore) {
        rejectionReasons.push(
          `Novelty score ${noveltyScore.toFixed(2)} is below minimum threshold ${this.minNoveltyScore.toFixed(2)} (duplicate/redundant proposal).`,
        );
      }

      const specificity = this.specificityCritic.evaluate(candidate);
      if (specificity.score > this.maxBenchmarkSpecificityScore) {
        rejectionReasons.push(...specificity.findings);
      }

      const generalization = this.generalizationCritic.evaluate(candidate);
      if (generalization.score < this.minGeneralizationScore) {
        rejectionReasons.push(...generalization.reasons);
      }

      const prunedSurfaces = this.pruner.findPrunableSurfaces(params.baseManifest, candidate);
      if (prunedSurfaces.includes('manifest:identical_to_baseline')) {
        rejectionReasons.push('Pruner rejected candidate identical to baseline.');
      }

      const complexityPenalty = this.computeComplexityPenalty(candidate);
      const isApproved = rejectionReasons.length === 0;

      const verdict: RegularizationVerdict = {
        candidateId: candidate.candidateId,
        approved: isApproved,
        editBudgetPassed,
        noveltyScore,
        benchmarkSpecificityScore: specificity.score,
        generalizationScore: generalization.score,
        complexityPenalty,
        prunedSurfaces,
        rejectionReasons,
        auditTimestamp: this.clock.now().toISOString(),
      };

      verdicts.push(verdict);
      if (isApproved) {
        approved.push(candidate);
        historyPool.push(candidate);
      } else {
        rejected.push({ candidate, verdict });
      }
    }

    return {
      approved,
      rejected,
      verdicts,
    };
  }

  private computeNoveltyScore(
    candidate: ProposedCandidate,
    priorPool: ReadonlyArray<ProposedCandidate>,
  ): number {
    if (priorPool.length === 0) {
      return 1.0;
    }

    let maxSimilarity = 0.0;
    const candSignature = this.buildCandidateSignature(candidate);

    for (const prior of priorPool) {
      if (prior.manifest.contentHash === candidate.manifest.contentHash) {
        return 0.0;
      }
      const priorSig = this.buildCandidateSignature(prior);
      const sim = this.jaccardSimilarity(candSignature, priorSig);
      if (sim > maxSimilarity) {
        maxSimilarity = sim;
      }
    }

    return Number(Math.max(0.0, 1.0 - maxSimilarity).toFixed(4));
  }

  private buildCandidateSignature(candidate: ProposedCandidate): Set<string> {
    const tokens = new Set<string>();
    for (const entry of candidate.diffFromBase.componentDiffs) {
      if (entry.changeType !== 'UNCHANGED') {
        tokens.add(`surface:${entry.surfaceId}:${entry.afterHash ?? 'removed'}`);
      }
    }
    tokens.add(`scope:${candidate.hypothesis.scopeAxis}`);
    tokens.add(`mechanism:${candidate.hypothesis.mechanismAxis}`);
    return tokens;
  }

  private jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1.0;
    let intersection = 0;
    for (const item of a) {
      if (b.has(item)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0.0 : intersection / union;
  }

  private computeComplexityPenalty(candidate: ProposedCandidate): number {
    const surfaceCountPenalty = candidate.diffFromBase.changedSurfaces.length * 0.03;
    const executablePenalty =
      (candidate.manifest.components.scripts.length +
        candidate.manifest.components.plugins.length) *
      0.04;
    const subagentPenalty = candidate.manifest.components.subagents.length * 0.02;
    return Number((surfaceCountPenalty + executablePenalty + subagentPenalty).toFixed(4));
  }
}
