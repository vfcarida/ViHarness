import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createId } from '../../../src/core/types/identifiers.js';
import type { AgentRuntime } from '../../../src/core/interfaces/agent-runtime.js';
import {
  DEFAULT_GOAL_CONSTRAINTS,
  GoalStatus,
  type Goal,
} from '../../../src/core/model/goal.js';
import type {
  ExecutionOptions,
  ExecutionResult,
} from '../../../src/core/model/runtime-types.js';
import {
  ComponentCapabilityClass,
  EvidenceLevel,
} from '../../../src/core/evolution/constitution.js';
import type { ExperienceEntry } from '../../../src/core/evolution/interfaces.js';
import {
  BradleyTerryHarnessRanker,
  CanaryDeploymentController,
  ContextualBanditMetaRouter,
  CounterfactualTraceSplicer,
  CryptographicEvolutionLedger,
  FederatedExperienceSynchronizer,
  FileHarnessExperienceLibrary,
  HarnessManifestToolkit,
  LiveManifestHotSwapOrchestrator,
  MemoHarnessSynthesizer,
  RecursiveEvolutionEngine,
  EvolutionCockpitServer,
} from '../../../src/infra/evolution/index.js';
import { Container } from '../../../src/di/container.js';
import { DefaultModule } from '../../../src/di/default-module.js';
import { TOKENS } from '../../../src/di/tokens.js';
import { runEvolutionManageCli } from '../../../src/cli/commands/evolve.js';

describe('Wave 7 — Live Manifest Hot-Swapping, Cryptographic Ledger, Counterfactual Splicing, Bandit Meta-Router, Federated Sync & Cockpit Server', () => {
  const toolkit = new HarnessManifestToolkit();

  describe('Wave 7.1 — LiveManifestHotSwapOrchestrator', () => {
    it('hot-swaps canary vs baseline manifests per task, materializes 12 surfaces into ExecutionOptions, and triggers automatic CUSUM rollback on failure', async () => {
      const stableManifest = toolkit.createCanonicalBaseline();
      const canaryManifest = HarnessManifestToolkit.clone(stableManifest, {
        newId: createId<'Harness'>('harness-canary-v2'),
        createdBy: 'composer',
        componentOverrides: {
          routingPolicy: toolkit.createComponentRef({
            id: 'comp-routing-high',
            surfaceId: 'routingPolicy',
            capabilityClass: ComponentCapabilityClass.DECLARATIVE,
            content: {
              architectMode: true,
              reasoningEffort: 'high',
            },
          }),
        },
      });

      const canaryController = new CanaryDeploymentController(stableManifest, {
        minTrialsPerStage: 2,
        cusumAlarmThresholdH: 0.3,
      });
      canaryController.startCanaryRollout({
        canaryManifest,
        initialStage: 100, // Route 100% of tasks to canary for deterministic test
      });

      let shouldFailWithPolicyViolation = false;
      const mockRuntime: AgentRuntime = {
        execute: async (
          goal: Goal,
          options?: ExecutionOptions,
        ): Promise<ExecutionResult> => ({
          executionId: createId<'Execution'>('exec_live_1'),
          goalId: goal.id,
          taskId: createId<'Task'>('task_live_1'),
          success: !shouldFailWithPolicyViolation,
          status: shouldFailWithPolicyViolation ? 'FAILED' : 'COMPLETED',
          summary: 'Mock execution complete',
          iterationCount: 2,
          durationMs: 120,
          totalCostDollars: 0.02,
          totalTokens: 1200,
          iterations: [],
          metadata: {
            receivedArchitectMode: options?.architectMode,
            receivedReasoningEffort: options?.reasoningEffort,
            safetyViolations: shouldFailWithPolicyViolation ? 1 : 0,
          },
        }),
        pause: async () => undefined,
        resume: async () => ({}) as ExecutionResult,
        cancel: async () => undefined,
        onEvent: () => () => undefined,
      };

      const orchestrator = new LiveManifestHotSwapOrchestrator({
        runtime: mockRuntime,
        canaryController,
      });

      const goal: Goal = {
        id: createId<'Goal'>('goal_hot_1'),
        description: 'Implement zero-trust verifier',
        status: GoalStatus.ACTIVE,
        constraints: DEFAULT_GOAL_CONSTRAINTS,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 1. Healthy canary execution materializes architectMode=true & reasoningEffort='high'
      const healthyReport = await orchestrator.executeTask({
        goal,
        taskId: 'task_healthy_1',
      });
      expect(healthyReport.servedSource).toBe('CANARY');
      expect(healthyReport.servedManifest.id).toBe(canaryManifest.id);
      expect(healthyReport.appliedExecutionOptions.architectMode).toBe(true);
      expect(healthyReport.appliedExecutionOptions.reasoningEffort).toBe('high');
      expect(healthyReport.autoRollbackTriggered).toBe(false);

      // 2. Faulty canary execution with safetyviolation triggers immediate auto-rollback
      shouldFailWithPolicyViolation = true;
      const rollbackReport = await orchestrator.executeTask({
        goal,
        taskId: 'task_faulty_2',
      });
      expect(rollbackReport.autoRollbackTriggered).toBe(true);
      expect(rollbackReport.canarySnapshotAfterRun.status).toBe(
        'ROLLED_BACK_ALARM',
      );

      // 3. Subsequent task automatically falls back to STABLE_BASELINE
      shouldFailWithPolicyViolation = false;
      const postRollbackReport = await orchestrator.executeTask({
        goal,
        taskId: 'task_after_rollback_3',
      });
      expect(postRollbackReport.servedSource).toBe('STABLE_BASELINE');
      expect(postRollbackReport.servedManifest.id).toBe(stableManifest.id);
    });
  });

  describe('Wave 7.2 — CryptographicEvolutionLedger', () => {
    it('maintains a SHA-256 hash-chained SLSA provenance ledger and detects any tampering', () => {
      const h0 = toolkit.createCanonicalBaseline();
      const ledger = new CryptographicEvolutionLedger({
        initialBaseline: h0,
      });

      const h1 = HarnessManifestToolkit.clone(h0, {
        newId: createId<'Harness'>('h-promoted-1'),
        createdBy: 'composer',
      });

      ledger.appendEntry({
        eventType: 'HYPOTHESIS_DECLARED',
        subjectManifestId: String(h1.id),
        subjectManifestHash: h1.contentHash,
        invocationId: 'run-1',
      });

      // Intermediate events alone are not authoritative admission/promotion
      const preAdmissionCheck = ledger.verifyManifestProvenance(h1);
      expect(preAdmissionCheck.verified).toBe(false);

      ledger.appendEntry({
        eventType: 'BASELINE_PROMOTED',
        subjectManifestId: String(h1.id),
        subjectManifestHash: h1.contentHash,
        invocationId: 'run-1',
        materials: [{ uri: `manifest://${h0.id}`, sha256: h0.contentHash }],
      });

      const chainCheck = ledger.verifyLedgerIntegrity();
      expect(chainCheck.valid).toBe(true);
      expect(chainCheck.totalEntries).toBe(3);

      const postPromotionCheck = ledger.verifyManifestProvenance(h1);
      expect(postPromotionCheck.verified).toBe(true);
      expect(postPromotionCheck.matchingEvents).toContain('BASELINE_PROMOTED');

      // Tamper with entry 1's subjectManifestHash and verify detection
      const entries = [...ledger.getEntries()];
      entries[1] = {
        ...entries[1]!,
        subjectManifestHash: 'tampered_hash_0000',
      };
      const tamperedCheck = ledger.verifyLedgerIntegrity(entries);
      expect(tamperedCheck.valid).toBe(false);
      expect(tamperedCheck.tamperedIndex).toBe(1);
    });
  });

  describe('Wave 7.3 — CounterfactualTraceSplicer', () => {
    it('localizes the critical divergence step t* and saves >60% tokens via checkpoint-resumed counterfactual probing', async () => {
      const splicer = new CounterfactualTraceSplicer();
      const baseManifest = toolkit.createCanonicalBaseline();
      const candidateManifest = HarnessManifestToolkit.clone(baseManifest, {
        newId: createId<'Harness'>('h-cf-spliced'),
        createdBy: 'proposer',
      });

      const baselineSteps = [
        {
          stepIndex: 0,
          phase: 'INTAKE',
          checkpointRef: 'ckpt_0',
          promptTokens: 1500,
          completionTokens: 300,
          toolCalls: 1,
          toolErrors: 0,
          policyViolations: 0,
          verifierPerformed: false,
          verifierPassed: true,
          filesModifiedCount: 0,
        },
        {
          stepIndex: 1,
          phase: 'COMPILE',
          checkpointRef: 'ckpt_1',
          promptTokens: 2200,
          completionTokens: 400,
          toolCalls: 2,
          toolErrors: 0,
          policyViolations: 0,
          verifierPerformed: false,
          verifierPassed: true,
          filesModifiedCount: 0,
        },
        {
          stepIndex: 2,
          phase: 'ACT',
          checkpointRef: 'ckpt_2',
          promptTokens: 2800,
          completionTokens: 600,
          toolCalls: 2,
          toolErrors: 0,
          policyViolations: 0,
          verifierPerformed: false,
          verifierPassed: true,
          filesModifiedCount: 0,
        },
        {
          stepIndex: 3,
          phase: 'VERIFY',
          checkpointRef: 'ckpt_3',
          promptTokens: 2000,
          completionTokens: 400,
          toolCalls: 1,
          toolErrors: 1,
          policyViolations: 0,
          verifierPerformed: true,
          verifierPassed: false, // Critical verification failure at step 3!
          filesModifiedCount: 2,
        },
      ];

      const report = await splicer.runSplicedCounterfactualProbe({
        taskId: 'task-splice-1',
        baseManifest,
        candidateManifest,
        baselineSteps,
        baselinePartialScore: 0.25,
        suffixExecutor: async ({ resumeFromStepIndex, resumeCheckpointRef }) => {
          expect(resumeFromStepIndex).toBe(2);
          expect(resumeCheckpointRef).toBe('ckpt_2');
          return {
            suffixSuccess: true,
            suffixPartialScore: 0.95,
            suffixStepsExecuted: 1,
            suffixTokensUsed: 2100,
            suffixCostDollars: 0.008,
            verifierPassed: true,
          };
        },
      });

      expect(report.localization.faultDetected).toBe(true);
      expect(report.localization.criticalStepIndex).toBe(3);
      expect(report.localization.faultPhase).toBe('VERIFY');
      expect(report.savedTokensRatio).toBeGreaterThan(0.7);
      expect(report.counterfactualSuccess).toBe(true);
      expect(report.localizedCausalLift).toBeCloseTo(0.7, 3);
    });
  });

  describe('Wave 7.4 — ContextualBanditMetaRouter', () => {
    it('selects optimal meta-arms via LinUCB and updates ridge-regression posteriors from observed rewards', () => {
      const router = new ContextualBanditMetaRouter({ alpha: 0.25 });
      const context = {
        failureEntropy: 0.85,
        budgetPressure: 0.15,
        ceilingIndex: 0.1,
        ratingUncertainty: 0.7,
        historicalPassRate: 0.5,
      };

      const decision = router.selectMetaArm(context);
      expect(decision.selectedArm.armId).toBeDefined();
      expect(decision.recommendedCandidatePoolSize).toBeGreaterThanOrEqual(2);

      const updated = router.recordReward({
        armId: decision.selectedArm.armId,
        context,
        observedUtilityGain: 0.45,
        computeCostDollars: 0.05,
      });
      expect(updated?.pullsCount).toBe(1);
      expect(updated?.meanObservedReward).toBeGreaterThan(0.3);

      const leaderboard = router.getArmLeaderboard();
      expect(leaderboard.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Wave 7.5 — FederatedExperienceSynchronizer', () => {
    it('sanitizes proprietary paths, secrets, emails, and benchmark task IDs and resolves conflicts via Wilson LCB', async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'vi-wave7-fed-'),
      );
      try {
        const sourceLib = new FileHarnessExperienceLibrary({
          storageDir: path.join(tmpDir, 'source'),
        });
        const targetLib = new FileHarnessExperienceLibrary({
          storageDir: path.join(tmpDir, 'target'),
        });

        const baseManifest = toolkit.createCanonicalBaseline();
        const candManifest = HarnessManifestToolkit.clone(baseManifest, {
          newId: createId<'Harness'>('h-fed-1'),
          createdBy: 'proposer',
          componentOverrides: {
            toolGuidance: toolkit.createComponentRef({
              id: 'tg-fed',
              surfaceId: 'toolGuidance',
              capabilityClass: ComponentCapabilityClass.GUIDANCE,
              content:
                'Inspect C:\\Users\\vinicius\\secret\\repo.ts with key sk-proj1234567890abcdef on swe-bench__django-11099.',
            }),
          },
        });

        const entry: ExperienceEntry = {
          id: createId<'ExperienceEntry'>('exp_fed_1'),
          manifest: candManifest,
          manifestHash: candManifest.contentHash,
          diffFromBaseline: toolkit.diff(baseManifest, candManifest),
          applicability: { triggerSignals: ['tool_error'] },
          motivatingFailureSignals: ['tool_error'],
          hypothesis: {
            id: createId<'Hypothesis'>('hyp_fed_1'),
            candidateId: createId<'Candidate'>('cand_fed_1'),
            baseManifestId: baseManifest.id,
            scopeAxis: 'INVARIANT',
            mechanismAxis: 'GUIDANCE',
            quadrant: 'INVARIANT_GUIDANCE',
            targetComponents: ['toolGuidance'],
            observedFailureSignals: ['tool_error'],
            rationale:
              'Failed at /Users/admin/private/app.ts for dev@company.io on swe-bench__django-11099 using ghp_1234567890abcdefghijklmnop',
            applicability: { triggerSignals: ['tool_error'] },
            predictedEffects: [],
            predictedTradeoffs: [],
            risks: [],
            editBudget: {
              maxSurfacesModified: 1,
              maxUnitsChanged: 1,
              maxCapabilityClass: ComponentCapabilityClass.GUIDANCE,
              iterationStep: 1,
            },
            generalizationClaim: 'Generalizes across repositories',
            createdAt: new Date().toISOString(),
          },
          predictedEffects: [],
          hypothesisOutcome: {
            hypothesisId: createId<'Hypothesis'>('hyp_fed_1'),
            candidateId: createId<'Candidate'>('cand_fed_1'),
            verdict: 'supported',
            observedEffects: [],
            unexpectedEffects: [],
            evidenceRefs: [],
            confidence: 0.9,
            summary: 'Supported',
          },
          positiveEvidence: ['Fixed C:\\Users\\vinicius\\secret\\repo.ts'],
          negativeEvidence: [],
          contradictedPredictions: [],
          observedEffectSizes: { passRateDelta: 0.3 },
          probeBundleIds: ['p-1'],
          repetitionsCount: 5,
          targetProfile: baseManifest.target,
          taskDomainProvenance: ['general'],
          tokenDelta: -100,
          costDollarsDelta: -0.01,
          latencyMsDelta: -50,
          safetyImpact: 'NONE',
          heldOutEvidenceLevel: EvidenceLevel.E3_VERIFIED,
          retentionPassed: true,
          admissionStatus: 'promoted',
          confidence: 0.9,
          createdAt: new Date().toISOString(),
          lastValidatedAt: new Date().toISOString(),
          status: 'ACTIVE',
        };

        await sourceLib.record(entry);

        const sync = new FederatedExperienceSynchronizer();
        const bundle = await sync.exportSanitizedBundle({
          library: sourceLib,
          sourceWorkspaceName: 'private-enterprise-repo',
        });

        expect(bundle.entries).toHaveLength(1);
        expect(bundle.privacyAudit.pathsRedacted).toBeGreaterThanOrEqual(2);
        expect(bundle.privacyAudit.secretsRedacted).toBeGreaterThanOrEqual(2);
        expect(bundle.privacyAudit.emailsRedacted).toBeGreaterThanOrEqual(1);
        expect(bundle.privacyAudit.taskIdsRedacted).toBeGreaterThanOrEqual(2);

        const serialized = JSON.stringify(bundle);
        expect(serialized).not.toContain('C:\\Users\\vinicius');
        expect(serialized).not.toContain('sk-proj1234567890abcdef');
        expect(serialized).not.toContain('swe-bench__django-11099');
        expect(serialized).not.toContain('dev@company.io');

        const importReport = await sync.importFederatedBundle({
          targetLibrary: targetLib,
          bundle,
        });
        expect(importReport.signatureVerified).toBe(true);
        expect(importReport.importedActiveCount).toBe(1);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('Wave 7.6 — EvolutionCockpitServer, Engine Integration, CLI & DI', () => {
    it('serves live Evolution Cockpit HTML/JSON/SSE endpoints, executes emergency rollback, and integrates with RecursiveEvolutionEngine & CLI', async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'vi-wave7-cockpit-'),
      );
      try {
        const h0 = toolkit.createCanonicalBaseline();
        const canaryController = new CanaryDeploymentController(h0);
        const ranker = new BradleyTerryHarnessRanker();
        const ledger = new CryptographicEvolutionLedger({
          initialBaseline: h0,
        });
        const metaRouter = new ContextualBanditMetaRouter();

        const canaryManifest = HarnessManifestToolkit.clone(h0, {
          newId: createId<'Harness'>('h-cockpit-canary'),
          createdBy: 'proposer',
        });
        canaryController.startCanaryRollout({ canaryManifest });

        const cockpit = new EvolutionCockpitServer({
          canaryController,
          ranker,
          ledger,
          metaRouter,
        });

        const { url } = await cockpit.start(0);
        try {
          const htmlRes = await fetch(`${url}/`);
          expect(htmlRes.status).toBe(200);
          const htmlText = await htmlRes.text();
          expect(htmlText).toContain('Vi-Harness Evolution Cockpit');
          expect(htmlText).toContain('LEDGER VERIFIED');

          const statusRes = await fetch(`${url}/api/evolution/status`);
          expect(statusRes.status).toBe(200);
          const statusJson = (await statusRes.json()) as {
            ledgerIntegrity: { valid: boolean };
            canary: { status: string };
          };
          expect(statusJson.ledgerIntegrity.valid).toBe(true);
          expect(statusJson.canary.status).toBe('HEALTHY_ROLLOUT');

          // Trigger emergency rollback via POST /api/evolution/canary/rollback
          const rbRes = await fetch(`${url}/api/evolution/canary/rollback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Operator test rollback' }),
          });
          expect(rbRes.status).toBe(200);
          const rbJson = (await rbRes.json()) as { rolledBack: boolean };
          expect(rbJson.rolledBack).toBe(true);
        } finally {
          await cockpit.stop();
        }

        // Run RecursiveEvolutionEngine with enableBanditMetaRouter + CryptographicEvolutionLedger
        const engine = new RecursiveEvolutionEngine({
          storageRootDir: tmpDir,
        });
        const cycleReport = await engine.runCycle({
          runId: createId<'EvolutionRun'>('run_wave7_full'),
          taskIdentifier: 'wave7-task',
          enableBanditMetaRouter: true,
          evolveTasks: [
            {
              taskId: 't-w7-1',
              prompt: 'Verify ledger and bandit router',
              split: 'evolve',
            },
          ],
        });

        expect(cycleReport.metaRoutingDecision).toBeDefined();
        expect(cycleReport.ledgerVerification?.valid).toBe(true);
        expect(
          cycleReport.ledgerVerification?.totalEntries,
        ).toBeGreaterThanOrEqual(2);

        // CLI subcommands ledger-verify and federated-export
        const verifyExit = await runEvolutionManageCli(['ledger-verify'], {
          engine,
          storageRootDir: tmpDir,
        });
        expect(verifyExit).toBe(0);

        const fedExit = await runEvolutionManageCli(
          ['federated-export', '--workspace', 'test-ws'],
          {
            engine,
            storageRootDir: tmpDir,
          },
        );
        expect(fedExit).toBe(0);

        // Verify DI Container resolves all Wave 7 tokens
        const container = new Container();
        new DefaultModule().register(container);
        expect(
          container.resolve(TOKENS.CryptographicEvolutionLedger),
        ).toBeInstanceOf(CryptographicEvolutionLedger);
        expect(
          container.resolve(TOKENS.CounterfactualTraceSplicer),
        ).toBeInstanceOf(CounterfactualTraceSplicer);
        expect(
          container.resolve(TOKENS.ContextualBanditMetaRouter),
        ).toBeInstanceOf(ContextualBanditMetaRouter);
        expect(
          container.resolve(TOKENS.FederatedExperienceSynchronizer),
        ).toBeInstanceOf(FederatedExperienceSynchronizer);
        expect(container.resolve(TOKENS.EvolutionCockpitServer)).toBeInstanceOf(
          EvolutionCockpitServer,
        );
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
