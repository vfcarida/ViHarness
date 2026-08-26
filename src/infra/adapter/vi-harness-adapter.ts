/**
 * Vi-Harness Pi Replacement Adapter.
 *
 * Implements the ViHarness compatibility layer allowing coding-agent benchmarks
 * to evaluate Vi-Harness directly against Pi Harness as the primary independent variable.
 *
 * PRINCIPLE:
 * Translates Benchmark Task -> Vi Goal -> Vi Agent Runtime Execution -> Vi Result -> Pi Benchmark Result.
 * Hides internal Vi-Harness domain objects behind the standardized benchmark result interface.
 * Preserves Vi runtime architecture without internal mutations.
 */
import type {
  PiBenchmarkTask,
  PiBenchmarkResult,
  PiTestResults,
  PiTokenUsage,
  ViHarnessOptions,
} from '../../core/model/adapter-types.js';
import type { Goal } from '../../core/model/goal.js';
import { GoalStatus } from '../../core/model/goal.js';
import type { ModelRouter } from '../../core/interfaces/model-router.js';
import type { ContextCompiler } from '../../core/interfaces/context-compiler.js';
import type { PolicyEngine } from '../../core/interfaces/policy-engine.js';
import type { ToolExecutor } from '../../core/interfaces/tool-executor.js';
import type { VerificationEngine } from '../../core/interfaces/verification-engine.js';
import type { EvidenceStore } from '../../core/interfaces/evidence-store.js';
import type { CheckpointStore } from '../../core/interfaces/checkpoint-store.js';
import type { GitManager } from '../../core/interfaces/git-manager.js';
import type { IdFactory, GoalId } from '../../core/types/identifiers.js';
import type { Clock } from '../../core/interfaces/clock.js';
import { UuidV7IdFactory } from '../id/uuid-id-factory.js';
import { SystemClock } from '../time/system-clock.js';
import { UtilityModelRouter } from '../router/utility-model-router.js';
import { DefaultContextCompiler } from '../compiler/default-context-compiler.js';
import { ScriptedModelProvider } from '../model/scripted-model-provider.js';
import { DefaultToolExecutor } from '../tools/default-tool-executor.js';
import { DefaultAgentRuntime } from '../../runtime/default-agent-runtime.js';
import { EvidenceOutcome, EvidenceType } from '../../core/model/evidence.js';
import { ActionResultStatus } from '../../core/model/action.js';

export class ViHarness {
  private readonly router: ModelRouter;
  private readonly compiler: ContextCompiler;
  private readonly policyEngine?: PolicyEngine;
  private readonly toolExecutor?: ToolExecutor;
  private readonly verificationEngine?: VerificationEngine;
  private readonly evidenceStore?: EvidenceStore;
  private readonly checkpointStore?: CheckpointStore;
  private readonly gitManager?: GitManager;
  private readonly idFactory: IdFactory;
  private readonly clock: Clock;
  public readonly harnessVersion: string;

  constructor(options: ViHarnessOptions = {}) {
    this.idFactory = options.idFactory ?? new UuidV7IdFactory();
    this.clock = options.clock ?? new SystemClock();
    this.harnessVersion = options.harnessVersion ?? '0.1.0-vi-harness';

    this.compiler =
      options.compiler ??
      new DefaultContextCompiler({
        idFactory: this.idFactory,
        clock: this.clock,
      });

    if (options.router) {
      this.router = options.router;
    } else {
      const router = new UtilityModelRouter();
      if (options.primaryProvider) {
        router.registerProvider(options.primaryProvider);
      } else {
        router.registerProvider(
          new ScriptedModelProvider({
            providerId: 'vi-adapter-scripted',
            steps: [],
          }),
        );
      }
      this.router = router;
    }

    this.policyEngine = options.policyEngine;
    this.toolExecutor =
      options.toolExecutor ??
      new DefaultToolExecutor({
        idFactory: this.idFactory,
        policyEngine: this.policyEngine,
      });
    this.verificationEngine = options.verificationEngine;
    this.evidenceStore = options.evidenceStore;
    this.checkpointStore = options.checkpointStore;
    this.gitManager = options.gitManager;
  }

  /**
   * Primary Benchmark Task Execution Interface.
   * Drop-in replacement for PiHarness.runTask(task) or PiHarness.execute(task).
   */
  async runTask(task: PiBenchmarkTask): Promise<PiBenchmarkResult> {
    const startTimeMs = this.clock.now().getTime();

    // 1. Capture Git Baseline if GitManager is provided
    if (this.gitManager) {
      await this.gitManager.captureBaseline();
    }

    // 2. Translate PiBenchmarkTask -> Vi Goal & Constraints
    const maxCostUSD = task.maxCostUSD ?? 10.0;
    const maxTokens = task.maxTokens ?? task.tokenBudget ?? 100000;
    const maxIterations = task.maxIterations ?? task.maxTurns ?? task.turnLimit ?? 10;
    const maxDurationMs = task.maxDurationMs ?? task.timeoutMs ?? 300000;
    const repositoryPath = task.repositoryPath ?? task.workingDirectory ?? task.repoPath ?? '';

    const goal: Goal = {
      id: task.id ? (task.id as unknown as GoalId) : this.idFactory.create<'Goal'>(),
      description: task.description,
      constraints: {
        maxCostDollars: maxCostUSD,
        maxIterations,
        maxDurationMs,
        maxRepairAttempts: 3,
        maxNoProgressIterations: 3,
        requireVerification: true,
      },
      status: GoalStatus.ACTIVE,
      createdAt: this.clock.now(),
      updatedAt: this.clock.now(),
      metadata: {
        taskName: task.name ?? task.id,
        category: task.category ?? 'BENCHMARK',
        riskLevel: task.riskLevel ?? 'LOW',
        repositoryPath,
        requiredTools: task.requiredTools ?? [],
        maxTokens,
      },
    };

    // 3. Instantiate Vi Agent Runtime & Execute Task
    const runtime = new DefaultAgentRuntime({
      router: this.router,
      compiler: this.compiler,
      policyEngine: this.policyEngine,
      toolExecutor: this.toolExecutor,
      verificationEngine: this.verificationEngine,
      evidenceStore: this.evidenceStore,
      checkpointStore: this.checkpointStore,
      idFactory: this.idFactory,
      clock: this.clock,
    });

    const executionResult = await runtime.execute(goal, {
      relevantObjects: task.initialContextObjects ?? [],
    });

    // 4. Calculate Workspace File Changes and Git Diff
    let changedFiles: string[] = [];
    let finalDiff = '';

    if (this.gitManager) {
      changedFiles = [...(await this.gitManager.getAgentDelta())];
      finalDiff = await this.gitManager.getDiff();
    } else {
      // Extract modified file paths from iteration tool results and action proposals
      const modifiedSet = new Set<string>();
      for (const iteration of executionResult.iterations) {
        for (const tr of iteration.toolResults) {
          const pathVal =
            tr.metadata['path'] ?? tr.metadata['filePath'] ?? tr.metadata['targetFile'];
          if (tr.status === ActionResultStatus.SUCCESS && pathVal) {
            modifiedSet.add(String(pathVal));
          }
        }
        for (const prop of iteration.actionProposals ?? []) {
          const desc = prop.description.toLowerCase();
          const typeStr = String(prop.type);
          if (desc.includes('write') || typeStr.includes('WRITE') || typeStr === 'FILE_WRITE') {
            const pathVal =
              prop.parameters['path'] ??
              prop.parameters['filePath'] ??
              prop.parameters['targetFile'];
            if (pathVal) {
              modifiedSet.add(String(pathVal));
            }
          }
        }
      }
      changedFiles = Array.from(modifiedSet);
      finalDiff =
        changedFiles.length > 0
          ? `--- Agent Workspace Changes (${changedFiles.length} files modified)\n` +
            changedFiles.map((f) => `+++ ${f}\n@@ modified by Vi-Harness @@`).join('\n')
          : '';
    }

    // 5. Aggregate Test & Verification Results
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;

    for (const iteration of executionResult.iterations) {
      for (const ev of iteration.evidenceCreated) {
        if (ev.type === EvidenceType.TEST_RESULT || ev.type === EvidenceType.VERIFICATION) {
          totalTests += 1;
          if (ev.outcome === EvidenceOutcome.PASS) {
            passedTests += 1;
          } else if (ev.outcome === EvidenceOutcome.FAIL) {
            failedTests += 1;
          }
        }
      }
    }

    const testPassRate =
      totalTests > 0 ? passedTests / totalTests : executionResult.success ? 1.0 : 0.0;
    const tests: PiTestResults = {
      total: totalTests,
      passed: passedTests,
      failed: failedTests,
      passRate: testPassRate,
    };

    // 6. Aggregate Token Consumption & Model Calls
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    for (const iteration of executionResult.iterations) {
      if (iteration.tokenUsage) {
        promptTokens += iteration.tokenUsage.inputTokens;
        completionTokens += iteration.tokenUsage.outputTokens;
        totalTokens += iteration.tokenUsage.totalTokens;
      }
    }

    const tokens: PiTokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens,
    };

    // 7. Calculate Duration, Model Calls, Final State, & Termination Reason
    const duration = Math.max(
      1,
      executionResult.durationMs ?? this.clock.now().getTime() - startTimeMs,
    );
    const modelCalls = executionResult.iterations.length;
    const lastIteration = executionResult.iterations[executionResult.iterations.length - 1];
    const finalState = lastIteration ? String(lastIteration.stateAfter) : 'DONE';

    let terminationReason = 'COMPLETED';
    if (lastIteration?.terminationDecision?.reason) {
      terminationReason = String(lastIteration.terminationDecision.reason);
    } else if (!executionResult.success) {
      terminationReason = 'FAILED';
    }

    // 8. Return Pi-Compatible Benchmark Result (No internal Vi state exposed)
    return {
      success: executionResult.success,
      finalState,
      changedFiles,
      finalDiff,
      tests,
      iterations: executionResult.iterationCount,
      modelCalls,
      tokens,
      estimatedCost: executionResult.totalCostDollars,
      duration,
      terminationReason,
      taskId: task.id,
    };
  }

  /** Alias for runTask */
  async executeTask(task: PiBenchmarkTask): Promise<PiBenchmarkResult> {
    return this.runTask(task);
  }

  /** Alias for runTask */
  async execute(task: PiBenchmarkTask): Promise<PiBenchmarkResult> {
    return this.runTask(task);
  }

  /** Alias for runTask */
  async run(task: PiBenchmarkTask): Promise<PiBenchmarkResult> {
    return this.runTask(task);
  }
}
