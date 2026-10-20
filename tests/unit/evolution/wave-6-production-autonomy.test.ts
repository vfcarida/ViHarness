/**
 * Wave 6 Unit & Integration Suite:
 * - Wave 6.1: Ephemeral Git Worktree & Snapshot Probe Sandbox (`WorktreeProbeSandboxManager`)
 * - Wave 6.2: Causal Surface Credit Assignment & Free-Rider Ablation Pruning (`ShapleyComponentAttributor`)
 * - Wave 6.3: Online Canary Rollout & Sequential CUSUM Auto-Rollback (`CanaryDeploymentController`)
 * - Wave 6.4: Longitudinal Tournament & Glicko-2 / Bradley-Terry Ranking (`BradleyTerryHarnessRanker`)
 * - Wave 6.5: Native MCP Server Evolution Plane Tools (`registerEvolutionMcpTools` + `McpServer`)
 * - Wave 6.6: Scientific Audit, Lineage & Pareto Report Exporter (`EvolutionReportExporter` + CLI)
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createId } from '../../../src/core/types/identifiers.js';
import { EvidenceLevel } from '../../../src/core/evolution/constitution.js';
import type {
  BehavioralContrast,
  EvidenceBundle,
  ProbeTrialMetrics,
} from '../../../src/core/evolution/hypothesis.js';
import type {
  ExperienceEntry,
  ProposedCandidate,
} from '../../../src/core/evolution/interfaces.js';
import {
  WorktreeProbeSandboxManager,
  ShapleyComponentAttributor,
  CanaryDeploymentController,
  BradleyTerryHarnessRanker,
  EvolutionReportExporter,
  HarnessManifestToolkit,
  FileHarnessExperienceLibrary,
  FailClosedAdmissionGate,
  RecursiveEvolutionEngine,
} from '../../../src/infra/evolution/index.js';
import { McpServer } from '../../../src/infra/mcp/mcp-server.js';
import { DefaultToolRegistry } from '../../../src/infra/tools/default-tool-registry.js';
import { Container } from '../../../src/di/container.js';
import { DefaultModule } from '../../../src/di/default-module.js';
import { TOKENS } from '../../../src/di/tokens.js';
import { runEvolutionManageCli } from '../../../src/cli/commands/evolve.js';

function makeTrial(overrides: Partial<ProbeTrialMetrics> = {}): ProbeTrialMetrics {
  return {
    trialIndex: 0,
    taskId: 'task-1',
    seed: 1000,
    success: true,
    partialScore: 1.0,
    verifierPassed: true,
    tokensUsed: 400,
    cachedInputTokens: 200,
    uncachedInputTokens: 150,
    outputTokens: 50,
    costDollars: 0.008,
    wallTimeMs: 200,
    toolCalls: 2,
    toolErrors: 0,
    safetyViolations: 0,
    policyViolations: 0,
    infrastructureError: false,
    failureSignalsObserved: [],
    outputArtifactRefs: [],
    ...overrides,
  };
}

describe('Wave 6 — Production Autonomy, Causal Attribution & Ephemeral Worktree Isolation', () => {
  describe('Wave 6.1 — WorktreeProbeSandboxManager', () => {
    it('isolates concurrent probe workspaces, captures modified file patches, and cleans up deterministically', async () => {
      const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vi-wave6-src-'));
      try {
        await fs.writeFile(path.join(sourceDir, 'app.ts'), 'export const v = 1;\n', 'utf8');

        const manager = new WorktreeProbeSandboxManager({ preferGitWorktree: false });
        let capturedSandboxPath = '';

        const { result, patchArtifact } = await manager.withIsolatedWorkspace(
          {
            workspaceRoot: sourceDir,
            candidateId: 'cand-alpha',
            taskId: 'task-fix',
            trialIndex: 0,
          },
          async (ws) => {
            capturedSandboxPath = ws.sandboxDir;
            await fs.writeFile(
              path.join(ws.sandboxDir, 'app.ts'),
              'export const v = 2;\n',
              'utf8',
            );
            await fs.writeFile(
              path.join(ws.sandboxDir, 'added.ts'),
              'export const added = true;\n',
              'utf8',
            );
            return 'trial-ok';
          },
        );

        expect(result).toBe('trial-ok');
        expect(patchArtifact.cleanedUp).toBe(true);
        expect(patchArtifact.modifiedFiles).toEqual(['added.ts', 'app.ts']);
        expect(patchArtifact.patchDigest).toHaveLength(64);

        // Original workspace must remain untouched
        const origContent = await fs.readFile(path.join(sourceDir, 'app.ts'), 'utf8');
        expect(origContent).toBe('export const v = 1;\n');

        // Ephemeral sandbox directory must have been removed
        await expect(fs.stat(capturedSandboxPath)).rejects.toThrow();
      } finally {
        await fs.rm(sourceDir, { recursive: true, force: true });
      }
    });
  });

  describe('Wave 6.2 — ShapleyComponentAttributor & Auto-Ablation Pruning', () => {
    it('computes Shapley values across surface coalitions and strips parasitic/free-rider surfaces', () => {
      const baseManifest = HarnessManifestToolkit.createCanonicalBaselineManifest();

      // Candidate 1 mutates systemPrompt alone and achieves +0.40 passRateDelta
      const cand1Manifest = HarnessManifestToolkit.clone(baseManifest, {
        newId: createId<'Harness'>('h-cand-1'),
        createdBy: 'proposer',
        componentOverrides: {
          systemPrompt: {
            ...baseManifest.components.systemPrompt,
            content: 'Evolved high-precision system prompt.',
            contentHash: 'hash-sp-evolved',
          },
        },
      });

      // Candidate 2 mutates both systemPrompt AND toolGuidance, but toolGuidance degrades utility (+0.10 total vs +0.40 standalone)
      const cand2Manifest = HarnessManifestToolkit.clone(baseManifest, {
        newId: createId<'Harness'>('h-cand-2'),
        createdBy: 'composer',
        componentOverrides: {
          systemPrompt: {
            ...baseManifest.components.systemPrompt,
            content: 'Evolved high-precision system prompt.',
            contentHash: 'hash-sp-evolved',
          },
          toolGuidance: {
            ...baseManifest.components.toolGuidance,
            content: 'Bloated parasitic tool guidance.',
            contentHash: 'hash-tg-parasitic',
          },
        },
      });

      const makeCandidate = (m: typeof baseManifest): ProposedCandidate => ({
        candidateId: createId<'Candidate'>(`c-${m.id}`),
        manifest: m,
        diffFromBase: HarnessManifestToolkit.diff(baseManifest, m),
        hypothesis: {
          id: createId<'Hypothesis'>(`hyp-${m.id}`),
          title: 'Test',
          problemStatement: 'Test',
          observedFailureSignals: ['verification_blind_spot'],
          targetComponents: ['systemPrompt'],
          scopeAxis: 'MULTI_RUN_POLICY',
          mechanismAxis: 'PROMPT_HEURISTIC',
          quadrant: 'INVARIANT_GUIDANCE',
          expectedPositiveEffects: [],
          expectedRisks: [],
          falsificationCriteria: ['None'],
          createdAt: new Date().toISOString(),
        },
      });

      const makeContrast = (mId: string, delta: number): BehavioralContrast => ({
        id: createId<'Contrast'>(`contrast-${mId}`),
        evidenceBundleId: createId<'Probe'>('p-1'),
        baseManifestId: baseManifest.id,
        candidateManifestId: createId<'Harness'>(mId),
        hypothesisId: createId<'Hypothesis'>('hyp'),
        passRateDelta: delta,
        partialScoreDelta: delta,
        meanTokensDelta: 0,
        meanCostDollarsDelta: 0,
        meanLatencyMsDelta: 0,
        cacheHitRatioDelta: 0,
        toolErrorRateDelta: 0,
        policyViolationDelta: 0,
        regressionDelta: 0,
        candidateVariance: 0,
        confidenceInterval95: [delta - 0.05, delta + 0.05],
        resolvedFailureSignals: delta > 0 ? ['verification_blind_spot'] : [],
        newlyIntroducedFailureSignals: [],
        behavioralDiversityScore: 0.4,
        hypothesisOutcome: {
          hypothesisId: createId<'Hypothesis'>('hyp'),
          verdict: 'supported',
          observedEffects: [],
          unexpectedEffects: [],
          evidenceRefs: [],
          confidence: 0.9,
          summary: 'ok',
        },
        summary: 'ok',
      });

      const attributor = new ShapleyComponentAttributor();
      const report = attributor.computeAttribution({
        candidates: [makeCandidate(cand1Manifest), makeCandidate(cand2Manifest)],
        contrasts: [
          makeContrast(String(cand1Manifest.id), 0.4),
          makeContrast(String(cand2Manifest.id), 0.1),
        ],
      });

      expect(report.synergisticSurfaces).toContain('systemPrompt');
      expect(report.parasiticSurfaces).toContain('toolGuidance');

      const pruned = attributor.pruneFreeRiderSurfaces({
        baseManifest,
        candidateManifest: cand2Manifest,
        attributionReport: report,
      });

      expect(pruned.wasPruned).toBe(true);
      expect(pruned.retainedSurfaces).toEqual(['systemPrompt']);
      expect(pruned.strippedSurfaces).toEqual(['toolGuidance']);
      expect(pruned.prunedManifest.components.toolGuidance.content).toBe(
        baseManifest.components.toolGuidance.content,
      );
    });
  });

  describe('Wave 6.3 — CanaryDeploymentController & Sequential CUSUM Auto-Rollback', () => {
    it('advances rollout stages when healthy and triggers fail-closed auto-rollback + quarantine on CUSUM alarm', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vi-wave6-canary-'));
      try {
        const library = new FileHarnessExperienceLibrary({
          storageDir: path.join(tmpDir, 'lib'),
        });
        const gate = new FailClosedAdmissionGate();
        const stable = gate.getCanonicalBaseline();
        const canary = HarnessManifestToolkit.clone(stable, {
          newId: createId<'Harness'>('harness-canary-v2'),
          createdBy: 'composer',
        });

        const expId = createId<'ExperienceEntry'>('exp-canary-v2');
        const entry: ExperienceEntry = {
          id: expId,
          manifest: canary,
          manifestHash: canary.contentHash,
          parentManifestIds: [stable.id],
          diffFromBaseline: HarnessManifestToolkit.diff(stable, canary),
          motivatingFailureSignals: ['verification_blind_spot'],
          hypothesis: {
            id: createId<'Hypothesis'>('hyp-c'),
            title: 'Canary',
            problemStatement: 'Test',
            observedFailureSignals: ['verification_blind_spot'],
            targetComponents: ['systemPrompt'],
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
            hypothesisId: createId<'Hypothesis'>('hyp-c'),
            verdict: 'supported',
            supportedPredictions: [],
            contradictedPredictions: [],
            unexpectedEffects: [],
            confidence: 0.9,
            summary: 'ok',
          },
          positiveEvidence: [],
          negativeEvidence: [],
          contradictedPredictions: [],
          observedEffectSizes: {},
          probeBundleIds: [],
          repetitionsCount: 2,
          targetProfile: canary.target,
          taskDomainProvenance: ['general'],
          tokenDelta: 0,
          costDollarsDelta: 0,
          latencyMsDelta: 0,
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

        const controller = new CanaryDeploymentController(stable, {
          admissionGate: gate,
          experienceLibrary: library,
          minTrialsPerStage: 2,
          cusumAlarmThresholdH: 0.3,
        });

        controller.startCanaryRollout({
          canaryManifest: canary,
          canaryExperienceId: expId,
          initialStage: 10,
        });

        // 2 healthy canary trials -> advances from 10% to 25%
        await controller.recordOutcome({
          taskId: 't1',
          servedBy: 'CANARY',
          success: true,
          costDollars: 0.01,
          latencyMs: 100,
          policyViolations: 0,
          safetyViolations: 0,
        });
        const snapAfter2 = await controller.recordOutcome({
          taskId: 't2',
          servedBy: 'CANARY',
          success: true,
          costDollars: 0.01,
          latencyMs: 100,
          policyViolations: 0,
          safetyViolations: 0,
        });
        expect(snapAfter2.stagePercentage).toBe(25);
        expect(snapAfter2.status).toBe('HEALTHY_ROLLOUT');

        // Now inject consecutive failures -> CUSUM crosses h=0.3 -> auto-rollback & quarantine
        await controller.recordOutcome({
          taskId: 't3',
          servedBy: 'CANARY',
          success: false,
          costDollars: 0.01,
          latencyMs: 100,
          policyViolations: 0,
          safetyViolations: 0,
        });
        const alarmSnap = await controller.recordOutcome({
          taskId: 't4',
          servedBy: 'CANARY',
          success: false,
          costDollars: 0.01,
          latencyMs: 100,
          policyViolations: 0,
          safetyViolations: 0,
        });

        expect(alarmSnap.status).toBe('ROLLED_BACK_ALARM');
        expect(alarmSnap.stagePercentage).toBe(0);

        const quarantinedEntry = await library.get(expId);
        expect(quarantinedEntry?.status).toBe('QUARANTINED');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('Wave 6.4 — BradleyTerryHarnessRanker', () => {
    it('tracks Glicko-2 / Bradley-Terry ratings, shrinks RD uncertainty, and suggests active-learning matchups', () => {
      const ranker = new BradleyTerryHarnessRanker();
      const baseId = createId<'Harness'>('H0');
      const candId = createId<'Harness'>('H-elite');

      const bundle: EvidenceBundle = {
        id: createId<'Probe'>('p-bt'),
        baseManifestId: baseId,
        baseManifestHash: 'h0',
        candidateManifestId: candId,
        candidateManifestHash: 'hc',
        hypothesisId: createId<'Hypothesis'>('hyp'),
        evidenceLevel: EvidenceLevel.E3_VERIFIED,
        taskIds: ['t1', 't2', 't3'],
        split: 'evolve',
        modelId: 'claude',
        providerId: 'anthropic',
        modelParameters: {},
        environmentFingerprint: 'env',
        networkEgressPolicy: 'DENY_ALL',
        tokenBudget: 1000,
        wallTimeBudgetMs: 1000,
        repetitions: 3,
        baseTrials: [
          makeTrial({ trialIndex: 0, partialScore: 0.2 }),
          makeTrial({ trialIndex: 1, partialScore: 0.3 }),
          makeTrial({ trialIndex: 2, partialScore: 0.2 }),
        ],
        candidateTrials: [
          makeTrial({ trialIndex: 0, partialScore: 0.9 }),
          makeTrial({ trialIndex: 1, partialScore: 1.0 }),
          makeTrial({ trialIndex: 2, partialScore: 0.95 }),
        ],
        negativeResultsPreserved: true,
        provenanceHash: 'prov',
        createdAt: new Date().toISOString(),
      };

      ranker.recordEvidenceBundle(bundle);
      const board = ranker.getLeaderboard();

      expect(board).toHaveLength(2);
      expect(board[0]!.manifestId).toBe('H-elite');
      expect(board[0]!.ratingMu).toBeGreaterThan(1500);
      expect(board[0]!.ratingDeviationRd).toBeLessThan(350);
      expect(ranker.predictWinProbability('H-elite', 'H0')).toBeGreaterThan(0.5);

      const matchups = ranker.suggestNextMatchups();
      expect(matchups).toHaveLength(1);
      expect(matchups[0]!.informationGainScore).toBeGreaterThan(0);
    });
  });

  describe('Wave 6.5 & 6.6 — MCP Evolution Tools, Report Exporter, CLI & Engine Integration', () => {
    it('exposes all 6 Evolution Plane tools via McpServer (tools/list and tools/call)', async () => {
      const registry = new DefaultToolRegistry();
      const mcpServer = new McpServer({
        toolRegistry: registry,
        enableEvolutionTools: true,
      });

      const listRes = await mcpServer.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      });
      const toolNames = ((listRes.result as any).tools as Array<{ name: string }>).map(
        (t) => t.name,
      );
      expect(toolNames).toContain('evolution_synthesize_manifest');
      expect(toolNames).toContain('evolution_inspect_lineage');
      expect(toolNames).toContain('evolution_split_and_transfer');
      expect(toolNames).toContain('evolution_prepare_viforge_handoff');
      expect(toolNames).toContain('evolution_ingest_checkpoint');
      expect(toolNames).toContain('evolution_leaderboard_and_canary');

      const callRes = await mcpServer.handleRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'evolution_leaderboard_and_canary',
          arguments: { maxSuggestions: 2 },
        },
      });
      expect((callRes.result as any).isError).toBe(false);
      const parsedOutput = JSON.parse((callRes.result as any).content[0].text);
      expect(parsedOutput.canaryStatus).toBeDefined();
    });

    it('runs RecursiveEvolutionEngine with Shapley pruning and exports Markdown, HTML, and LaTeX reports via CLI and DI', async () => {
      const container = new Container();
      new DefaultModule().register(container);

      expect(container.resolve(TOKENS.WorktreeProbeSandboxManager)).toBeDefined();
      expect(container.resolve(TOKENS.ShapleyComponentAttributor)).toBeDefined();
      expect(container.resolve(TOKENS.CanaryDeploymentController)).toBeDefined();
      expect(container.resolve(TOKENS.BradleyTerryHarnessRanker)).toBeDefined();
      expect(container.resolve(TOKENS.EvolutionReportExporter)).toBeDefined();

      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vi-wave6-report-'));
      try {
        const engine = new RecursiveEvolutionEngine({ storageRootDir: tmpDir });
        const report = await engine.runCycle({
          runId: createId<'EvolutionRun'>('run_wave6_audit'),
          taskIdentifier: 'wave6-task',
          kCandidates: 2,
          maxSteps: 1,
          pruneFreeRiderSurfaces: true,
          evolveTasks: [{ taskId: 't1', prompt: 'Fix bug', split: 'evolve' }],
        });

        expect(report.shapleyAttribution).toBeDefined();
        expect(report.tournamentLeaderboard).toBeDefined();
        expect(report.tournamentLeaderboard!.length).toBeGreaterThan(0);

        const exporter = new EvolutionReportExporter();
        const md = exporter.render(report, 'md');
        const html = exporter.render(report, 'html');
        const latex = exporter.render(report, 'latex');

        expect(md).toContain('```mermaid');
        expect(md).toContain('Causal Surface Credit Attribution');
        expect(html).toContain('<!DOCTYPE html>');
        expect(latex).toContain('\\toprule');

        const cliCode = await runEvolutionManageCli(
          ['report', String(report.runId), '--format', 'latex'],
          { storageRootDir: tmpDir, engine },
        );
        expect(cliCode).toBe(0);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
