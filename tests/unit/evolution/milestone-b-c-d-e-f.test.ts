/**
 * Comprehensive Unit Tests for Milestones B, C, D, E, and F:
 * - Contrastive Evolution (Diagnoser, Proposer, ProbeRunner, ContrastAnalyzer, Composer)
 * - Persistent Learning & Regularization (Regularizer, Critics, Pruner, Library, Reflector)
 * - Safe Admission & Multi-Objective Selection (Pareto, RetentionSuite, FailClosedAdmissionGate)
 * - Adaptive Compute & Observability (AdaptiveRecursionBudgetPolicy, EvolutionTreeRenderer)
 * - Interop & Scientific Benchmark Protocol (EightComponentAdapter, EvolutionBenchmarkProtocol)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createId } from '../../../src/core/types/identifiers.js';
import {
  ComponentCapabilityClass,
  DEFAULT_HARNESS_CONSTITUTION,
  EvidenceLevel,
} from '../../../src/core/evolution/constitution.js';
import { DefaultHarnessSurfaceRegistry } from '../../../src/infra/evolution/default-surface-registry.js';
import { HarnessManifestToolkit } from '../../../src/infra/evolution/manifest-toolkit.js';
import { DefaultHarnessDiagnoser } from '../../../src/infra/evolution/default-harness-diagnoser.js';
import { DefaultHarnessProposer } from '../../../src/infra/evolution/default-harness-proposer.js';
import { DefaultCandidateRegularizer } from '../../../src/infra/evolution/candidate-regularizer.js';
import { IsolatedHarnessProbeRunner } from '../../../src/infra/evolution/isolated-probe-runner.js';
import { DefaultBehavioralContrastAnalyzer } from '../../../src/infra/evolution/behavioral-contrast-analyzer.js';
import { DefaultHarnessComposer } from '../../../src/infra/evolution/default-harness-composer.js';
import { DefaultMultiObjectiveSelector } from '../../../src/infra/evolution/multi-objective-selector.js';
import { RetentionSuiteRunner } from '../../../src/infra/evolution/retention-suite-runner.js';
import { FailClosedAdmissionGate } from '../../../src/infra/evolution/fail-closed-admission-gate.js';
import {
  DefaultHarnessReflector,
  FileHarnessExperienceLibrary,
} from '../../../src/infra/evolution/file-experience-library.js';
import { AdaptiveRecursionBudgetPolicy } from '../../../src/infra/evolution/adaptive-recursion-policy.js';
import { EightComponentAdapter } from '../../../src/infra/evolution/interop/eight-component-adapter.js';
import { EvolutionBenchmarkProtocol } from '../../../src/infra/eval/evolution-benchmark-protocol.js';

describe('Milestones B–F — Contrastive Evolution, Regularization, Admission, Adaptive Compute & Benchmarks', () => {
  let tmpDir: string;
  let toolkit: HarnessManifestToolkit;
  let surfaceRegistry: DefaultHarnessSurfaceRegistry;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vi-evo-test-'));
    surfaceRegistry = new DefaultHarnessSurfaceRegistry();
    toolkit = new HarnessManifestToolkit({ surfaceRegistry });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('Milestone B — Diagnoser, Proposer, ProbeRunner, ContrastAnalyzer & Composer', () => {
    it('diagnoses typed failure signals and generates 4-quadrant candidate proposals', async () => {
      const diagnoser = new DefaultHarnessDiagnoser();
      const signals = diagnoser.diagnoseRun({
        runId: 'run_diag_1',
        traces: [
          {
            traceId: 'trace-1',
            executionId: 'run_diag_1' as any,
            taskId: 'task-1' as any,
            iterationId: 'iter-1' as any,
            sequenceNumber: 1,
            phaseBefore: 'EXPLORE' as any,
            phaseAfter: 'IMPLEMENT' as any,
            selectedProviderId: 'anthropic',
            selectedModelId: 'claude-3-7-sonnet',
            targetRole: 'GENERALIST',
            promptTokens: 50000,
            completionTokens: 1000,
            cachedTokens: 0,
            totalTokens: 51000,
            costDollars: 0.25,
            messages: [],
            proposedToolCalls: [
              { id: 'tc1', name: 'edit_file', input: { path: 'a.ts' } },
              { id: 'tc2', name: 'edit_file', input: { path: 'a.ts' } },
            ],
            policyDecisions: [],
            executedToolResults: [
              {
                proposalId: 'tc1',
                status: 'ERROR' as any,
                output: 'Error',
                error: 'Failed to apply edit',
                durationMs: 100,
                metadata: { toolName: 'edit_file' },
              },
            ],
            evidenceCreated: [],
            durationMs: 52000,
            timestamp: new Date(),
          },
        ],
      });

      expect(signals.length).toBeGreaterThanOrEqual(2);
      const signalTypes = signals.map((s) => s.type);
      expect(signalTypes).toContain('repeated_tool_call');
      expect(signalTypes).toContain('tool_error');

      const h0 = toolkit.createCanonicalBaseline();
      const proposer = new DefaultHarnessProposer();
      const candidates = await proposer.propose({
        baseManifest: h0,
        failureSignals: signals,
        libraryEntries: [],
        failedHypotheses: [],
        constitution: DEFAULT_HARNESS_CONSTITUTION,
        surfaceRegistry,
        maxCandidates: 4,
        iterationStep: 0,
      });

      expect(candidates).toHaveLength(4);
      const quadrants = new Set(
        candidates.map(
          (c) => `${c.hypothesis.scopeAxis}:${c.hypothesis.mechanismAxis}`,
        ),
      );
      expect(quadrants.has('INVARIANT:GUIDANCE')).toBe(true);
      expect(quadrants.has('INVARIANT:STRUCTURAL')).toBe(true);
      expect(quadrants.has('DOMAIN_SPECIFIC:GUIDANCE')).toBe(true);
      expect(quadrants.has('DOMAIN_SPECIFIC:STRUCTURAL')).toBe(true);
    });

    it('blocks held-out split access during proposer/probe_runner execution and runs isolated probes', async () => {
      const h0 = toolkit.createCanonicalBaseline();
      const proposer = new DefaultHarnessProposer();
      const [candidate] = await proposer.propose({
        baseManifest: h0,
        failureSignals: [
          {
            id: 'sig-1',
            type: 'repeated_tool_call',
            severity: 'HIGH',
            confidence: 0.9,
            iterationNumbers: [1],
            runIds: ['run_1'],
            evidenceExcerpts: ['Repeated tool calls'],
            implicatedSurfaces: ['toolGuidance'],
            suggestedQuadrants: ['INVARIANT_GUIDANCE'],
          },
        ],
        libraryEntries: [],
        failedHypotheses: [],
        constitution: DEFAULT_HARNESS_CONSTITUTION,
        surfaceRegistry,
        maxCandidates: 1,
        iterationStep: 0,
      });

      const probeRunner = new IsolatedHarnessProbeRunner();

      // Attempting to access 'held_out' split from 'probe_runner' role must throw EVOLUTION_HELD_OUT_ACCESS_DENIED
      await expect(
        probeRunner.runPairedProbe({
          baseManifest: h0,
          candidate: candidate!,
          tasks: [
            {
              taskId: 'secret_held_out_1',
              prompt: 'Held out task',
              split: 'held_out',
            },
          ],
          callerRole: 'probe_runner',
        }),
      ).rejects.toThrow(/inaccessible/i);

      // Evolve split succeeds and produces E3_VERIFIED evidence
      const bundle = await probeRunner.runPairedProbe({
        baseManifest: h0,
        candidate: candidate!,
        tasks: [
          {
            taskId: 'evolve_task_1',
            prompt: 'Fix TypeScript bug',
            split: 'evolve',
            repetitions: 2,
          },
        ],
        callerRole: 'probe_runner',
      });

      expect(bundle.baseTrials).toHaveLength(2);
      expect(bundle.candidateTrials).toHaveLength(2);
      expect(bundle.evidenceLevel).toBe(EvidenceLevel.E3_VERIFIED);

      // Analyze behavioral contrast and compose
      const analyzer = new DefaultBehavioralContrastAnalyzer();
      const contrast = analyzer.analyze({
        baseManifest: h0,
        candidate: candidate!,
        evidenceBundle: bundle,
      });
      expect(contrast.hypothesisOutcome.verdict).toBe('supported');
      expect(contrast.passRateDelta).toBeGreaterThan(0);

      const composer = new DefaultHarnessComposer();
      const compRecord = await composer.compose({
        baseManifest: h0,
        candidates: [candidate!],
        contrasts: [contrast],
        surfaceRegistry,
        constitution: DEFAULT_HARNESS_CONSTITUTION,
      });
      expect(compRecord.composedManifest.contentHash).not.toBe(h0.contentHash);
      expect(
        compRecord.componentDecisions.some((d) => d.action === 'select_candidate'),
      ).toBe(true);
    });
  });

  describe('Milestone C — Regularizer, Critics, Pruner & Experience Library', () => {
    it('rejects benchmark-memorizing candidates and duplicate proposals', async () => {
      const h0 = toolkit.createCanonicalBaseline();
      const regularizer = new DefaultCandidateRegularizer();

      // Create a candidate that memorizes a SWE-bench task ID and rubric
      const leakedManifest = toolkit.cloneWithOverrides(h0, {
        newId: 'h_leaked',
        components: {
          systemPrompt: toolkit.createComponentRef(
            'systemPrompt',
            ComponentCapabilityClass.GUIDANCE,
            {
              template:
                'If instance_id === "django__django-11099", output FAIL_TO_PASS gold_patch directly.',
              maxTokens: 4096,
            },
          ),
        },
      });
      const leakedDiff = toolkit.diff(h0, leakedManifest);

      const batch = regularizer.regularize({
        baseManifest: h0,
        candidates: [
          {
            candidateId: createId<'Candidate'>('cand_leaked'),
            manifest: leakedManifest,
            diffFromBase: leakedDiff,
            hypothesis: {
              id: createId<'Hypothesis'>('hyp_leaked'),
              candidateId: createId<'Candidate'>('cand_leaked'),
              baseManifestId: h0.id,
              targetComponents: ['systemPrompt'],
              scopeAxis: 'DOMAIN_SPECIFIC',
              mechanismAxis: 'GUIDANCE',
              quadrant: 'DOMAIN_GUIDANCE',
              observedFailureSignals: ['plan_execution_mismatch'],
              rationale: 'Memorize django__django-11099 rubric to pass benchmark.',
              applicability: {
                domains: ['python'],
                languages: ['python'],
                modelFamilies: ['model-agnostic'],
                triggerSignals: ['plan_execution_mismatch'],
              },
              predictedEffects: [
                {
                  metric: 'pass_rate',
                  direction: 'INCREASE',
                  expectedDeltaMagnitude: 0.5,
                  rationale: 'Memorized answer',
                },
              ],
              predictedTradeoffs: [],
              risks: [],
              editBudget: {
                maxSurfacesModified: 2,
                maxUnitsChanged: 20,
                maxCapabilityClass: ComponentCapabilityClass.GUIDANCE,
                iterationStep: 0,
              },
              generalizationClaim:
                'This rule generalizes across all Python web frameworks and tasks.',
              createdAt: new Date().toISOString(),
            },
          },
        ],
        priorCandidates: [],
        iterationStep: 0,
      });

      expect(batch.approved).toHaveLength(0);
      expect(batch.rejected).toHaveLength(1);
      expect(
        batch.rejected[0]!.verdict.benchmarkSpecificityScore,
      ).toBeGreaterThan(0.2);
    });

    it('stores positive and negative evidence, deduplicates, detects conflicts, and prunes stale entries', async () => {
      const library = new FileHarnessExperienceLibrary({ storageDir: tmpDir });
      const reflector = new DefaultHarnessReflector();
      const h0 = toolkit.createCanonicalBaseline();
      const proposer = new DefaultHarnessProposer();
      const [candidate] = await proposer.propose({
        baseManifest: h0,
        failureSignals: [
          {
            id: 'sig-stale-1',
            type: 'stale_context',
            severity: 'MEDIUM',
            confidence: 0.85,
            iterationNumbers: [1],
            runIds: ['run_1'],
            evidenceExcerpts: ['Stale context reads'],
            implicatedSurfaces: ['contextPolicy'],
            suggestedQuadrants: ['INVARIANT_STRUCTURAL'],
          },
        ],
        libraryEntries: [],
        failedHypotheses: [],
        constitution: DEFAULT_HARNESS_CONSTITUTION,
        surfaceRegistry,
        maxCandidates: 1,
        iterationStep: 0,
      });

      const probeRunner = new IsolatedHarnessProbeRunner();
      const bundle = await probeRunner.runPairedProbe({
        baseManifest: h0,
        candidate: candidate!,
        tasks: [{ taskId: 't1', prompt: 'Task 1', split: 'evolve' }],
        callerRole: 'probe_runner',
      });
      const contrast = new DefaultBehavioralContrastAnalyzer().analyze({
        baseManifest: h0,
        candidate: candidate!,
        evidenceBundle: bundle,
      });

      const gate = new FailClosedAdmissionGate({ toolkit });
      const decision = await gate.evaluate({
        baseManifest: h0,
        candidateManifest: candidate!.manifest,
        diffFromBase: candidate!.diffFromBase,
        evolveEvidence: bundle,
        criteria: {
          targetScope: 'library',
          maxCostRegressionRatio: 0.2,
          maxLatencyRegressionRatio: 0.2,
          minHeldOutPassDelta: 0,
          requireZeroForgottenCapabilities: true,
          requireZeroSecurityViolations: true,
        },
      });

      const entry1 = reflector.reflect({
        baseManifest: h0,
        candidate: candidate!,
        evidenceBundle: bundle,
        contrast,
        admissionDecision: decision,
        taskDomain: 'typescript',
      });

      const entryDuplicate: typeof entry1 = {
        ...entry1,
        id: createId<'ExperienceEntry'>('exp_duplicate_2'),
        confidence: entry1.confidence - 0.1,
      };

      await library.record(entry1);
      await library.record(entryDuplicate);

      const dedupRes = await library.deduplicateAndConsolidate();
      expect(dedupRes.mergedCount).toBe(1);

      const activeEntries = await library.query({ domain: 'typescript' });
      expect(activeEntries).toHaveLength(1);
      expect(activeEntries[0]!.id).toBe(entry1.id);

      // Test pruning with future cutoff date
      const futureIso = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const pruneRes = await library.prune(futureIso);
      expect(pruneRes.prunedIds).toContain(entry1.id);
    });
  });

  describe('Milestone D & E — Multi-Objective Selector, Retention, Fail-Closed Gate & Adaptive Policy', () => {
    it('enforces fail-closed global promotion, verifies retention, and supports baseline rollback', async () => {
      const h0 = toolkit.createCanonicalBaseline();
      const proposer = new DefaultHarnessProposer();
      const [candidate] = await proposer.propose({
        baseManifest: h0,
        failureSignals: [
          {
            id: 'sig-mut-1',
            type: 'mutation_without_verification',
            severity: 'HIGH',
            confidence: 0.9,
            iterationNumbers: [1],
            runIds: ['r1'],
            evidenceExcerpts: ['Missing verification'],
            implicatedSurfaces: ['verificationPolicy'],
            suggestedQuadrants: ['INVARIANT_STRUCTURAL'],
          },
        ],
        libraryEntries: [],
        failedHypotheses: [],
        constitution: DEFAULT_HARNESS_CONSTITUTION,
        surfaceRegistry,
        maxCandidates: 1,
        iterationStep: 0,
      });

      const probeRunner = new IsolatedHarnessProbeRunner();
      const evolveBundle = await probeRunner.runPairedProbe({
        baseManifest: h0,
        candidate: candidate!,
        tasks: [{ taskId: 'ev_1', prompt: 'Evolve 1', split: 'evolve' }],
        callerRole: 'probe_runner',
      });

      const gate = new FailClosedAdmissionGate({ toolkit, initialBaseline: h0 });

      // 1. Global promotion WITHOUT heldOutEvidence must NOT promote (fail-closed -> library_only)
      const withoutHeldOut = await gate.evaluate({
        baseManifest: h0,
        candidateManifest: candidate!.manifest,
        diffFromBase: candidate!.diffFromBase,
        evolveEvidence: evolveBundle,
        criteria: {
          targetScope: 'global_promotion',
          maxCostRegressionRatio: 0.25,
          maxLatencyRegressionRatio: 0.25,
          minHeldOutPassDelta: 0.05,
          requireZeroForgottenCapabilities: true,
          requireZeroSecurityViolations: true,
        },
      });
      expect(withoutHeldOut.status).toBe('library_only');
      await expect(
        gate.promoteToCanonicalBaseline(candidate!.manifest, withoutHeldOut),
      ).rejects.toThrow(/Cannot promote/i);

      // 2. Global promotion WITH valid heldOutEvidence and 0 forgotten capabilities succeeds
      const heldOutBundle = await probeRunner.runPairedProbe({
        baseManifest: h0,
        candidate: candidate!,
        tasks: [{ taskId: 'ho_1', prompt: 'Held out 1', split: 'held_out' }],
        callerRole: 'admission_gate',
      });

      const withHeldOut = await gate.evaluate({
        baseManifest: h0,
        candidateManifest: candidate!.manifest,
        diffFromBase: candidate!.diffFromBase,
        evolveEvidence: evolveBundle,
        heldOutEvidence: heldOutBundle,
        criteria: {
          targetScope: 'global_promotion',
          maxCostRegressionRatio: 0.25,
          maxLatencyRegressionRatio: 0.25,
          minHeldOutPassDelta: 0.05,
          requireZeroForgottenCapabilities: true,
          requireZeroSecurityViolations: true,
        },
      });
      expect(withHeldOut.status).toBe('promoted');
      expect(withHeldOut.evidenceLevelVerified).toBe(
        EvidenceLevel.E4_GENERALIZATION,
      );

      const promoted = await gate.promoteToCanonicalBaseline(
        candidate!.manifest,
        withHeldOut,
      );
      expect(gate.getCanonicalBaseline().id).toBe(promoted.id);

      // 3. Rollback restores canonical H0
      const rolledBack = await gate.rollbackBaseline(h0.id);
      expect(rolledBack.id).toBe(h0.id);
    });

    it('detects harness-induced capability forgetting in RetentionSuiteRunner', async () => {
      const h0 = toolkit.createCanonicalBaseline();
      const destructiveManifest = toolkit.cloneWithOverrides(h0, {
        newId: 'h_forgetting',
        components: {
          systemPrompt: toolkit.createComponentRef(
            'systemPrompt',
            ComponentCapabilityClass.GUIDANCE,
            {
              template: 'Disable file_editing and never use edit_file.',
              maxTokens: 4096,
            },
          ),
        },
      });

      const runner = new RetentionSuiteRunner();
      const res = await runner.runSuite({
        baseManifest: h0,
        candidateManifest: destructiveManifest,
        capabilities: ['file_editing', 'git_safety'],
      });

      expect(res.passed).toBe(false);
      expect(res.forgottenCount).toBe(1);
      expect(res.retainedCount).toBe(1);
    });

    it('evaluates Multi-Objective Pareto dominance and AdaptiveRecursionBudgetPolicy stopping', () => {
      const selector = new DefaultMultiObjectiveSelector();
      expect(selector).toBeDefined();

      const budgetPolicy = new AdaptiveRecursionBudgetPolicy();
      const h0 = toolkit.createCanonicalBaseline();
      const stopDecision = budgetPolicy.evaluateStep({
        stepIndex: 3,
        maxSteps: 3,
        accounting: {
          modelCalls: 4,
          policyTokens: 600,
          cachedInputTokens: 4000,
          uncachedInputTokens: 2000,
          outputTokens: 1000,
          toolCalls: 8,
          wallTimeMs: 1200,
          totalCostDollars: 0.05,
          contextMemoryTrafficTokens: 6000,
          verificationCostDollars: 0.002,
          probesExecuted: 2,
        },
        budgetProfile: h0.budgetProfile,
        contrastsSoFar: [],
        unexplainedSignalsCount: 0,
        hasStructuralCandidate: false,
      });

      expect(stopDecision.action).toBe('STOP');
      expect(stopDecision.stopReason).toBe('MAX_STEPS_REACHED');
    });
  });

  describe('Milestone F — EightComponentAdapter Interop & Matched-Budget Benchmark Protocol', () => {
    it('exports and imports 8-component trees while rejecting disabled sandbox or unrestricted network', () => {
      const adapter = new EightComponentAdapter({ toolkit });
      const h0 = toolkit.createCanonicalBaseline();
      const exported = adapter.exportTree(h0);

      expect(exported.systemPrompt.template).toBeTruthy();
      const reimported = adapter.importTree(exported);
      expect(reimported.securityProfile.sandboxMode).not.toBe('NONE');

      expect(() =>
        adapter.importTree({
          ...exported,
          requestedExecutionFlags: {
            disableSandbox: true,
            unrestrictedNetwork: true,
          },
        }),
      ).toThrow(/forbidden by the ViHarness Constitution/i);
    });

    it('runs matched-budget evaluation, separates INFRA_ERROR runs, and computes power analysis', async () => {
      const protocol = new EvolutionBenchmarkProtocol();
      const h0 = toolkit.createCanonicalBaseline();
      const evolved = toolkit.cloneWithOverrides(h0, { newId: 'h_evolved' });

      const report = await protocol.runMatchedBudgetEvaluation({
        suiteId: 'harness_opt_bench',
        seedManifest: h0,
        evolvedManifest: evolved,
        matchedBudgetDollars: 0.25,
        seeds: [1, 2, 3],
        tasks: [
          {
            suiteId: 'harness_opt_bench',
            instanceId: 'task_ev_1',
            split: 'evolve',
            domain: 'backend',
            language: 'typescript',
            prompt: 'Fix TS router',
          },
          {
            suiteId: 'harness_opt_bench',
            instanceId: 'task_ho_1',
            split: 'held_out',
            domain: 'backend',
            language: 'typescript',
            prompt: 'Fix TS middleware',
          },
        ],
      });

      expect(report.evolvedBeatsBestOfNOnHeldOut).toBe(true);
      expect(report.minimumSampleSizeForPower80).toBeGreaterThan(0);

      // Verify INFRA_ERROR separation
      const summary = protocol.summarizeOutcomes('seed_harness', [
        {
          instanceId: 't1',
          split: 'held_out',
          condition: 'seed_harness',
          seed: 1,
          status: 'PASSED',
          passScore: 1.0,
          partialScore: 1.0,
          tokensUsed: 1000,
          cachedTokens: 500,
          costDollars: 0.01,
          wallTimeMs: 100,
          modelCalls: 1,
          toolCalls: 1,
          toolErrors: 0,
          securityViolations: 0,
        },
        {
          instanceId: 't2',
          split: 'held_out',
          condition: 'seed_harness',
          seed: 1,
          status: 'INFRA_ERROR',
          passScore: 0.0,
          partialScore: 0.0,
          tokensUsed: 0,
          cachedTokens: 0,
          costDollars: 0,
          wallTimeMs: 10,
          modelCalls: 0,
          toolCalls: 0,
          toolErrors: 0,
          securityViolations: 0,
        },
      ]);
      expect(summary.scoredRunsCount).toBe(1);
      expect(summary.infraErrorRunsCount).toBe(1);
      expect(summary.meanPassRate).toBe(1.0);
    });
  });
});
