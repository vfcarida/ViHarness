/**
 * Wave 7.1 — Live Runtime <-> Evolution Conduit & Manifest Hot-Swap Orchestrator
 * (`LiveManifestHotSwapOrchestrator`).
 *
 * Bridges the Evolution Plane (`CanaryDeploymentController`, `MemoHarnessSynthesizer`,
 * `DefaultHarnessSurfaceRegistry`) with live `AgentRuntime` production executions
 * while strictly preserving the architectural boundary (`src/runtime/` never imports
 * `src/infra/evolution/`):
 *
 * 1. **Dynamic Per-Task Manifest Resolution**:
 *    - Routes incoming task IDs via `CanaryDeploymentController.routeTask(taskId)`.
 *    - When routed to `STABLE` and `enableZeroSearchSynthesis: true`, queries
 *      `MemoHarnessSynthesizer.synthesizeForTask(...)` for zero-search test-time adaptation.
 * 2. **12-Surface Runtime Materialization**:
 *    - Materializes all 12 `HarnessManifest` surfaces via `DefaultHarnessSurfaceRegistry`
 *      into concrete `ExecutionOptions` and `Goal` budget/metadata constraints.
 * 3. **Closed-Loop Online CUSUM Telemetry Feedback**:
 *    - Extracts pass/fail, cost, latency, and policy/safety violations from `ExecutionResult`
 *      and automatically invokes `CanaryDeploymentController.recordOutcome(...)`, enabling
 *      autonomous fail-closed canary rollback in live production runs.
 */
import type { AgentRuntime } from '../../core/interfaces/agent-runtime.js';
import type { Goal } from '../../core/model/goal.js';
import type {
  ExecutionOptions,
  ExecutionResult,
} from '../../core/model/runtime-types.js';
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';
import type { FailureSignalType } from '../../core/evolution/failure-taxonomy.js';
import type { HarnessSurfaceRegistry } from '../../core/evolution/surface-registry.js';
import { DefaultHarnessSurfaceRegistry } from './default-surface-registry.js';
import { HarnessManifestToolkit } from './manifest-toolkit.js';
import type {
  CanaryDeploymentController,
  CanaryHealthSnapshot,
  CanaryTrialObservation,
} from './canary-deployment-controller.js';
import type {
  MemoHarnessSynthesizer,
  MemoHarnessSynthesisResult,
} from './sqlite-experience-library.js';

export type ServedManifestSource =
  | 'CANARY'
  | 'STABLE_BASELINE'
  | 'MEMO_ZERO_SEARCH';

export interface HotSwapExecutionRequest {
  readonly goal: Goal;
  readonly options?: ExecutionOptions;
  readonly taskId?: string;
  readonly domain?: string;
  readonly language?: string;
  readonly modelFamily?: string;
  readonly predictedFailureSignals?: ReadonlyArray<FailureSignalType>;
  readonly enableZeroSearchSynthesis?: boolean;
}

export interface HotSwapExecutionReport {
  readonly executionResult: ExecutionResult;
  readonly servedSource: ServedManifestSource;
  readonly servedManifest: HarnessManifest;
  readonly materializedConfig: Readonly<Record<string, unknown>>;
  readonly appliedExecutionOptions: ExecutionOptions;
  readonly canaryRoutingBucket: number;
  readonly canarySnapshotAfterRun: CanaryHealthSnapshot;
  readonly memoSynthesisResult?: MemoHarnessSynthesisResult;
  readonly autoRollbackTriggered: boolean;
}

export interface LiveManifestHotSwapOrchestratorOptions {
  readonly runtime: AgentRuntime;
  readonly canaryController: CanaryDeploymentController;
  readonly memoSynthesizer?: MemoHarnessSynthesizer;
  readonly surfaceRegistry?: HarnessSurfaceRegistry;
  readonly enableZeroSearchByDefault?: boolean;
}

export class LiveManifestHotSwapOrchestrator {
  private readonly runtime: AgentRuntime;
  private readonly canaryController: CanaryDeploymentController;
  private readonly memoSynthesizer?: MemoHarnessSynthesizer;
  private readonly surfaceRegistry: HarnessSurfaceRegistry;
  private readonly enableZeroSearchByDefault: boolean;

  constructor(options: LiveManifestHotSwapOrchestratorOptions) {
    this.runtime = options.runtime;
    this.canaryController = options.canaryController;
    this.memoSynthesizer = options.memoSynthesizer;
    this.surfaceRegistry =
      options.surfaceRegistry ?? new DefaultHarnessSurfaceRegistry();
    this.enableZeroSearchByDefault =
      options.enableZeroSearchByDefault ?? false;
  }

  /**
   * Resolves the optimal `HarnessManifest` for the task (Canary vs Stable vs Zero-Search Memo),
   * materializes its 12 surfaces into `Goal` and `ExecutionOptions`, executes the `AgentRuntime`,
   * and feeds execution telemetry back into `CanaryDeploymentController.recordOutcome`.
   */
  async executeTask(
    request: HotSwapExecutionRequest,
  ): Promise<HotSwapExecutionReport> {
    const taskId =
      request.taskId ??
      (typeof request.goal.metadata?.['taskId'] === 'string'
        ? request.goal.metadata['taskId']
        : String(request.goal.id));

    const routing = this.canaryController.routeTask(taskId);
    let servedManifest: HarnessManifest = routing.manifest;
    let servedSource: ServedManifestSource =
      routing.target === 'CANARY' ? 'CANARY' : 'STABLE_BASELINE';
    let memoSynthesisResult: MemoHarnessSynthesisResult | undefined;

    const useZeroSearch =
      request.enableZeroSearchSynthesis ?? this.enableZeroSearchByDefault;

    if (
      routing.target === 'STABLE' &&
      useZeroSearch &&
      this.memoSynthesizer !== undefined
    ) {
      memoSynthesisResult = await this.memoSynthesizer.synthesizeForTask({
        baseManifest: routing.manifest,
        taskId,
        prompt: request.goal.description,
        domain: request.domain,
        language: request.language,
        modelFamily: request.modelFamily,
        predictedFailureSignals: request.predictedFailureSignals,
      });

      if (memoSynthesisResult.mode === 'ZERO_SEARCH_SYNTHESIS') {
        servedManifest = memoSynthesisResult.synthesizedManifest;
        servedSource = 'MEMO_ZERO_SEARCH';
      }
    }

    const materializedConfig =
      HarnessManifestToolkit.materializeExecutionConfig(
        servedManifest,
        this.surfaceRegistry,
      );
    const appliedExecutionOptions = this.buildExecutionOptions(
      materializedConfig,
      request.options,
    );
    const enrichedGoal = this.buildEnrichedGoal(
      request.goal,
      servedManifest,
      servedSource,
      taskId,
    );

    const statusBefore = this.canaryController.getSnapshot().status;
    const executionResult = await this.runtime.execute(
      enrichedGoal,
      appliedExecutionOptions,
    );

    const observation = this.extractCanaryObservation(
      taskId,
      routing.target,
      executionResult,
    );
    const canarySnapshotAfterRun =
      await this.canaryController.recordOutcome(observation);

    const autoRollbackTriggered =
      statusBefore !== 'ROLLED_BACK_ALARM' &&
      canarySnapshotAfterRun.status === 'ROLLED_BACK_ALARM';

    return {
      executionResult,
      servedSource,
      servedManifest,
      materializedConfig,
      appliedExecutionOptions,
      canaryRoutingBucket: routing.bucket,
      canarySnapshotAfterRun,
      memoSynthesisResult,
      autoRollbackTriggered,
    };
  }

  private buildExecutionOptions(
    materializedConfig: Record<string, unknown>,
    callerOptions?: ExecutionOptions,
  ): ExecutionOptions {
    const reasoningEffortRaw = materializedConfig['reasoningEffort'];
    const reasoningEffort: 'low' | 'medium' | 'high' =
      reasoningEffortRaw === 'low' ||
      reasoningEffortRaw === 'medium' ||
      reasoningEffortRaw === 'high'
        ? reasoningEffortRaw
        : (callerOptions?.reasoningEffort ?? 'medium');

    return {
      ...callerOptions,
      architectMode:
        callerOptions?.architectMode ??
        Boolean(materializedConfig['architectMode']),
      reasoningEffort,
      maxRetries:
        callerOptions?.maxRetries ??
        Number(materializedConfig['maxRetries'] ?? 2),
      requestTimeoutMs:
        callerOptions?.requestTimeoutMs ??
        Number(materializedConfig['requestTimeoutMs'] ?? 60_000),
      promptCaching:
        callerOptions?.promptCaching ??
        materializedConfig['enablePrefixCaching'] !== false,
      autoLintAfterWrite:
        callerOptions?.autoLintAfterWrite ??
        materializedConfig['autoLintAfterWrite'] !== false,
      autoTestAfterWrite:
        callerOptions?.autoTestAfterWrite ??
        materializedConfig['autoTestAfterWrite'] !== false,
      requireTdd:
        callerOptions?.requireTdd ?? Boolean(materializedConfig['requireTdd']),
    };
  }

  private buildEnrichedGoal(
    goal: Goal,
    manifest: HarnessManifest,
    servedSource: ServedManifestSource,
    taskId: string,
  ): Goal {
    return {
      ...goal,
      constraints: {
        ...goal.constraints,
        maxIterations:
          manifest.budgetProfile.maxIterationsPerProbe ??
          goal.constraints.maxIterations,
        maxDurationMs:
          manifest.budgetProfile.maxWallTimeMsPerProbe ??
          goal.constraints.maxDurationMs,
        maxCostDollars:
          manifest.budgetProfile.maxCostDollarsPerProbe ??
          goal.constraints.maxCostDollars,
      },
      metadata: {
        ...goal.metadata,
        taskId,
        hotSwappedManifestId: manifest.id,
        hotSwappedManifestHash: manifest.contentHash,
        hotSwappedSource: servedSource,
      },
    };
  }

  private extractCanaryObservation(
    taskId: string,
    servedBy: 'STABLE' | 'CANARY',
    result: ExecutionResult,
  ): CanaryTrialObservation {
    let policyViolations = 0;
    for (const iter of result.iterations) {
      if (iter.phases?.policyDecisions) {
        policyViolations += iter.phases.policyDecisions.filter(
          (pd) => pd.decision === 'DENY',
        ).length;
      }
    }

    const metaSafetyViolations = Number(
      result.metadata?.['safetyViolations'] ?? 0,
    );

    return {
      taskId,
      servedBy,
      success: result.success,
      costDollars: result.totalCostDollars,
      latencyMs: result.durationMs,
      policyViolations,
      safetyViolations: metaSafetyViolations,
    };
  }
}
