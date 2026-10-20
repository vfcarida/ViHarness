import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createId } from '../../../src/core/types/identifiers.js';
import { ComponentCapabilityClass } from '../../../src/core/evolution/constitution.js';
import type { ProbeTaskSpec } from '../../../src/core/evolution/interfaces.js';
import {
  HarnessManifestToolkit,
  MapElitesHarnessArchive,
  SubmodularBenchmarkCoEvolver,
  StructuralPolicyInvariantVerifier,
  LineageBisectionDiagnoser,
  ConformalUtilityCalibrator,
  ContinuousEvolutionDaemon,
  CanaryDeploymentController,
  RecursiveEvolutionEngine,
} from '../../../src/infra/evolution/index.js';
import { Container } from '../../../src/di/container.js';
import { DefaultModule } from '../../../src/di/default-module.js';
import { TOKENS } from '../../../src/di/tokens.js';
import { runEvolutionManageCli } from '../../../src/cli/commands/evolve.js';

describe('Wave 8: Quality-Diversity Illumination, Formal Policy Verification & Self-Healing Evolution', () => {
  const toolkit = new HarnessManifestToolkit();
  const baseH0 = toolkit.createCanonicalBaseline();

  it('8.1 MapElitesHarnessArchive illuminates behavioral grid cells and samples stepping-stone parents', () => {
    const archive = new MapElitesHarnessArchive();

    const candA = toolkit.cloneWithOverrides(baseH0, {
      newId: createId<'Harness'>('h_qd_a'),
      createdBy: 'proposer',
      componentOverrides: {
        systemPrompt: HarnessManifestToolkit.createComponentRef({
          id: 'comp-sys-qd-a',
          surfaceId: 'systemPrompt',
          capabilityClass: ComponentCapabilityClass.DECLARATIVE,
          content: 'Stepping stone A',
        }),
      },
    });
    const candAHigh = toolkit.cloneWithOverrides(baseH0, {
      newId: createId<'Harness'>('h_qd_a_high'),
      createdBy: 'proposer',
      componentOverrides: {
        systemPrompt: HarnessManifestToolkit.createComponentRef({
          id: 'comp-sys-qd-a-high',
          surfaceId: 'systemPrompt',
          capabilityClass: ComponentCapabilityClass.DECLARATIVE,
          content: 'Better stepping stone A',
        }),
      },
    });
    const candB = toolkit.cloneWithOverrides(baseH0, {
      newId: createId<'Harness'>('h_qd_b'),
      createdBy: 'proposer',
      componentOverrides: {
        routingPolicy: HarnessManifestToolkit.createComponentRef({
          id: 'comp-routing-qd-b',
          surfaceId: 'routingPolicy',
          capabilityClass: ComponentCapabilityClass.DECLARATIVE,
          content: { defaultTier: 'reasoning', architectMode: true },
        }),
      },
    });

    const first = archive.recordCandidate({
      manifest: candA,
      quadrant: 'INVARIANT_GUIDANCE',
      utilityScore: 0.72,
      passRate: 0.75,
      meanCostDollars: 0.01,
    });
    expect(first.inserted).toBe(true);
    expect(first.replacedExisting).toBe(false);
    expect(first.cellKey).toBe('INVARIANT_GUIDANCE::ULTRA_LOW_COST');

    const upgraded = archive.recordCandidate({
      manifest: candAHigh,
      quadrant: 'INVARIANT_GUIDANCE',
      utilityScore: 0.89,
      passRate: 0.9,
      meanCostDollars: 0.012,
    });
    expect(upgraded.inserted).toBe(true);
    expect(upgraded.replacedExisting).toBe(true);

    const second = archive.recordCandidate({
      manifest: candB,
      quadrant: 'DOMAIN_STRUCTURAL',
      utilityScore: 0.81,
      passRate: 0.85,
      meanCostDollars: 0.09,
    });
    expect(second.inserted).toBe(true);
    expect(second.cellKey).toBe('DOMAIN_STRUCTURAL::HIGH_COMPUTE_DEPTH');

    const snapshot = archive.getSnapshot();
    expect(snapshot.populatedCells).toBe(2);
    expect(snapshot.totalGridCells).toBe(12);
    expect(snapshot.qdScore).toBeCloseTo(0.89 + 0.81, 4);

    const steppingStones = archive.sampleSteppingStoneParents(2);
    expect(steppingStones).toHaveLength(2);
    expect(steppingStones[0]?.manifest.id).toBe(candAHigh.id);
  });

  it('8.2 SubmodularBenchmarkCoEvolver detects benchmark saturation, synthesizes compositional tasks, and maximizes facility-location coverage', () => {
    const coevolver = new SubmodularBenchmarkCoEvolver();
    const tasks: ProbeTaskSpec[] = [
      {
        taskId: 't_sat_1',
        prompt: 'Fix null pointer exception in parser module',
        split: 'evolve',
        domain: 'bugfix',
      },
      {
        taskId: 't_sat_2',
        prompt: 'Implement retry backoff logic in HTTP client',
        split: 'evolve',
        domain: 'resilience',
      },
      {
        taskId: 't_active_3',
        prompt: 'Optimize SQL query planner join ordering under memory constraints',
        split: 'evolve',
        domain: 'database',
      },
    ];

    const saturationReport = coevolver.detectBenchmarkSaturation([
      {
        taskId: 't_sat_1',
        candidatePassRates: [1.0, 1.0, 0.98, 1.0],
        targetedFailureSignals: ['context_rot_distraction'],
      },
      {
        taskId: 't_sat_2',
        candidatePassRates: [0.96, 0.98, 1.0, 0.96],
        targetedFailureSignals: ['verification_blind_spot'],
      },
      {
        taskId: 't_active_3',
        candidatePassRates: [0.95, 0.95, 0.96, 0.95],
        targetedFailureSignals: ['plan_execution_mismatch'],
      },
    ]);

    expect(saturationReport.saturated).toBe(true);
    expect(saturationReport.saturatedTaskIds).toContain('t_sat_1');
    expect(saturationReport.saturatedTaskIds).toContain('t_sat_2');

    const synthesized = coevolver.synthesizeCompositionalTasks({
      seedTasks: tasks,
      targetFailureSignals: ['verification_blind_spot', 'loss_in_the_middle'],
      maxSynthesized: 2,
    });
    expect(synthesized).toHaveLength(2);
    expect(synthesized[0]?.tags).toContain('co_evolved_compositional');

    const submodularSelection = coevolver.selectSubmodularSuite({
      candidateTasks: [...tasks, ...synthesized],
      maxSuiteSize: 3,
    });
    expect(submodularSelection.selectedSuite).toHaveLength(3);
    expect(submodularSelection.objectiveValue).toBeGreaterThan(0);
    expect(submodularSelection.theoreticalApproximationGuarantee).toBeCloseTo(
      0.6321,
      3,
    );
  });

  it('8.3 StructuralPolicyInvariantVerifier detects cross-surface deadlocks and auto-repairs conflicting manifests', () => {
    const verifier = new StructuralPolicyInvariantVerifier();

    // Canonical baseline H0 must satisfy all 6 formal invariants
    const cleanReport = verifier.verifyManifestPolicies(baseH0);
    expect(cleanReport.satisfiable).toBe(true);
    expect(cleanReport.violations).toHaveLength(0);

    // Inject multiple cross-surface conflicts (INV-POL-01, INV-POL-02, INV-POL-03, INV-POL-04)
    const brokenManifest = toolkit.cloneWithOverrides(baseH0, {
      newId: createId<'Harness'>('h_broken_pol'),
      createdBy: 'proposer',
      componentOverrides: {
        contextPolicy: HarnessManifestToolkit.createComponentRef({
          id: 'comp-ctx-broken',
          surfaceId: 'contextPolicy',
          capabilityClass: ComponentCapabilityClass.DECLARATIVE,
          content: {
            compactionTriggerRatio: 0.95,
            hardEvictionRatio: 0.85, // INV-POL-01: compactionTriggerRatio >= hardEvictionRatio
          },
        }),
        verificationPolicy: HarnessManifestToolkit.createComponentRef({
          id: 'comp-ver-broken',
          surfaceId: 'verificationPolicy',
          capabilityClass: ComponentCapabilityClass.DECLARATIVE,
          content: {
            requireTdd: true,
            tddKPassRepeats: 2,
            skipAllVerification: true, // INV-POL-03 vs guardrails.requireVerificationEvidence
          },
        }),
        toolSchedulingPolicy: HarnessManifestToolkit.createComponentRef({
          id: 'comp-sched-broken',
          surfaceId: 'toolSchedulingPolicy',
          capabilityClass: ComponentCapabilityClass.DECLARATIVE,
          content: {
            deterministicSerialMode: true,
            maxParallelTools: 4, // INV-POL-04: serialMode with maxParallelTools > 1
          },
        }),
      },
      budgetOverride: {
        maxIterationsPerProbe: 2, // INV-POL-02: insufficient iterations for TDD
      },
    });

    const brokenReport = verifier.verifyManifestPolicies(brokenManifest);
    expect(brokenReport.satisfiable).toBe(false);
    const violatedIds = brokenReport.violations.map((v) => v.invariantId);
    expect(violatedIds).toContain('INV-POL-01');
    expect(violatedIds).toContain('INV-POL-02');
    expect(violatedIds).toContain('INV-POL-03');
    expect(violatedIds).toContain('INV-POL-04');

    const repaired = verifier.autoRepairManifest(brokenManifest);
    expect(repaired.originalSatisfiable).toBe(false);
    expect(repaired.satisfiableAfterRepair).toBe(true);
    expect(repaired.verificationAfterRepair.violations).toHaveLength(0);
  });

  it('8.4 LineageBisectionDiagnoser finds the exact regressing ancestor in O(log2 k) probes and synthesizes a surgical excision patch', async () => {
    const diagnoser = new LineageBisectionDiagnoser();

    // Construct a 5-step lineage [H0, H1, H2, H3, H4] where H2 introduces a bad toolGuidance mutation
    const h1 = toolkit.cloneWithOverrides(baseH0, {
      newId: createId<'Harness'>('h_lin_1'),
      createdBy: 'proposer',
      componentOverrides: {
        systemPrompt: HarnessManifestToolkit.createComponentRef({
          id: 'comp-sys-lin-1',
          surfaceId: 'systemPrompt',
          capabilityClass: ComponentCapabilityClass.DECLARATIVE,
          content: 'Good guidance step 1',
        }),
      },
    });
    const h2Culprit = toolkit.cloneWithOverrides(h1, {
      newId: createId<'Harness'>('h_lin_2_culprit'),
      createdBy: 'proposer',
      componentOverrides: {
        toolGuidance: HarnessManifestToolkit.createComponentRef({
          id: 'comp-tg-culprit',
          surfaceId: 'toolGuidance',
          capabilityClass: ComponentCapabilityClass.DECLARATIVE,
          content: 'REGRESSING_TOOL_GUIDANCE_MUTATION',
        }),
      },
    });
    const h3 = toolkit.cloneWithOverrides(h2Culprit, {
      newId: createId<'Harness'>('h_lin_3'),
      createdBy: 'proposer',
      componentOverrides: {
        memoryPolicy: HarnessManifestToolkit.createComponentRef({
          id: 'comp-mem-lin-3',
          surfaceId: 'memoryPolicy',
          capabilityClass: ComponentCapabilityClass.DECLARATIVE,
          content: { maxRetrievalEntries: 12 },
        }),
      },
    });
    const h4Head = toolkit.cloneWithOverrides(h3, {
      newId: createId<'Harness'>('h_lin_4_head'),
      createdBy: 'proposer',
      componentOverrides: {
        subagentPolicy: HarnessManifestToolkit.createComponentRef({
          id: 'comp-sub-lin-4',
          surfaceId: 'subagentPolicy',
          capabilityClass: ComponentCapabilityClass.DECLARATIVE,
          content: { maxSubagentDepth: 3 },
        }),
      },
    });

    const lineage = [baseH0, h1, h2Culprit, h3, h4Head];
    const result = await diagnoser.bisectAndExcise({
      lineage,
      healthPredicate: async (manifest) => {
        return manifest.components.toolGuidance.id !== 'comp-tg-culprit';
      },
    });

    expect(result.regressionIsolated).toBe(true);
    expect(result.culpritIndex).toBe(2);
    expect(result.firstBadManifest.id).toBe(h2Culprit.id);
    expect(result.offendingSurfaces).toContain('toolGuidance');
    expect(result.probesExecutedCount).toBeLessThanOrEqual(4);
    expect(result.excisedManifestPassedPredicate).toBe(true);
    // Surgical excision reverts toolGuidance to h1's value while keeping h4Head's subagentPolicy
    expect(result.excisedManifest.components.toolGuidance.id).toBe(
      h1.components.toolGuidance.id,
    );
    expect(result.excisedManifest.components.subagentPolicy?.id).toBe(
      'comp-sub-lin-4',
    );
  });

  it('8.5 ConformalUtilityCalibrator computes distribution-free conformal intervals and CVaR tail-risk utility', () => {
    const calibrator = new ConformalUtilityCalibrator({
      seedResiduals: [0.02, 0.04, 0.05, 0.07, 0.09, 0.11, 0.14, 0.18, 0.22],
    });
    calibrator.recordCalibrationResidual(0.75, 0.81); // 0.06

    const interval = calibrator.computeConformalInterval(0.78, 0.2);
    expect(interval.targetCoverage).toBeCloseTo(0.8, 4);
    expect(interval.quantileRadius).toBeGreaterThan(0.1);
    expect(interval.lowerBound).toBeLessThan(0.78);
    expect(interval.upperBound).toBeGreaterThan(0.78);

    const tailEval = calibrator.evaluateTailRiskUtility({
      trialUtilities: [0.45, 0.52, 0.78, 0.82, 0.85, 0.88, 0.9, 0.92],
      alphaTailFraction: 0.25,
      riskAversionLambda: 0.4,
      conformalAlpha: 0.2,
    });
    expect(tailEval.sampleSize).toBe(8);
    expect(tailEval.conditionalValueAtRiskAlpha).toBeCloseTo((0.45 + 0.52) / 2, 4);
    expect(tailEval.riskAverseCompositeScore).toBeLessThan(tailEval.meanUtility);
    expect(tailEval.riskAverseCompositeScore).toBeGreaterThan(
      tailEval.conditionalValueAtRiskAlpha,
    );
  });

  it('8.6 ContinuousEvolutionDaemon orchestrates self-healing ticks, DI container resolves Wave 8 tokens, and CLI executes verify-policies & qd-archive', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vi-wave8-daemon-'));
    try {
      const engine = new RecursiveEvolutionEngine({
        storageRootDir: tmpDir,
        enabledByDefault: true,
      });
      const canaryController = new CanaryDeploymentController(baseH0, {
        admissionGate: engine.getAdmissionGate(),
        experienceLibrary: engine.getLibrary(),
      });
      const daemon = new ContinuousEvolutionDaemon({
        engine,
        canaryController,
        bisectionDiagnoser: new LineageBisectionDiagnoser(),
        mapElitesArchive: engine.getMapElitesArchive(),
        minIncidentsToTrigger: 1,
      });

      daemon.ingestIncident({
        incidentId: 'inc_prod_01',
        taskId: 'prod_repair_task',
        prompt: 'Fix timeout in streaming telemetry exporter',
        failureSignal: 'verification_blind_spot',
      });

      expect(daemon.getQueuedIncidentCount()).toBe(1);
      const tickReport = await daemon.runSelfHealingTick();
      expect(tickReport.incidentsProcessed).toBe(1);
      expect(tickReport.actionTaken).toBe('EVOLUTION_CYCLE_AND_CANARY_STAGE');
      expect(daemon.getQueuedIncidentCount()).toBe(0);
      expect(tickReport.evolutionReport?.mapElitesSnapshot).toBeDefined();
      expect(tickReport.evolutionReport?.policyVerification?.satisfiable).toBe(true);
      expect(tickReport.evolutionReport?.tailRiskUtility).toBeDefined();

      // Verify DI Container registrations for Wave 8
      const container = new Container();
      new DefaultModule().register(container);
      expect(container.resolve(TOKENS.MapElitesHarnessArchive)).toBeInstanceOf(
        MapElitesHarnessArchive,
      );
      expect(container.resolve(TOKENS.SubmodularBenchmarkCoEvolver)).toBeInstanceOf(
        SubmodularBenchmarkCoEvolver,
      );
      expect(
        container.resolve(TOKENS.StructuralPolicyInvariantVerifier),
      ).toBeInstanceOf(StructuralPolicyInvariantVerifier);
      expect(container.resolve(TOKENS.LineageBisectionDiagnoser)).toBeInstanceOf(
        LineageBisectionDiagnoser,
      );
      expect(container.resolve(TOKENS.ConformalUtilityCalibrator)).toBeInstanceOf(
        ConformalUtilityCalibrator,
      );
      expect(container.resolve(TOKENS.ContinuousEvolutionDaemon)).toBeInstanceOf(
        ContinuousEvolutionDaemon,
      );

      // Verify CLI subcommands `verify-policies` and `qd-archive`
      const verifyCode = await runEvolutionManageCli(['verify-policies', 'H0'], {
        engine,
        storageRootDir: tmpDir,
      });
      expect(verifyCode).toBe(0);

      const qdCode = await runEvolutionManageCli(['qd-archive'], {
        engine,
        storageRootDir: tmpDir,
      });
      expect(qdCode).toBe(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
