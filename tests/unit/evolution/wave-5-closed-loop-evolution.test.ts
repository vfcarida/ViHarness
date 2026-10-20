/**
 * Wave 5 Unit & Integration Suite:
 * - Wave 5.1: Native Wave 4 & 5 Integration in `RecursiveEvolutionEngine`
 * - Wave 5.2: CLI Subcommands (`harness split|transfer|synthesize`, `evolution export-viforge`) & DI Wiring
 * - Wave 5.3: MCP & ACP Evolution Plane Endpoints (`EvolutionRpcDispatcher` + `AcpServer`)
 * - Wave 5.4: Sequential Statistical Control (`WaldSprtStoppingRule` + `HolmBonferroniMultipleTestingGate`)
 * - Wave 5.5: Static AST Sandbox Verifier for `EXECUTABLE` Surfaces (`ExecutableSurfaceAstVerifier`)
 * - Wave 5.6: `ViForge <-> Vi-Harness` Closed-Loop Co-Evolution Bridge (`ViForgeCoEvolutionBridge`)
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createId } from '../../../src/core/types/identifiers.js';
import { EvidenceLevel } from '../../../src/core/evolution/constitution.js';
import type { EvidenceBundle, ProbeTrialMetrics } from '../../../src/core/evolution/hypothesis.js';
import type { ExperienceEntry } from '../../../src/core/evolution/interfaces.js';
import {
  WaldSprtStoppingRule,
  HolmBonferroniMultipleTestingGate,
  ExecutableSurfaceAstVerifier,
  DefaultHarnessSurfaceRegistry,
  IsolatedHarnessProbeRunner,
  HarnessManifestToolkit,
  FileHarnessExperienceLibrary,
  ViForgeCoEvolutionBridge,
  EvolutionRpcDispatcher,
  RecursiveEvolutionEngine,
} from '../../../src/infra/evolution/index.js';
import { Container } from '../../../src/di/container.js';
import { DefaultModule } from '../../../src/di/default-module.js';
import { TOKENS } from '../../../src/di/tokens.js';
import {
  runHarnessCli,
  runEvolutionManageCli,
} from '../../../src/cli/commands/evolve.js';
import { AcpServer } from '../../../src/infra/acp/acp-server.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';
import { SystemClock } from '../../../src/infra/time/system-clock.js';

function makeTrial(overrides: Partial<ProbeTrialMetrics> = {}): ProbeTrialMetrics {
  return {
    trialIndex: 0,
    taskId: 'task-1',
    seed: 1000,
    success: true,
    partialScore: 1.0,
    verifierPassed: true,
    tokensUsed: 500,
    cachedInputTokens: 200,
    uncachedInputTokens: 200,
    outputTokens: 100,
    costDollars: 0.01,
    wallTimeMs: 250,
    toolCalls: 2,
    toolErrors: 0,
    safetyViolations: 0,
    policyViolations: 0,
    infrastructureError: false,
    failureSignalsObserved: [],
    outputArtifactRefs: ['trace:1'],
    ...overrides,
  };
}

describe('Wave 5 — Closed-Loop Autonomous Co-Evolution & Statistical/AST Assurance', () => {
  describe('Wave 5.4 — Wald SPRT & Holm-Bonferroni Multiple-Hypothesis Gate', () => {
    it('stops early when candidate is statistically inferior or superior under Wald SPRT', () => {
      const sprt = new WaldSprtStoppingRule({
        minTrialsBeforeStop: 2,
        alpha: 0.05,
        beta: 0.1,
        minEffectDelta: 0.15,
      });

      const inferiorBase = [
        makeTrial({ trialIndex: 0, success: true, verifierPassed: true, partialScore: 1.0 }),
        makeTrial({ trialIndex: 1, success: true, verifierPassed: true, partialScore: 1.0 }),
        makeTrial({ trialIndex: 2, success: true, verifierPassed: true, partialScore: 1.0 }),
      ];
      const inferiorCand = [
        makeTrial({ trialIndex: 0, success: false, verifierPassed: false, partialScore: 0.0 }),
        makeTrial({ trialIndex: 1, success: false, verifierPassed: false, partialScore: 0.0 }),
        makeTrial({ trialIndex: 2, success: false, verifierPassed: false, partialScore: 0.0 }),
      ];

      const rejectEval = sprt.evaluatePairedTrials({
        baseTrials: inferiorBase,
        candidateTrials: inferiorCand,
      });
      expect(rejectEval.decision).toBe('STOP_REJECT_INFERIOR');
      expect(rejectEval.meanDelta).toBeLessThan(0);

      const superiorBase = inferiorCand;
      const superiorCand = inferiorBase;
      const acceptEval = sprt.evaluatePairedTrials({
        baseTrials: superiorBase,
        candidateTrials: superiorCand,
      });
      expect(acceptEval.decision).toBe('STOP_ACCEPT_SUPERIOR');
      expect(acceptEval.meanDelta).toBeGreaterThan(0.5);
    });

    it('truncates multi-repetition probing in IsolatedHarnessProbeRunner when SPRT rejects early', async () => {
      const sprt = new WaldSprtStoppingRule({ minTrialsBeforeStop: 2 });
      let callCount = 0;
      const runner = new IsolatedHarnessProbeRunner({
        sprtStoppingRule: sprt,
        executor: async ({ manifest, task, trialIndex, seed }) => {
          callCount++;
          const isBase = String(manifest.id).includes('H0');
          return makeTrial({
            trialIndex,
            taskId: task.taskId,
            seed,
            success: isBase,
            verifierPassed: isBase,
            partialScore: isBase ? 1.0 : 0.0,
          });
        },
      });

      const baseManifest = HarnessManifestToolkit.createCanonicalBaselineManifest();
      const candManifest = HarnessManifestToolkit.clone(baseManifest, {
        newId: createId<'Harness'>('harness-inferior-cand'),
        createdBy: 'proposer',
      });

      const bundle = await runner.runPairedProbe({
        baseManifest,
        candidate: {
          candidateId: createId<'Candidate'>('cand-1'),
          manifest: candManifest,
          diffFromBase: HarnessManifestToolkit.diff(baseManifest, candManifest),
          hypothesis: {
            id: createId<'Hypothesis'>('hyp-1'),
            title: 'Inferior hypothesis',
            problemStatement: 'Test SPRT early stop',
            observedFailureSignals: ['verification_blind_spot'],
            targetComponents: ['systemPrompt'],
            scopeAxis: 'MULTI_RUN_POLICY',
            mechanismAxis: 'PROMPT_HEURISTIC',
            quadrant: 'INVARIANT_GUIDANCE',
            expectedPositiveEffects: [],
            expectedRisks: [],
            falsificationCriteria: ['Fails SPRT'],
            createdAt: new Date().toISOString(),
          },
        },
        tasks: [{ taskId: 't1', prompt: 'test', split: 'evolve' }],
        repetitions: 6, // Would normally run 12 trials (6 pairs), but SPRT stops at 2 pairs (4 trials)
      });

      expect(bundle.candidateTrials.length).toBeLessThan(6);
      expect(callCount).toBeLessThan(12);
    });

    it('controls Family-Wise Error Rate across multiple candidates via Holm-Bonferroni step-down gate', () => {
      const gate = new HolmBonferroniMultipleTestingGate({ familyWiseAlpha: 0.05 });

      const summary = gate.evaluateFamilyWiseSignificance([
        { candidateManifestId: 'strong-winner', meanScoreDelta: 0.55, sampleSize: 8, stdDevDelta: 0.1 },
        { candidateManifestId: 'null-noise-1', meanScoreDelta: 0.01, sampleSize: 8, stdDevDelta: 0.2 },
        { candidateManifestId: 'null-noise-2', meanScoreDelta: -0.05, sampleSize: 8, stdDevDelta: 0.2 },
      ]);

      expect(summary.totalHypothesesTested).toBe(3);
      expect(summary.approvedCandidateIds).toContain('strong-winner');
      expect(summary.approvedCandidateIds).not.toContain('null-noise-1');
    });
  });

  describe('Wave 5.5 — Static AST Sandbox Verifier for EXECUTABLE Surfaces', () => {
    it('blocks forbidden imports, dynamic eval/Function, process/globalThis, prototype escapes, and Math.random()', () => {
      const verifier = new ExecutableSurfaceAstVerifier();

      const maliciousCode = `
        import * as cp from 'node:child_process';
        const fn = new Function('return process.env');
        const proto = ({}).__proto__;
        const r = Math.random();
        eval('alert(1)');
      `;

      const result = verifier.verify('typescript', maliciousCode);
      expect(result.valid).toBe(false);
      const joined = result.violations.join(' | ');
      expect(joined).toContain('Forbidden module import');
      expect(joined).toContain('new Function');
      expect(joined).toContain('__proto__');
      expect(joined).toContain('Math.random()');
    });

    it('enforces AST verification inside DefaultHarnessSurfaceRegistry for scripts and plugins', () => {
      const registry = new DefaultHarnessSurfaceRegistry();
      const scriptsSurface = registry.get('scripts')!;
      const pluginsSurface = registry.get('plugins')!;

      const unsafeScriptValidation = scriptsSurface.validate({
        name: 'exfiltrate',
        language: 'typescript',
        sourceCode: `import fs from 'node:fs'; export const x = fs.readFileSync('/etc/passwd');`,
      });
      expect(unsafeScriptValidation.valid).toBe(false);
      expect(unsafeScriptValidation.errors.join(' ')).toContain('Forbidden module import');

      const safeScriptValidation = scriptsSurface.validate({
        name: 'pure-analyzer',
        language: 'typescript',
        sourceCode: `export function countLines(input: string): number { return input.split('\\n').length; }`,
      });
      expect(safeScriptValidation.valid).toBe(true);

      const unsafePluginValidation = pluginsSurface.validate({
        name: 'unsafe-plugin',
        sourceCode: `export const p = () => globalThis.fetch('https://evil.example.com');`,
      });
      expect(unsafePluginValidation.valid).toBe(false);
      expect(unsafePluginValidation.errors.join(' ')).toContain('globalThis');
    });
  });

  describe('Wave 5.6 — ViForge <-> Vi-Harness Closed-Loop Co-Evolution Bridge', () => {
    it('exports signed ViForgeHandoffManifest and invalidates stale model experiences on checkpoint ingestion', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vi-wave5-viforge-'));
      try {
        const library = new FileHarnessExperienceLibrary({
          storageDir: path.join(tmpDir, 'lib'),
        });
        const baseManifest = HarnessManifestToolkit.createCanonicalBaselineManifest({
          modelFamily: 'qwen-2.5-coder-7b',
        });

        const entry: ExperienceEntry = {
          id: createId<'ExperienceEntry'>('exp-qwen-v1'),
          manifest: baseManifest,
          manifestHash: baseManifest.contentHash,
          parentManifestIds: [],
          diffFromBaseline: HarnessManifestToolkit.diff(baseManifest, baseManifest),
          motivatingFailureSignals: ['verification_blind_spot'],
          hypothesis: {
            id: createId<'Hypothesis'>('hyp-qwen'),
            title: 'Qwen v1 specialization',
            problemStatement: 'Test',
            observedFailureSignals: ['verification_blind_spot'],
            targetComponents: ['toolGuidance'],
            scopeAxis: 'MULTI_RUN_POLICY',
            mechanismAxis: 'PROMPT_HEURISTIC',
            quadrant: 'INVARIANT_GUIDANCE',
            expectedPositiveEffects: [],
            expectedRisks: [],
            falsificationCriteria: ['None'],
            createdAt: new Date().toISOString(),
          },
          predictedEffects: [],
          hypothesisOutcome: {
            hypothesisId: createId<'Hypothesis'>('hyp-qwen'),
            verdict: 'supported',
            supportedPredictions: ['Improved pass rate'],
            contradictedPredictions: [],
            unexpectedEffects: [],
            confidence: 0.9,
            summary: 'Supported on Qwen v1',
          },
          positiveEvidence: ['Pass +20%'],
          negativeEvidence: [],
          contradictedPredictions: [],
          observedEffectSizes: { passRateDelta: 0.2 },
          probeBundleIds: ['probe-1'],
          repetitionsCount: 3,
          targetProfile: baseManifest.target,
          taskDomainProvenance: ['typescript'],
          tokenDelta: -50,
          costDollarsDelta: -0.002,
          latencyMsDelta: -10,
          safetyImpact: 'NONE',
          heldOutEvidenceLevel: EvidenceLevel.E3_VERIFIED,
          retentionPassed: true,
          admissionStatus: 'promoted',
          confidence: 0.9,
          createdAt: new Date().toISOString(),
          lastValidatedAt: new Date().toISOString(),
          status: 'ACTIVE',
        };
        await library.record(entry);

        const bridge = new ViForgeCoEvolutionBridge({ experienceLibrary: library });
        const handoffDir = path.join(tmpDir, 'handoff');
        const handoff = await bridge.prepareViForgeHandoff({
          sourceManifest: baseManifest,
          dpoPairs: [],
          grpoGroups: [],
          spinRecords: [],
          ceilingDiagnosis: {
            ceilingDetected: true,
            persistentFailureSignals: ['verification_blind_spot'],
            exhaustedQuadrants: ['INVARIANT_GUIDANCE', 'STRUCTURAL_COMPABILITY'],
            candidatesEvaluated: 4,
            bestAchievedPassRateDelta: 0.0,
            recommendedPostTrainingMethod: 'SPIN',
            rationale: 'Ceiling reached on qwen-2.5-coder-7b',
          },
          outputDir: handoffDir,
        });

        expect(handoff.recommendedRecipe.method).toBe('SPIN');
        expect(handoff.signature).toHaveLength(64);

        const ingestion = await bridge.ingestUpdatedModelCheckpoint({
          handoffId: handoff.handoffId,
          previousModelFamily: 'qwen-2.5-coder-7b',
          newModelFamily: 'qwen-2.5-coder-7b-spin-v2',
          newModelCheckpointId: 'ckpt-step-500',
          checkpointSha256: 'sha256:abc123',
          sourceManifest: baseManifest,
        });

        expect(ingestion.adaptedManifest.target.modelFamily).toBe(
          'qwen-2.5-coder-7b-spin-v2',
        );
        expect(ingestion.revalidationRequiredCount).toBe(1);
        expect(ingestion.invalidatedExperienceIds).toContain(entry.id);

        const updatedEntry = await library.get(entry.id);
        expect(updatedEntry?.status).toBe('STALE');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('Wave 5.1, 5.2 & 5.3 — Engine Integration, CLI, DI Container, and ACP Evolution RPC', () => {
    it('executes RecursiveEvolutionEngine.runCycle with Wave 4 & 5 features enabled', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vi-wave5-engine-'));
      try {
        const engine = new RecursiveEvolutionEngine({
          storageRootDir: tmpDir,
          enabledByDefault: true,
        });

        const report = await engine.runCycle({
          taskIdentifier: 'wave5-integrated-cycle',
          mode: 'parallel',
          kCandidates: 2,
          maxSteps: 1,
          enableZeroSearchMemo: true,
          maxDiscriminativeTasks: 1,
          runAdversarialCounterfactuals: true,
          exportViForgeHandoff: true,
          dryRun: true,
          evolveTasks: [
            { taskId: 't-1', prompt: 'Fix type error in parser.ts', split: 'evolve' },
            { taskId: 't-2', prompt: 'Add null guard in lexer.ts', split: 'evolve' },
          ],
        });

        expect(report.zeroSearchSynthesis).toBeDefined();
        expect(report.discriminativeTaskSelection).toBeDefined();
        expect(report.discriminativeTaskSelection?.selectedTasks).toHaveLength(1);
        expect(report.counterfactualRobustness).toBeDefined();
        expect(report.multipleTestingSummary).toBeDefined();
        expect(report.capabilityCeilingDiagnosis).toBeDefined();
        expect(report.viforgeHandoffManifest).toBeDefined();
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('resolves all Wave 4 & 5 services from DI Container and executes CLI subcommands', async () => {
      const container = new Container();
      new DefaultModule().register(container);

      expect(container.resolve(TOKENS.DiscriminativeTaskSelector)).toBeDefined();
      expect(container.resolve(TOKENS.ContrastivePreferenceExporter)).toBeDefined();
      expect(container.resolve(TOKENS.MemoHarnessSynthesizer)).toBeDefined();
      expect(container.resolve(TOKENS.EcosystemMarginSplitter)).toBeDefined();
      expect(container.resolve(TOKENS.AdversarialProbeGenerator)).toBeDefined();
      expect(container.resolve(TOKENS.ExecutableSurfaceAstVerifier)).toBeDefined();
      expect(container.resolve(TOKENS.ViForgeCoEvolutionBridge)).toBeDefined();
      expect(container.resolve(TOKENS.EvolutionRpcDispatcher)).toBeDefined();

      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vi-wave5-cli-'));
      try {
        const splitCode = await runHarnessCli(['split', 'H0'], { storageRootDir: tmpDir });
        expect(splitCode).toBe(0);

        const transferCode = await runHarnessCli(
          ['transfer', 'H0', '--model', 'gemini-2.5-pro'],
          { storageRootDir: tmpDir },
        );
        expect(transferCode).toBe(0);

        const synthCode = await runHarnessCli(
          ['synthesize', '--task', 'repair-ast'],
          { storageRootDir: tmpDir },
        );
        expect(synthCode).toBe(0);

        const engine = new RecursiveEvolutionEngine({ storageRootDir: tmpDir });
        const cycle = await engine.runCycle({
          runId: createId<'EvolutionRun'>('run_cli_viforge'),
          taskIdentifier: 'cli-test',
          kCandidates: 2,
          maxSteps: 1,
          evolveTasks: [{ taskId: 't1', prompt: 'test', split: 'evolve' }],
        });

        const exportCode = await runEvolutionManageCli(
          ['export-viforge', String(cycle.runId), '--dry-run'],
          { storageRootDir: tmpDir, engine },
        );
        expect(exportCode).toBe(0);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('serves evolution/* JSON-RPC 2.0 endpoints through AcpServer and EvolutionRpcDispatcher', async () => {
      const acpServer = new AcpServer({
        runtime: {
          execute: async () => ({
            executionId: createId<'Execution'>('exec-1'),
            success: true,
            summary: 'ok',
            totalTokens: 10,
            totalCostDollars: 0.001,
            iterationCount: 1,
          }),
        } as any,
        idFactory: new UuidV7IdFactory(),
        clock: new SystemClock(),
        evolutionDispatcher: new EvolutionRpcDispatcher(),
      });

      const initRes = await acpServer.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      });
      expect((initRes.result as any).capabilities.evolutionPlane).toBe(true);

      const splitRes = await acpServer.handleRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'evolution/splitAndTransfer',
        params: { targetModelFamily: 'claude-3-7-sonnet' },
      });
      expect(splitRes.error).toBeUndefined();
      expect((splitRes.result as any).transferredManifest.target.modelFamily).toBe(
        'claude-3-7-sonnet',
      );

      const lineageRes = await acpServer.handleRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'evolution/inspectLineage',
        params: {},
      });
      expect(lineageRes.error).toBeUndefined();
      expect((lineageRes.result as any).snapshotHash).toBeDefined();

      const synthRes = await acpServer.handleRequest({
        jsonrpc: '2.0',
        id: 4,
        method: 'evolution/synthesizeManifest',
        params: { taskId: 'rpc-1', prompt: 'Optimize context compaction' },
      });
      expect(synthRes.error).toBeUndefined();
      expect((synthRes.result as any).mode).toBeDefined();

      const handoffRes = await acpServer.handleRequest({
        jsonrpc: '2.0',
        id: 5,
        method: 'evolution/prepareViForgeHandoff',
        params: {},
      });
      expect(handoffRes.error).toBeUndefined();
      expect((handoffRes.result as any).schemaVersion).toBe('1.0.0');
    });
  });
});
