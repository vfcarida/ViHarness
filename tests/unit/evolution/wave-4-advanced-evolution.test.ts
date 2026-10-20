/**
 * Wave 4 Advanced Evolution Suite Tests:
 * - Wave 4.1: Live Runtime & Model Bridges (`ModelDrivenCandidateGenerator`, `ModelDrivenHarnessComposer`, `createRuntimeMaterializedProbeExecutor`)
 * - Wave 4.2: Discriminative Task Selection (`DiscriminativeTaskSelector` / `Task-CoEvolve`)
 * - Wave 4.3: `HarnessX` Contrastive Preference & Trajectory Exporter (`ContrastivePreferenceExporter` / `ViForge`)
 * - Wave 4.4: Dual-Layer `MemoHarness` & SQLite-Backed Experience Library (`SqliteHarnessExperienceLibrary`, `MemoHarnessSynthesizer`)
 * - Wave 4.5: `One Recipe, Many Harnesses` (`EcosystemMarginSplitter` & `runCrossModelTransferMatrix`)
 * - Wave 4.6: `AdversarialProbeGenerator` & Live TUI Evolution Stream (`renderLiveEvent`, `renderParetoFrontierTable`)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createId } from '../../../src/core/types/identifiers.js';
import type {
  ExecutionId,
  GoalId,
  HarnessId,
  IterationId,
  TaskId,
  TraceId,
} from '../../../src/core/types/identifiers.js';
import type { ModelProvider } from '../../../src/core/interfaces/model-provider.js';
import type { AgentRuntime } from '../../../src/core/interfaces/agent-runtime.js';
import {
  FinishReason,
  ModelCapability,
  ProviderHealthStatus,
  type ModelRequest,
  type ModelResponse,
  type ModelStreamChunk,
} from '../../../src/core/model/model-io.js';
import { AgentPhase } from '../../../src/core/model/state.js';
import { TerminationReason } from '../../../src/core/model/termination.js';
import type { ExecutionOptions, ExecutionResult } from '../../../src/core/model/runtime-types.js';
import type { Goal } from '../../../src/core/model/goal.js';
import { EvolutionEventType } from '../../../src/core/model/telemetry-types.js';
import {
  DEFAULT_HARNESS_CONSTITUTION,
  EvidenceLevel,
} from '../../../src/core/evolution/constitution.js';
import type { FailureSignal } from '../../../src/core/evolution/failure-taxonomy.js';
import type { ProbeTaskSpec } from '../../../src/core/evolution/interfaces.js';
import {
  DefaultHarnessSurfaceRegistry,
  HarnessManifestToolkit,
  DefaultHarnessProposer,
  IsolatedHarnessProbeRunner,
  DefaultBehavioralContrastAnalyzer,
  DefaultMultiObjectiveSelector,
  FailClosedAdmissionGate,
  DefaultHarnessReflector,
  ModelDrivenCandidateGenerator,
  ModelDrivenHarnessComposer,
  createRuntimeMaterializedProbeExecutor,
  DiscriminativeTaskSelector,
  ContrastivePreferenceExporter,
  SqliteHarnessExperienceLibrary,
  MemoHarnessSynthesizer,
  EcosystemMarginSplitter,
  AdversarialProbeGenerator,
} from '../../../src/infra/evolution/index.js';
import { SqliteStore } from '../../../src/infra/storage/sqlite-store.js';
import { EvolutionBenchmarkProtocol } from '../../../src/infra/eval/evolution-benchmark-protocol.js';
import { EvolutionTreeRenderer } from '../../../src/infra/tui/evolution-tree-renderer.js';

function createMockModelProvider(
  responder: (req: ModelRequest) => string,
): ModelProvider {
  return {
    providerId: 'mock-provider',
    descriptor: {
      id: 'claude-3-7-sonnet',
      name: 'Claude 3.7 Sonnet Mock',
      providerId: 'mock-provider',
      version: '1.0',
      capabilities: {
        capabilities: new Set([
          ModelCapability.REASONING,
          ModelCapability.CODING,
          ModelCapability.STRUCTURED_OUTPUT,
        ]),
        maxContextTokens: 128_000,
        maxOutputTokens: 8_192,
        supportsSystemPrompt: true,
      },
      costPer1kInputTokensDollars: 0.003,
      costPer1kOutputTokensDollars: 0.015,
    },
    async complete(request: ModelRequest): Promise<ModelResponse> {
      return {
        requestId: 'req-mock-1',
        providerId: 'mock-provider',
        modelId: request.modelId ?? 'claude-3-7-sonnet',
        content: responder(request),
        toolCalls: [],
        usage: {
          inputTokens: 200,
          outputTokens: 80,
          totalTokens: 280,
        },
        finishReason: FinishReason.STOP,
        latencyMs: 25,
        estimatedCostDollars: 0.0018,
      };
    },
    async *stream(_request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      yield { deltaText: '{}' };
    },
    async getHealth() {
      return {
        providerId: 'mock-provider',
        status: ProviderHealthStatus.HEALTHY,
        lastChecked: new Date(),
      };
    },
  };
}

describe('Wave 4 — Advanced Self-Evolving Harness Capabilities', () => {
  let tmpDir: string;
  const surfaceRegistry = new DefaultHarnessSurfaceRegistry();
  const baseManifest = HarnessManifestToolkit.createCanonicalBaselineManifest();

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vi-wave4-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Wave 4.1: Live Runtime & Model Bridges
  // -------------------------------------------------------------------------
  describe('Wave 4.1 — Live Runtime & Model Bridges', () => {
    it('ModelDrivenCandidateGenerator performs progressive trace disclosure and validates LLM JSON proposals', async () => {
      const disclosedRefs: string[] = [];
      const mockProvider = createMockModelProvider(() =>
        JSON.stringify({
          targetSurface: 'toolGuidance',
          rationale: 'Enforce verification check immediately after file edits.',
          generalizationClaim: 'Transfers across TypeScript and Python repositories.',
          permissions: ['workspace:read'],
          componentContent:
            'Always run verification suite after edit_file and inspect output before completion.',
        }),
      );

      const generator = new ModelDrivenCandidateGenerator({
        modelProvider: mockProvider,
        traceSnippetLoader: async (ref) => {
          disclosedRefs.push(ref);
          return `Raw trace snippet for ${ref}`;
        },
      });

      const signals: FailureSignal[] = [
        {
          id: 'sig-1',
          type: 'mutation_without_verification',
          severity: 'HIGH',
          confidence: 0.9,
          iterationNumbers: [2, 3],
          runIds: ['run-1'],
          evidenceExcerpts: ['iter-3-edit'],
          implicatedSurfaces: ['toolGuidance'],
          suggestedQuadrants: ['INVARIANT_GUIDANCE'],
        },
      ];

      const proposer = new DefaultHarnessProposer({
        customGenerator: generator,
      });

      const candidates = await proposer.propose({
        baseManifest,
        failureSignals: signals,
        libraryEntries: [],
        failedHypotheses: [],
        constitution: DEFAULT_HARNESS_CONSTITUTION,
        surfaceRegistry,
        maxCandidates: 2,
        iterationStep: 1,
      });

      expect(disclosedRefs).toContain('iter-3-edit');
      expect(candidates.length).toBeGreaterThanOrEqual(1);
      expect(candidates[0]?.diffFromBase.changedSurfaces).toContain('toolGuidance');
      expect(candidates[0]?.hypothesis.rationale).toContain(
        'Enforce verification check',
      );
    });

    it('ModelDrivenHarnessComposer composes supported candidates and falls back safely on invalid LLM JSON', async () => {
      const proposer = new DefaultHarnessProposer();
      const candidates = await proposer.propose({
        baseManifest,
        failureSignals: [
          {
            id: 'sig-osc',
            type: 'oscillation',
            severity: 'HIGH',
            confidence: 0.9,
            iterationNumbers: [1, 2],
            runIds: ['run-1'],
            evidenceExcerpts: ['iter-1'],
            implicatedSurfaces: ['routingPolicy'],
            suggestedQuadrants: ['INVARIANT_STRUCTURAL'],
          },
        ],
        libraryEntries: [],
        failedHypotheses: [],
        constitution: DEFAULT_HARNESS_CONSTITUTION,
        surfaceRegistry,
        maxCandidates: 2,
        iterationStep: 1,
      });

      const probeRunner = new IsolatedHarnessProbeRunner();
      const analyzer = new DefaultBehavioralContrastAnalyzer();
      const tasks: ProbeTaskSpec[] = [
        {
          taskId: 't-evolve-1',
          prompt: 'Fix architectural oscillation bug',
          split: 'evolve',
        },
      ];

      const contrasts = [];
      for (const cand of candidates) {
        const bundle = await probeRunner.runPairedProbe({
          baseManifest,
          candidate: cand,
          tasks,
          callerRole: 'probe_runner',
        });
        contrasts.push(
          analyzer.analyze({
            baseManifest,
            candidate: cand,
            evidenceBundle: bundle,
          }),
        );
      }

      const firstCandidate = candidates[0];
      expect(firstCandidate).toBeDefined();

      const validProvider = createMockModelProvider(() =>
        JSON.stringify({
          decisions: [
            {
              surfaceId: firstCandidate?.diffFromBase.changedSurfaces[0] ?? 'toolGuidance',
              action: 'select_candidate',
              selectedManifestIds: [firstCandidate?.manifest.id ?? ''],
              rationale: 'Empirical contrast supported this surface.',
            },
          ],
        }),
      );

      const composer = new ModelDrivenHarnessComposer({
        modelProvider: validProvider,
      });

      const record = await composer.compose({
        baseManifest,
        candidates,
        contrasts,
        surfaceRegistry,
        constitution: DEFAULT_HARNESS_CONSTITUTION,
      });

      expect(record.composedManifest.id).not.toBe(baseManifest.id);
      expect(record.componentDecisions.length).toBeGreaterThan(0);

      // Test fallback when LLM returns malformed output
      const brokenComposer = new ModelDrivenHarnessComposer({
        modelProvider: createMockModelProvider(() => 'NOT_VALID_JSON'),
      });
      const fallbackRecord = await brokenComposer.compose({
        baseManifest,
        candidates,
        contrasts,
        surfaceRegistry,
        constitution: DEFAULT_HARNESS_CONSTITUTION,
      });
      expect(fallbackRecord.composedManifest).toBeDefined();
    });

    it('createRuntimeMaterializedProbeExecutor materializes ExecutionOptions and maps AgentRuntime results to ProbeTrialMetrics', async () => {
      const capturedOptions: ExecutionOptions[] = [];

      const mockRuntime: AgentRuntime = {
        async execute(goal: Goal, options?: ExecutionOptions): Promise<ExecutionResult> {
          if (options) capturedOptions.push(options);
          const isCandidate = String(goal.metadata['manifestId'] ?? '').includes('cand');
          return {
            executionId: createId<'Execution'>('exec_1') as ExecutionId,
            goalId: goal.id as GoalId,
            taskId: createId<'Task'>('task_1') as TaskId,
            success: isCandidate,
            status: isCandidate ? 'COMPLETED' : 'FAILED',
            summary: isCandidate ? 'Verified pass' : 'Failed baseline',
            iterationCount: 2,
            durationMs: 420,
            totalCostDollars: 0.012,
            totalTokens: 3200,
            iterations: [
              {
                iterationId: createId<'Iteration'>('iter_1') as IterationId,
                sequenceNumber: 1,
                startedAt: new Date(),
                completedAt: new Date(),
                stateBefore: AgentPhase.EXPLORE,
                stateAfter: AgentPhase.DONE,
                modelId: 'claude-3-7-sonnet',
                providerId: 'anthropic',
                actionProposed: null,
                toolResults: [],
                evidenceCreated: [],
                tokenUsage: {
                  inputTokens: 2600,
                  outputTokens: 600,
                  totalTokens: 3200,
                  cacheReadTokens: 1800,
                },
                costDollars: 0.012,
                terminationDecision: {
                  shouldTerminate: true,
                  reason: TerminationReason.GOAL_COMPLETED,
                  explanation: 'Completed',
                  decidedAt: new Date(),
                },
              },
            ],
          };
        },
        async pause() {},
        async resume() {
          throw new Error('Not used');
        },
        async cancel() {},
        getStatus() {
          return 'COMPLETED';
        },
        subscribe() {
          return () => {};
        },
      };

      const trialExecutor = createRuntimeMaterializedProbeExecutor({
        runtimeFactory: () => mockRuntime,
      });

      const proposer = new DefaultHarnessProposer();
      const [candidate] = await proposer.propose({
        baseManifest,
        failureSignals: [
          {
            id: 'sig-1',
            type: 'oscillation',
            severity: 'HIGH',
            confidence: 0.9,
            iterationNumbers: [1],
            runIds: ['run-1'],
            evidenceExcerpts: [],
            implicatedSurfaces: ['routingPolicy'],
            suggestedQuadrants: ['INVARIANT_STRUCTURAL'],
          },
        ],
        libraryEntries: [],
        failedHypotheses: [],
        constitution: DEFAULT_HARNESS_CONSTITUTION,
        surfaceRegistry,
        maxCandidates: 1,
        iterationStep: 1,
      });

      expect(candidate).toBeDefined();
      const runner = new IsolatedHarnessProbeRunner({ trialExecutor });
      const bundle = await runner.runPairedProbe({
        baseManifest,
        candidate: candidate!,
        tasks: [
          {
            taskId: 'runtime-bridge-task',
            prompt: 'Fix parser issue',
            split: 'evolve',
          },
        ],
        callerRole: 'probe_runner',
      });

      expect(capturedOptions.length).toBe(2);
      expect(bundle.baseTrials[0]?.success).toBe(false);
      expect(bundle.candidateTrials[0]?.success).toBe(true);
      expect(bundle.evidenceLevel).toBe(EvidenceLevel.E3_VERIFIED);
    });
  });

  // -------------------------------------------------------------------------
  // Wave 4.2: Discriminative Task Selection (Task-CoEvolve)
  // -------------------------------------------------------------------------
  describe('Wave 4.2 — Discriminative Task Selection (Task-CoEvolve)', () => {
    it('prioritizes maximum-entropy tasks over trivial (100% pass) and impossible (0% pass) tasks while blocking held_out tasks', () => {
      const selector = new DiscriminativeTaskSelector();

      // Task 1: trivial (100% pass rate -> entropy = 0)
      for (let i = 0; i < 4; i++) {
        selector.recordObservation({
          manifestId: `m-${i}`,
          taskId: 'task-trivial',
          success: true,
          partialScore: 1.0,
          costDollars: 0.01,
          failureSignalsObserved: [],
        });
      }

      // Task 2: impossible (0% pass rate -> entropy = 0)
      for (let i = 0; i < 4; i++) {
        selector.recordObservation({
          manifestId: `m-${i}`,
          taskId: 'task-impossible',
          success: false,
          partialScore: 0.0,
          costDollars: 0.03,
          failureSignalsObserved: ['tool_error'],
        });
      }

      // Task 3: highly discriminative (50% pass rate -> entropy = 1.0, high variance)
      for (let i = 0; i < 4; i++) {
        const pass = i % 2 === 0;
        selector.recordObservation({
          manifestId: `m-${i}`,
          taskId: 'task-discriminative',
          success: pass,
          partialScore: pass ? 0.95 : 0.25,
          costDollars: 0.01,
          failureSignalsObserved: pass ? [] : ['oscillation'],
        });
      }

      const allTasks: ProbeTaskSpec[] = [
        { taskId: 'task-trivial', prompt: 'Simple task', split: 'evolve' },
        { taskId: 'task-impossible', prompt: 'Hard task', split: 'evolve' },
        {
          taskId: 'task-discriminative',
          prompt: 'Multi-file refactor task',
          split: 'evolve',
        },
        {
          taskId: 'task-held-out-secret',
          prompt: 'Held-out evaluation task',
          split: 'held_out',
        },
      ];

      const selection = selector.selectDiscriminativeSubset({
        tasks: allTasks,
        maxTasks: 1,
      });

      expect(selection.totalEligibleTasks).toBe(3); // held_out excluded
      expect(selection.selectedTasks).toHaveLength(1);
      expect(selection.selectedTasks[0]?.taskId).toBe('task-discriminative');
      expect(selection.rankedMetrics[0]?.shannonEntropy).toBe(1.0);
      expect(selection.estimatedComputeSavingsRatio).toBeCloseTo(0.6667, 3);
    });
  });

  // -------------------------------------------------------------------------
  // Wave 4.3: HarnessX Contrastive Preference & Trajectory Exporter (ViForge)
  // -------------------------------------------------------------------------
  describe('Wave 4.3 — HarnessX Contrastive Preference & Trajectory Exporter (ViForge)', () => {
    it('exports DPO pairs, GRPO group rollouts, diagnoses Model Capability Ceilings, and writes JSONL files', async () => {
      const proposer = new DefaultHarnessProposer();
      const candidates = await proposer.propose({
        baseManifest,
        failureSignals: [
          {
            id: 'sig-1',
            type: 'oscillation',
            severity: 'HIGH',
            confidence: 0.9,
            iterationNumbers: [1, 2],
            runIds: ['run-1'],
            evidenceExcerpts: [],
            implicatedSurfaces: ['routingPolicy'],
            suggestedQuadrants: ['INVARIANT_STRUCTURAL'],
          },
        ],
        libraryEntries: [],
        failedHypotheses: [],
        constitution: DEFAULT_HARNESS_CONSTITUTION,
        surfaceRegistry,
        maxCandidates: 3,
        iterationStep: 1,
      });

      const probeRunner = new IsolatedHarnessProbeRunner();
      const bundle = await probeRunner.runPairedProbe({
        baseManifest,
        candidate: candidates[0]!,
        tasks: [
          {
            taskId: 'viforge-task-1',
            prompt: 'Optimize spectral adapter routing',
            split: 'evolve',
          },
        ],
        callerRole: 'probe_runner',
      });

      const exporter = new ContrastivePreferenceExporter({
        minEvidenceLevel: EvidenceLevel.E3_VERIFIED,
        minPreferenceMargin: 0.05,
        ceilingMinCandidates: 2,
      });

      const dpoPairs = exporter.extractDpoPreferencePairs({
        baseManifest,
        candidateManifest: candidates[0]!.manifest,
        evidenceBundle: bundle,
        taskPromptsById: { 'viforge-task-1': 'Optimize spectral adapter routing' },
      });

      expect(dpoPairs.length).toBe(1);
      expect(dpoPairs[0]?.chosen.manifestId).toBe(candidates[0]!.manifest.id);
      expect(dpoPairs[0]?.rejected.manifestId).toBe(baseManifest.id);
      expect(dpoPairs[0]?.preferenceMargin).toBeGreaterThan(0.05);

      const grpoGroups = exporter.extractGrpoRolloutGroups({
        baseManifest,
        evaluations: [{ candidateManifest: candidates[0]!.manifest, evidenceBundle: bundle }],
      });
      expect(grpoGroups.length).toBe(1);
      expect(grpoGroups[0]?.rollouts.length).toBe(2);

      // Simulate a Model Capability Ceiling where candidates fail to improve pass rate
      const zeroGainAnalyzer = new DefaultBehavioralContrastAnalyzer();
      const failedBundle = {
        ...bundle,
        candidateTrials: bundle.baseTrials.map((t) => ({
          ...t,
          success: false,
          verifierPassed: false,
          partialScore: 0.3,
          failureSignalsObserved: ['oscillation' as const],
        })),
      };
      const ceilingContrasts = candidates.map((cand) =>
        zeroGainAnalyzer.analyze({
          baseManifest,
          candidate: cand,
          evidenceBundle: failedBundle,
        }),
      );

      const ceilingResult = exporter.diagnoseCapabilityCeilingAndExtractSpin({
        candidates,
        contrasts: ceilingContrasts,
        evidenceBundles: [failedBundle],
      });

      expect(ceilingResult.diagnosis.ceilingDetected).toBe(true);
      expect(ceilingResult.diagnosis.persistentFailureSignals).toContain('oscillation');
      expect(ceilingResult.spinRecords.length).toBeGreaterThan(0);

      const exportedFiles = await exporter.exportToJsonlFiles({
        outputDir: tmpDir,
        dpoRecords: dpoPairs,
        grpoGroups,
        spinRecords: ceilingResult.spinRecords,
      });

      const dpoContent = await fs.readFile(exportedFiles.dpoFilePath, 'utf-8');
      expect(dpoContent.trim().split('\n')).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Wave 4.4: Dual-Layer MemoHarness & SQLite-Backed Experience Library
  // -------------------------------------------------------------------------
  describe('Wave 4.4 — Dual-Layer MemoHarness & SQLite-Backed Experience Library', () => {
    it('stores, queries, deduplicates, semantically retrieves in SQLite, and synthesizes zero-search MemoHarness manifests', async () => {
      const dbPath = path.join(tmpDir, 'evo-exp.sqlite');
      const store = new SqliteStore();
      await store.open(dbPath);

      try {
        const sqliteLibrary = new SqliteHarnessExperienceLibrary({ store });
        const proposer = new DefaultHarnessProposer();
        const [candidate] = await proposer.propose({
          baseManifest,
          failureSignals: [
            {
              id: 'sig-1',
              type: 'repeated_tool_call',
              severity: 'MEDIUM',
              confidence: 0.85,
              iterationNumbers: [1, 2],
              runIds: ['run-1'],
              evidenceExcerpts: [],
              implicatedSurfaces: ['toolGuidance'],
              suggestedQuadrants: ['INVARIANT_GUIDANCE'],
            },
          ],
          libraryEntries: [],
          failedHypotheses: [],
          constitution: DEFAULT_HARNESS_CONSTITUTION,
          surfaceRegistry,
          maxCandidates: 1,
          iterationStep: 1,
        });

        const runner = new IsolatedHarnessProbeRunner();
        const bundle = await runner.runPairedProbe({
          baseManifest,
          candidate: candidate!,
          tasks: [
            {
              taskId: 'sql-task-1',
              prompt: 'Fix repeated tool calls in typescript service',
              split: 'held_out',
              repetitions: 2,
            },
          ],
          callerRole: 'admission_gate',
        });

        const analyzer = new DefaultBehavioralContrastAnalyzer();
        const contrast = analyzer.analyze({
          baseManifest,
          candidate: candidate!,
          evidenceBundle: bundle,
        });

        const gate = new FailClosedAdmissionGate({ initialBaseline: baseManifest });
        const decision = await gate.evaluate({
          baseManifest,
          candidateManifest: candidate!.manifest,
          diffFromBase: candidate!.diffFromBase,
          evolveEvidence: bundle,
          heldOutEvidence: bundle,
          criteria: {
            targetScope: 'library',
            maxCostRegressionRatio: 0.2,
            maxLatencyRegressionRatio: 0.2,
            minHeldOutPassDelta: 0.0,
            requireZeroForgottenCapabilities: false,
            requireZeroSecurityViolations: true,
          },
        });


        const reflector = new DefaultHarnessReflector();
        const entry = reflector.reflect({
          baseManifest,
          candidate: candidate!,
          evidenceBundle: bundle,
          contrast,
          admissionDecision: decision,
          taskDomain: 'general-swe',
        });

        await sqliteLibrary.record(entry);

        const fetched = await sqliteLibrary.get(entry.id);
        expect(fetched?.id).toBe(entry.id);

        const semanticMatches = await sqliteLibrary.retrieveBySemanticSimilarity({
          prompt: 'typescript service tool coordination and repeated_tool_call',
          domain: 'general-swe',
          language: 'typescript',
        });
        expect(semanticMatches.length).toBe(1);
        expect(semanticMatches[0]?.combinedRelevance).toBeGreaterThan(0.4);

        const memoSynthesizer = new MemoHarnessSynthesizer({
          library: sqliteLibrary,
          minZeroSearchConfidence: 0.7,
        });

        const synthesis = await memoSynthesizer.synthesizeForTask({
          baseManifest,
          taskId: 'incoming-fast-task',
          prompt: 'Fix TypeScript service bug without repeated tool calls',
          domain: 'general-swe',
          language: 'typescript',
        });

        expect(synthesis.mode).toBe('ZERO_SEARCH_SYNTHESIS');
        expect(synthesis.appliedSurfaces).toContain('toolGuidance');
        expect(synthesis.synthesizedManifest.id).toContain('harness-memo-incoming-fast-task');
      } finally {
        await store.close();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Wave 4.5: One Recipe, Many Harnesses (EcosystemMarginSplitter & Transfer Matrix)
  // -------------------------------------------------------------------------
  describe('Wave 4.5 — One Recipe, Many Harnesses: Core vs Ecosystem Margin & Transfer Matrix', () => {
    it('splits a HarnessManifest into TransferableCore + EcosystemMargin, recombines across models, and computes the cross-model transfer matrix', async () => {
      const splitter = new EcosystemMarginSplitter();
      const { core, margin } = splitter.split(baseManifest);

      expect(core.coreId).toMatch(/^core_/);
      expect(margin.marginId).toMatch(/^margin_/);

      const recombined = splitter.recombine({
        baseManifest,
        core,
        margin,
        newManifestId: 'harness-transferred-gemini-2-5-pro' as HarnessId,
        targetProfileOverride: {
          modelFamily: 'gemini-2.5-pro',
          language: 'python',
        },
      });

      expect(recombined.target.modelFamily).toBe('gemini-2.5-pro');
      expect(recombined.target.language).toBe('python');
      expect(() => HarnessManifestToolkit.assertValid(recombined)).not.toThrow();

      const protocol = new EvolutionBenchmarkProtocol();
      const matrixReport = await protocol.runCrossModelTransferMatrix({
        models: ['claude-3-7-sonnet', 'gemini-2.5-pro'],
        manifestsByModel: {
          'claude-3-7-sonnet': baseManifest,
          'gemini-2.5-pro': recombined,
        },
        tasks: [
          {
            suiteId: 'harness_opt_bench',
            instanceId: 'xfer-1',
            split: 'held_out',
            domain: 'general-swe',
            language: 'python',
            prompt: 'Cross-model transfer benchmark task',
          },
        ],
        matchedBudgetDollars: 0.1,
      });

      expect(matrixReport.cells).toHaveLength(4);
      expect(matrixReport.transferRetentionRatio).toBeGreaterThan(0.8);
    });
  });

  // -------------------------------------------------------------------------
  // Wave 4.6: AdversarialProbeGenerator & Live TUI Evolution Stream
  // -------------------------------------------------------------------------
  describe('Wave 4.6 — AdversarialProbeGenerator & Live TUI Evolution Stream', () => {
    it('generates counterfactual adversarial tasks, blocks held_out leakage, detects coincidental passes, and renders live TUI events & Pareto tables', async () => {
      const generator = new AdversarialProbeGenerator();

      const seedTask: ProbeTaskSpec = {
        taskId: 'seed-task-1',
        prompt: 'Implement binary search helper',
        split: 'evolve',
      };

      const cfTasks = generator.generateCounterfactualTasks({ seedTask });
      expect(cfTasks).toHaveLength(3);
      expect(cfTasks.map((t) => t.perturbationType)).toEqual([
        'EDGE_CASE_INJECTION',
        'IDENTIFIER_RENAMING_TRAP',
        'STRICT_REGRESSION_ASSERTION',
      ]);

      expect(() =>
        generator.generateCounterfactualTasks({
          seedTask: { ...seedTask, split: 'held_out' },
        }),
      ).toThrow(/held_out/);

      const proposer = new DefaultHarnessProposer();
      const [candidate] = await proposer.propose({
        baseManifest,
        failureSignals: [],
        libraryEntries: [],
        failedHypotheses: [],
        constitution: DEFAULT_HARNESS_CONSTITUTION,
        surfaceRegistry,
        maxCandidates: 1,
        iterationStep: 1,
      });

      const runner = new IsolatedHarnessProbeRunner();
      const standardBundle = await runner.runPairedProbe({
        baseManifest,
        candidate: candidate!,
        tasks: [seedTask],
        callerRole: 'probe_runner',
      });

      const brittleCfBundle = {
        ...standardBundle,
        candidateTrials: standardBundle.candidateTrials.map((t) => ({
          ...t,
          success: false,
          verifierPassed: false,
          partialScore: 0.2,
        })),
      };

      const robustness = generator.evaluateCounterfactualRobustness({
        standardBundle,
        counterfactualBundle: brittleCfBundle,
      });
      expect(robustness.coincidentalPassDetected).toBe(true);
      expect(robustness.robustnessDrop).toBe(1.0);

      // Test TUI live event and Pareto table rendering
      const renderer = new EvolutionTreeRenderer();
      const liveLine = renderer.renderLiveEvent({
        eventType: EvolutionEventType.CandidateProposed,
        traceId: createId<'Trace'>('trace_1') as TraceId,
        evolutionRunId: 'run-live-1',
        candidateId: candidate!.candidateId,
        manifestId: candidate!.manifest.id,
        timestamp: '2026-10-20T15:00:00.000Z',
        attributes: { quadrant: candidate!.hypothesis.quadrant },
      });
      expect(liveLine).toContain('[EVO:CandidateProposed]');
      expect(liveLine).toContain('run=run-live-1');

      const analyzer = new DefaultBehavioralContrastAnalyzer();
      const contrast = analyzer.analyze({
        baseManifest,
        candidate: candidate!,
        evidenceBundle: standardBundle,
      });
      const selector = new DefaultMultiObjectiveSelector();
      const selectionResult = selector.select({
        baseManifest,
        candidates: [
          {
            manifest: candidate!.manifest,
            evidenceBundle: standardBundle,
            contrast,
          },
        ],
        profile: 'balanced',
      });

      const paretoTable = renderer.renderParetoFrontierTable(selectionResult);
      expect(paretoTable).toContain('Multi-Objective Pareto Frontier (Profile: balanced)');
      expect(paretoTable).toContain(candidate!.manifest.id.slice(0, 20));
    });
  });
});
