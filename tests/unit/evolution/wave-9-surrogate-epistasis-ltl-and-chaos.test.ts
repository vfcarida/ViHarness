import { describe, it, expect } from 'vitest';
import { createId } from '../../../src/core/types/identifiers.js';
import {
  ComponentCapabilityClass,
  EvidenceLevel,
} from '../../../src/core/evolution/constitution.js';
import type {
  ExperienceEntry,
  ProposedCandidate,
} from '../../../src/core/evolution/interfaces.js';
import type { BehavioralContrast } from '../../../src/core/evolution/hypothesis.js';
import {
  HarnessManifestToolkit,
  BayesianHarnessSurrogateModel,
  EpistaticSurfaceGraphAnalyzer,
  RuntimeTemporalContractMonitor,
  HypervolumeParetoSelector,
  SkillSubagentDistiller,
  ChaosFaultInjectionTester,
  RecursiveEvolutionEngine,
} from '../../../src/infra/evolution/index.js';
import { Container } from '../../../src/di/container.js';
import { DefaultModule } from '../../../src/di/default-module.js';
import { TOKENS } from '../../../src/di/tokens.js';
import { runEvolutionManageCli } from '../../../src/cli/commands/evolve.js';

describe('Wave 9: Bayesian Surrogate, Epistatic Surface Graph, LTLf Monitor, Hypervolume Pareto, Skill Distillation & Chaos Resilience', () => {
  const toolkit = new HarnessManifestToolkit();
  const baseH0 = toolkit.createCanonicalBaseline();

  function buildCandidate(
    idSuffix: string,
    surfaceId:
      | 'systemPrompt'
      | 'toolGuidance'
      | 'contextPolicy'
      | 'routingPolicy'
      | 'verificationPolicy',
    quadrant:
      | 'INVARIANT_GUIDANCE'
      | 'DOMAIN_GUIDANCE'
      | 'INVARIANT_STRUCTURAL'
      | 'DOMAIN_STRUCTURAL',
  ): ProposedCandidate {
    const manifest = toolkit.cloneWithOverrides(baseH0, {
      newId: `h_w9_${idSuffix}`,
      createdBy: 'proposer',
      componentOverrides: {
        [surfaceId]: HarnessManifestToolkit.createComponentRef({
          id: `comp-${surfaceId}-${idSuffix}`,
          surfaceId,
          capabilityClass: ComponentCapabilityClass.DECLARATIVE,
          content:
            surfaceId === 'systemPrompt' || surfaceId === 'toolGuidance'
              ? `Refined ${surfaceId} ${idSuffix}`
              : { updatedBy: idSuffix },
        }),
      },
    });
    const diffFromBase = toolkit.diff(baseH0, manifest);
    return {
      candidateId: createId<'Candidate'>(`cand_w9_${idSuffix}`),
      manifest,
      diffFromBase,
      hypothesis: {
        id: createId<'Hypothesis'>(`hyp_w9_${idSuffix}`),
        candidateId: createId<'Candidate'>(`cand_w9_${idSuffix}`),
        baseManifestId: baseH0.id,
        scopeAxis: quadrant.startsWith('INVARIANT')
          ? 'INVARIANT'
          : 'DOMAIN_SPECIFIC',
        mechanismAxis: quadrant.endsWith('STRUCTURAL')
          ? 'STRUCTURAL'
          : 'GUIDANCE',
        quadrant,
        targetComponents: [surfaceId],
        observedFailureSignals: ['plan_execution_mismatch'],
        rationale: `Refine ${surfaceId}`,
        applicability: {
          domains: ['general-swe'],
          languages: ['typescript'],
          modelFamilies: ['model-agnostic'],
          triggerSignals: ['plan_execution_mismatch'],
        },
        predictedEffects: [],
        predictedTradeoffs: [],
        risks: [],
        editBudget: {
          maxSurfacesModified: 2,
          maxUnitsChanged: 10,
          maxCapabilityClass: ComponentCapabilityClass.DECLARATIVE,
          iterationStep: 1,
        },
        generalizationClaim: 'Transfers across SWE tasks',
        createdAt: new Date().toISOString(),
      },
    };
  }

  function buildContrast(
    cand: ProposedCandidate,
    partialScoreDelta: number,
  ): BehavioralContrast {
    return {
      id: createId<'Contrast'>(`contrast_${cand.candidateId}`),
      baseManifestId: baseH0.id,
      candidateManifestId: cand.manifest.id,
      evidenceBundleId: createId<'Probe'>('probe_w9'),
      passRateDelta: partialScoreDelta,
      partialScoreDelta,
      meanIterationDelta: 0,
      meanTokenDelta: 0,
      meanCostDollarsDelta: 0,
      meanLatencyMsDelta: 0,
      toolErrorDelta: 0,
      policyViolationDelta: 0,
      regressionCountDelta: 0,
      newlySolvedTaskIds: [],
      regressedTaskIds: [],
      resolvedFailureSignals: [],
      introducedFailureSignals: [],
      hypothesisOutcome: {
        hypothesisId: cand.hypothesis.id,
        candidateId: cand.candidateId,
        verdict: partialScoreDelta > 0 ? 'supported' : 'contradicted',
        observedEffects: [],
        unexpectedEffects: [],
        evidenceRefs: [],
        confidence: 0.85,
        summary: 'Test contrast',
      },
      redundancyScoreWithPeers: 0,
      createdAt: new Date().toISOString(),
    };
  }

  it('9.1 BayesianHarnessSurrogateModel predicts posterior utility (EI & UCB) and pre-screens candidate pools at zero probe cost', () => {
    const surrogate = new BayesianHarnessSurrogateModel();
    const candGood = buildCandidate('good', 'toolGuidance', 'INVARIANT_GUIDANCE');
    const candBad = buildCandidate('bad', 'routingPolicy', 'DOMAIN_STRUCTURAL');
    const candSimilarGood = buildCandidate(
      'sim_good',
      'toolGuidance',
      'INVARIANT_GUIDANCE',
    );

    surrogate.recordObservation(candGood, buildContrast(candGood, 0.28));
    surrogate.recordObservation(candBad, buildContrast(candBad, -0.15));

    const screen = surrogate.preScreenCandidates({
      candidates: [candBad, candSimilarGood],
      maxSelected: 1,
    });

    expect(screen.selectedCandidates).toHaveLength(1);
    expect(screen.selectedCandidates[0]?.candidateId).toBe(
      candSimilarGood.candidateId,
    );
    expect(screen.predictions[0]?.posteriorMeanDelta).toBeGreaterThan(
      screen.predictions[1]?.posteriorMeanDelta ?? -1,
    );
  });

  it('9.2 EpistaticSurfaceGraphAnalyzer computes 2nd-order Shapley-Taylor interaction indices and filters antagonistic conflicts', () => {
    const analyzer = new EpistaticSurfaceGraphAnalyzer({
      synergyThreshold: 0.05,
      conflictThreshold: -0.05,
    });

    const candA = buildCandidate('only_a', 'systemPrompt', 'INVARIANT_GUIDANCE');
    const candB = buildCandidate('only_b', 'toolGuidance', 'INVARIANT_GUIDANCE');

    const manifestAB = toolkit.cloneWithOverrides(baseH0, {
      newId: 'h_w9_both_ab',
      createdBy: 'proposer',
      componentOverrides: {
        systemPrompt: candA.manifest.components.systemPrompt,
        toolGuidance: candB.manifest.components.toolGuidance,
      },
    });
    const candAB: ProposedCandidate = {
      ...candA,
      candidateId: createId<'Candidate'>('cand_w9_ab'),
      manifest: manifestAB,
      diffFromBase: toolkit.diff(baseH0, manifestAB),
    };

    // Synergistic case: A alone = +0.05, B alone = +0.05, AB together = +0.25 -> I_{A,B} > 0.05
    const synergyReport = analyzer.analyzeEpistaticGraph({
      candidates: [candA, candB, candAB],
      contrasts: [
        buildContrast(candA, 0.05),
        buildContrast(candB, 0.05),
        buildContrast(candAB, 0.25),
      ],
    });
    expect(synergyReport.synergisticModules.length).toBeGreaterThanOrEqual(1);

    // Antagonistic conflict case: A alone = +0.15, B alone = +0.15, AB together = -0.10 -> I_{A,B} < -0.05
    const conflictReport = analyzer.analyzeEpistaticGraph({
      candidates: [candA, candB, candAB],
      contrasts: [
        buildContrast(candA, 0.15),
        buildContrast(candB, 0.15),
        buildContrast(candAB, -0.1),
      ],
    });
    expect(conflictReport.conflictPairs).toHaveLength(1);

    const filtered = analyzer.filterAntagonisticConflicts({
      proposedSurfaces: ['systemPrompt', 'toolGuidance'],
      graphReport: conflictReport,
    });
    expect(filtered.compatibleSurfaces).toEqual(['systemPrompt']);
    expect(filtered.droppedSurfaces).toEqual(['toolGuidance']);
  });

  it('9.3 RuntimeTemporalContractMonitor verifies LTLf temporal contracts and isolates counterexample witnesses', () => {
    const monitor = new RuntimeTemporalContractMonitor();

    const cleanReport = monitor.verifyStepSequence([
      { stepIndex: 1, toolName: 'search_code', isReadOrSearch: true },
      { stepIndex: 2, toolName: 'edit_file', isFileMutation: true },
      { stepIndex: 3, toolName: 'run_command', isVerificationPassed: true },
    ]);
    expect(cleanReport.allContractsSatisfied).toBe(true);
    expect(cleanReport.violatedFormulaIds).toHaveLength(0);

    const violatedReport = monitor.verifyStepSequence([
      // Step 1: blind edit before any read/search -> violates LTL-02, and never verified -> violates LTL-01
      { stepIndex: 1, toolName: 'edit_file', isFileMutation: true },
      // Steps 2..4: 3 consecutive identical tool failures -> violates LTL-03 & LTL-04
      { stepIndex: 2, toolName: 'run_command', isToolError: true },
      { stepIndex: 3, toolName: 'run_command', isToolError: true },
      { stepIndex: 4, toolName: 'run_command', isToolError: true },
    ]);
    expect(violatedReport.allContractsSatisfied).toBe(false);
    expect(violatedReport.violatedFormulaIds).toContain('LTL-01');
    expect(violatedReport.violatedFormulaIds).toContain('LTL-02');
    expect(violatedReport.violatedFormulaIds).toContain('LTL-03');
    expect(violatedReport.violatedFormulaIds).toContain('LTL-04');
  });

  it('9.4 HypervolumeParetoSelector computes 5D dominated hypervolume contributions and Augmented Tchebycheff distance', () => {
    const selector = new HypervolumeParetoSelector();
    const candBalanced = buildCandidate(
      'hv_balanced',
      'toolGuidance',
      'INVARIANT_GUIDANCE',
    );
    const candDominated = buildCandidate(
      'hv_dom',
      'systemPrompt',
      'DOMAIN_GUIDANCE',
    );

    const report = selector.evaluatePopulation({
      candidates: [
        {
          manifest: candBalanced.manifest,
          vector: {
            qualityScore: 0.9,
            costScore: 0.15,
            latencyScore: 0.15,
            toolErrorPenalty: 0.05,
            safetyRiskPenalty: 0.05,
            regressionPenalty: 0.0,
            generalizationBonus: 0.8,
            variancePenalty: 0.0,
          },
        },
        {
          manifest: candDominated.manifest,
          vector: {
            qualityScore: 0.55,
            costScore: 0.45,
            latencyScore: 0.5,
            toolErrorPenalty: 0.25,
            safetyRiskPenalty: 0.3,
            regressionPenalty: 0.1,
            generalizationBonus: 0.2,
            variancePenalty: 0.1,
          },
        },
      ],
    });

    expect(report.totalEnsembleHypervolume).toBeGreaterThan(0.3);
    expect(report.paretoFrontierIds).toEqual([String(candBalanced.manifest.id)]);
    expect(report.selectedByHypervolume.manifestId).toBe(
      String(candBalanced.manifest.id),
    );
    expect(report.selectedByTchebycheff.manifestId).toBe(
      String(candBalanced.manifest.id),
    );
  });

  it('9.5 SkillSubagentDistiller synthesizes declarative skills and least-privilege subagents from supported ExperienceEntries', () => {
    const distiller = new SkillSubagentDistiller();
    const cand = buildCandidate(
      'distill_src',
      'verificationPolicy',
      'INVARIANT_STRUCTURAL',
    );
    const contrast = buildContrast(cand, 0.22);

    const entry: ExperienceEntry = {
      id: createId<'ExperienceEntry'>('exp_w9_1'),
      manifest: cand.manifest,
      baseManifestId: baseH0.id,
      diffFromBase: cand.diffFromBase,
      applicability: cand.hypothesis.applicability,
      motivatingFailureSignals: ['verification_blind_spot'],
      hypothesis: cand.hypothesis,
      predictedEffects: [],
      hypothesisOutcome: contrast.hypothesisOutcome,
      positiveEvidence: ['Eliminated verification blind spot'],
      negativeEvidence: [],
      contradictedPredictions: [],
      observedEffectSizes: { pass_rate: 0.22 },
      probeBundleIds: ['probe_w9'],
      repetitionsCount: 1,
      targetProfile: baseH0.target,
      taskDomainProvenance: ['general-swe'],
      tokenDelta: 0,
      costDollarsDelta: 0,
      latencyMsDelta: 0,
      safetyImpact: 'IMPROVED',
      heldOutEvidenceLevel: EvidenceLevel.E3_VERIFIED,
      retentionPassed: true,
      admissionStatus: 'promoted',
      confidence: 0.91,
      createdAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      status: 'ACTIVE',
    };

    const res = distiller.distillAndEnrichManifest({
      baseManifest: baseH0,
      experiences: [entry],
    });

    expect(res.distilledSkills).toHaveLength(1);
    expect(res.distilledSubagents).toHaveLength(1);
    expect(res.enrichedManifest.components.skills.length).toBe(
      baseH0.components.skills.length + 1,
    );
    expect(res.enrichedManifest.components.subagents.length).toBe(
      baseH0.components.subagents.length + 1,
    );
  });

  it('9.6 ChaosFaultInjectionTester evaluates operational resilience, DI resolves Wave 9 tokens, and CLI runs chaos-test & ltl-verify', async () => {
    const tester = new ChaosFaultInjectionTester();
    const chaosReport = tester.runChaosSuite(baseH0);

    expect(chaosReport.scenariosEvaluated).toBe(4);
    expect(chaosReport.autonomousRecoveryRate).toBe(1);
    expect(chaosReport.resilienceScore).toBe(1);
    expect(chaosReport.temporalVerification.allContractsSatisfied).toBe(true);

    // Verify RecursiveEvolutionEngine populates Wave 9 fields
    const engine = new RecursiveEvolutionEngine({ enabledByDefault: true });
    const cycleReport = await engine.runCycle({
      taskIdentifier: 'w9_cycle_task',
      dryRun: true,
      evolveTasks: [
        {
          taskId: 'w9_cycle_task',
          prompt: 'Verify Wave 9 cycle telemetry and resilience',
          split: 'evolve',
        },
      ],
    });
    expect(cycleReport.epistaticSurfaceGraph).toBeDefined();
    expect(cycleReport.temporalContractVerification?.allContractsSatisfied).toBe(
      true,
    );
    expect(cycleReport.chaosResilience?.autonomousRecoveryRate).toBe(1);

    // Verify DI Container registrations for Wave 9
    const container = new Container();
    new DefaultModule().register(container);
    expect(
      container.resolve(TOKENS.BayesianHarnessSurrogateModel),
    ).toBeInstanceOf(BayesianHarnessSurrogateModel);
    expect(
      container.resolve(TOKENS.EpistaticSurfaceGraphAnalyzer),
    ).toBeInstanceOf(EpistaticSurfaceGraphAnalyzer);
    expect(
      container.resolve(TOKENS.RuntimeTemporalContractMonitor),
    ).toBeInstanceOf(RuntimeTemporalContractMonitor);
    expect(container.resolve(TOKENS.HypervolumeParetoSelector)).toBeInstanceOf(
      HypervolumeParetoSelector,
    );
    expect(container.resolve(TOKENS.SkillSubagentDistiller)).toBeInstanceOf(
      SkillSubagentDistiller,
    );
    expect(container.resolve(TOKENS.ChaosFaultInjectionTester)).toBeInstanceOf(
      ChaosFaultInjectionTester,
    );

    // Verify CLI subcommands `chaos-test` and `ltl-verify`
    const chaosExit = await runEvolutionManageCli(['chaos-test', 'H0'], {
      engine,
    });
    expect(chaosExit).toBe(0);

    const ltlExit = await runEvolutionManageCli(['ltl-verify'], { engine });
    expect(ltlExit).toBe(0);
  });
});
