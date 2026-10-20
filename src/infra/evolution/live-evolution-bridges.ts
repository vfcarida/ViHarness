/**
 * Wave 4.1 — Live Runtime & Model Bridges for Recursive Harness Evolution.
 *
 * Bridges the Evolution Plane with live ModelProviders and AgentRuntime instances:
 * 1. `ModelDrivenCandidateGenerator` (`CustomCandidateGenerator`): LLM-guided candidate
 *    synthesis with progressive trace disclosure, Zod schema validation, and deterministic fallback.
 * 2. `ModelDrivenHarnessComposer` (`HarnessComposer`): LLM-assisted component-wise selective
 *    composition backed by `DefaultHarnessComposer` fail-closed fallback.
 * 3. `createRuntimeMaterializedProbeExecutor` (`ProbeTrialExecutor`): Materializes a
 *    `HarnessManifest` into `ExecutionOptions` and executes an isolated `AgentRuntime` trial.
 */
import { z } from 'zod';
import { createId } from '../../core/types/identifiers.js';
import type {
  CompositionId,
  GoalId,
  HarnessId,
  IdFactory,
} from '../../core/types/identifiers.js';
import type { ModelProvider } from '../../core/interfaces/model-provider.js';
import type { AgentRuntime } from '../../core/interfaces/agent-runtime.js';
import { MessageRole } from '../../core/model/model-io.js';
import { ActionResultStatus } from '../../core/model/action.js';
import {
  DEFAULT_GOAL_CONSTRAINTS,
  GoalStatus,
  type Goal,
} from '../../core/model/goal.js';
import type { ExecutionOptions } from '../../core/model/runtime-types.js';
import {
  ComponentCapabilityClass,
  type HarnessConstitution,
} from '../../core/evolution/constitution.js';
import type {
  ComponentRef,
  HarnessComponents,
  HarnessManifest,
} from '../../core/evolution/harness-manifest.js';
import type {
  CandidateExplorationQuadrant,
  FailureSignal,
  FailureSignalType,
} from '../../core/evolution/failure-taxonomy.js';
import type {
  BehavioralContrast,
  ComponentCompositionDecision,
  HarnessCompositionRecord,
} from '../../core/evolution/hypothesis.js';
import type {
  ExperienceEntry,
  HarnessComposer,
  ProposedCandidate,
} from '../../core/evolution/interfaces.js';
import type { HarnessSurfaceRegistry } from '../../core/evolution/surface-registry.js';
import { StructuredOutputValidator } from '../model/structured-output-validator.js';
import { UuidV7IdFactory } from '../id/uuid-id-factory.js';
import { HarnessManifestToolkit } from './manifest-toolkit.js';
import type { CustomCandidateGenerator } from './default-harness-proposer.js';
import { DefaultHarnessComposer } from './default-harness-composer.js';
import type { ProbeTrialExecutor } from './isolated-probe-runner.js';

// ---------------------------------------------------------------------------
// 1. ModelDrivenCandidateGenerator
// ---------------------------------------------------------------------------

const CandidateProposalPayloadSchema = z.object({
  targetSurface: z.enum([
    'toolGuidance',
    'contextPolicy',
    'routingPolicy',
    'subagents',
    'skills',
    'scripts',
    'plugins',
  ]),
  rationale: z.string().min(5),
  generalizationClaim: z.string().min(5),
  permissions: z.array(z.string()).default(['workspace:read']),
  componentContent: z.union([z.string(), z.record(z.string(), z.unknown())]),
});

export interface ModelDrivenCandidateGeneratorOptions {
  readonly modelProvider: ModelProvider;
  readonly modelId?: string;
  /**
   * Optional on-demand raw trace snippet loader ("Progressive Disclosure" — SkillEvo / Meta-Harness).
   * Called only for high-severity failure signals (`HIGH` or `CRITICAL`) to avoid context bloat.
   */
  readonly traceSnippetLoader?: (evidenceRef: string) => Promise<string | null>;
}

export class ModelDrivenCandidateGenerator implements CustomCandidateGenerator {
  private readonly modelProvider: ModelProvider;
  private readonly modelId: string;
  private readonly traceSnippetLoader?: (
    evidenceRef: string,
  ) => Promise<string | null>;

  constructor(options: ModelDrivenCandidateGeneratorOptions) {
    this.modelProvider = options.modelProvider;
    this.modelId = options.modelId ?? 'claude-3-7-sonnet';
    this.traceSnippetLoader = options.traceSnippetLoader;
  }

  async generate(params: {
    readonly baseManifest: HarnessManifest;
    readonly quadrant: CandidateExplorationQuadrant;
    readonly signals: ReadonlyArray<FailureSignal>;
    readonly libraryEntries: ReadonlyArray<ExperienceEntry>;
    readonly iterationStep: number;
  }): Promise<{
    readonly componentOverrides: Partial<HarnessComponents>;
    readonly targetComponents: ReadonlyArray<string>;
    readonly rationale: string;
    readonly generalizationClaim: string;
  } | null> {
    const { baseManifest, quadrant, signals, libraryEntries, iterationStep } =
      params;

    // Progressive trace disclosure: load at most 2 high-severity trace snippets on demand
    const disclosedSnippets: string[] = [];
    if (this.traceSnippetLoader) {
      const highSeveritySignals = signals
        .filter((s) => s.severity === 'HIGH' || s.severity === 'CRITICAL')
        .slice(0, 2);
      for (const sig of highSeveritySignals) {
        const firstRef = sig.evidenceExcerpts[0] ?? sig.runIds[0];
        if (firstRef) {
          const snippet = await this.traceSnippetLoader(firstRef);
          if (snippet) {
            disclosedSnippets.push(
              `[${sig.type}@${firstRef}]: ${snippet.slice(0, 500)}`,
            );
          }
        }
      }
    }

    const promptSummary = JSON.stringify({
      quadrant,
      iterationStep,
      targetProfile: baseManifest.target,
      observedSignals: signals.map((s) => ({
        type: s.type,
        severity: s.severity,
        confidence: s.confidence,
        evidenceExcerpts: s.evidenceExcerpts,
        occurrences: s.iterationNumbers.length,
      })),
      disclosedTraceSnippets: disclosedSnippets,
      priorSupportedLibraryHints: libraryEntries
        .filter((e) => e.hypothesisOutcome.verdict === 'supported')
        .slice(0, 3)
        .map((e) => ({
          quadrant: e.hypothesis.quadrant,
          surfaces: e.diffFromBaseline.changedSurfaces,
          rationale: e.hypothesis.rationale,
        })),
      priorNegativeSurfacesToAvoid: libraryEntries
        .filter((e) => e.hypothesisOutcome.verdict === 'contradicted')
        .slice(0, 3)
        .map((e) => ({
          quadrant: e.hypothesis.quadrant,
          surfaces: e.diffFromBaseline.changedSurfaces,
        })),
    });

    try {
      const response = await this.modelProvider.complete({
        modelId: this.modelId,
        temperature: 0.2,
        systemPrompt:
          'You are the ViHarness Recursive Evolution Proposer. Output ONLY valid JSON matching the schema: ' +
          '{ "targetSurface": "toolGuidance"|"contextPolicy"|"routingPolicy"|"subagents"|"skills"|"scripts"|"plugins", ' +
          '"rationale": string, "generalizationClaim": string, "permissions": string[], "componentContent": string | object }.',
        messages: [
          {
            role: MessageRole.USER,
            content: `Propose a surgical harness modification for quadrant ${quadrant}:\n${promptSummary}`,
          },
        ],
      });

      const parsed = StructuredOutputValidator.validateZod(
        response.content,
        CandidateProposalPayloadSchema,
      );
      if (!parsed.success) {
        return null;
      }

      const payload = parsed.data;
      return this.materializeProposalOverride(
        baseManifest,
        payload.targetSurface,
        payload.componentContent,
        payload.permissions ?? [],
        payload.rationale,
        payload.generalizationClaim,
        iterationStep,
      );
    } catch {
      return null;
    }
  }

  private materializeProposalOverride(
    baseManifest: HarnessManifest,
    surfaceId:
      | 'toolGuidance'
      | 'contextPolicy'
      | 'routingPolicy'
      | 'subagents'
      | 'skills'
      | 'scripts'
      | 'plugins',
    content: string | Record<string, unknown>,
    permissions: ReadonlyArray<string>,
    rationale: string,
    generalizationClaim: string,
    iterationStep: number,
  ): {
    readonly componentOverrides: Partial<HarnessComponents>;
    readonly targetComponents: ReadonlyArray<string>;
    readonly rationale: string;
    readonly generalizationClaim: string;
  } {
    const capabilityMap: Record<typeof surfaceId, ComponentCapabilityClass> = {
      toolGuidance: ComponentCapabilityClass.GUIDANCE,
      contextPolicy: ComponentCapabilityClass.DECLARATIVE,
      routingPolicy: ComponentCapabilityClass.DECLARATIVE,
      subagents: ComponentCapabilityClass.DECLARATIVE,
      skills: ComponentCapabilityClass.DECLARATIVE,
      scripts: ComponentCapabilityClass.EXECUTABLE,
      plugins: ComponentCapabilityClass.EXECUTABLE,
    };

    const ref = HarnessManifestToolkit.createComponentRef({
      id: `comp-llm-${surfaceId}-s${iterationStep}`,
      surfaceId,
      capabilityClass: capabilityMap[surfaceId],
      version: `1.${iterationStep}.0`,
      content:
        surfaceId === 'toolGuidance'
          ? typeof content === 'string'
            ? content
            : JSON.stringify(content)
          : typeof content === 'object' && content !== null
            ? content
            : { value: content },
      permissions: permissions.length > 0 ? permissions : ['workspace:read'],
    });

    if (
      surfaceId === 'subagents' ||
      surfaceId === 'skills' ||
      surfaceId === 'scripts' ||
      surfaceId === 'plugins'
    ) {
      const existing = baseManifest.components[surfaceId];
      return {
        componentOverrides: {
          [surfaceId]: [...existing, ref],
        } as Partial<HarnessComponents>,
        targetComponents: [surfaceId],
        rationale,
        generalizationClaim,
      };
    }

    return {
      componentOverrides: {
        [surfaceId]: ref,
      } as Partial<HarnessComponents>,
      targetComponents: [surfaceId],
      rationale,
      generalizationClaim,
    };
  }
}

// ---------------------------------------------------------------------------
// 2. ModelDrivenHarnessComposer
// ---------------------------------------------------------------------------

const CompositionDecisionPayloadSchema = z.object({
  decisions: z.array(
    z.object({
      surfaceId: z.string(),
      action: z.enum([
        'preserve_baseline',
        'select_candidate',
        'combine_candidates',
        'reject_all',
      ]),
      selectedManifestIds: z.array(z.string()),
      rationale: z.string(),
    }),
  ),
});

export interface ModelDrivenHarnessComposerOptions {
  readonly modelProvider: ModelProvider;
  readonly fallbackComposer?: HarnessComposer;
  readonly idFactory?: IdFactory;
  readonly modelId?: string;
}

export class ModelDrivenHarnessComposer implements HarnessComposer {
  private readonly modelProvider: ModelProvider;
  private readonly fallbackComposer: HarnessComposer;
  private readonly idFactory: IdFactory;
  private readonly modelId: string;

  constructor(options: ModelDrivenHarnessComposerOptions) {
    this.modelProvider = options.modelProvider;
    this.idFactory = options.idFactory ?? new UuidV7IdFactory();
    this.fallbackComposer =
      options.fallbackComposer ??
      new DefaultHarnessComposer({ idFactory: this.idFactory });
    this.modelId = options.modelId ?? 'claude-3-7-sonnet';
  }

  async compose(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidates: ReadonlyArray<ProposedCandidate>;
    readonly contrasts: ReadonlyArray<BehavioralContrast>;
    readonly surfaceRegistry: HarnessSurfaceRegistry;
    readonly constitution: HarnessConstitution;
  }): Promise<HarnessCompositionRecord> {
    const { baseManifest, candidates, contrasts, surfaceRegistry, constitution } =
      params;

    const candidateByManifestId = new Map<string, ProposedCandidate>();
    for (const c of candidates) {
      candidateByManifestId.set(c.manifest.id, c);
    }

    const contrastByManifestId = new Map<string, BehavioralContrast>();
    for (const c of contrasts) {
      contrastByManifestId.set(c.candidateManifestId, c);
    }

    try {
      const promptPayload = {
        baseManifestId: baseManifest.id,
        candidates: candidates.map((c) => {
          const contrast = contrastByManifestId.get(c.manifest.id);
          return {
            manifestId: c.manifest.id,
            changedSurfaces: c.diffFromBase.changedSurfaces,
            verdict: contrast?.hypothesisOutcome.verdict ?? 'inconclusive',
            passRateDelta: contrast?.passRateDelta ?? 0,
            costDelta: contrast?.meanCostDollarsDelta ?? 0,
            regressionDelta: contrast?.regressionDelta ?? 0,
            policyViolationDelta: contrast?.policyViolationDelta ?? 0,
          };
        }),
      };

      const response = await this.modelProvider.complete({
        modelId: this.modelId,
        temperature: 0.1,
        systemPrompt:
          'You are the ViHarness Selective Component Composer. Output ONLY valid JSON matching: ' +
          '{ "decisions": [{ "surfaceId": string, "action": "preserve_baseline"|"select_candidate"|"combine_candidates"|"reject_all", "selectedManifestIds": string[], "rationale": string }] }.',
        messages: [
          {
            role: MessageRole.USER,
            content: `Select the optimal per-surface composition from empirical contrasts:\n${JSON.stringify(promptPayload)}`,
          },
        ],
      });

      const parsed = StructuredOutputValidator.validateZod(
        response.content,
        CompositionDecisionPayloadSchema,
      );
      if (!parsed.success || parsed.data.decisions.length === 0) {
        return this.fallbackComposer.compose(params);
      }

      const overrides: Record<string, unknown> = {};
      const componentDecisions: ComponentCompositionDecision[] = [];
      const arraySurfaces = new Set(['subagents', 'skills', 'scripts', 'plugins']);

      for (const decision of parsed.data.decisions) {
        const surfaceId = decision.surfaceId as keyof HarnessComponents;
        if (!(surfaceId in baseManifest.components)) {
          continue;
        }

        // Only allow selecting candidates that achieved 'supported' contrast with 0 regressions/violations
        const validSelectedIds = decision.selectedManifestIds.filter((id: string) => {
          const contrast = contrastByManifestId.get(id);
          return (
            contrast !== undefined &&
            contrast.hypothesisOutcome.verdict === 'supported' &&
            contrast.regressionDelta <= 0 &&
            contrast.policyViolationDelta <= 0 &&
            surfaceRegistry.isEvolvable(surfaceId)
          );
        }) as HarnessId[];

        if (
          decision.action === 'preserve_baseline' ||
          decision.action === 'reject_all' ||
          validSelectedIds.length === 0
        ) {
          componentDecisions.push({
            surfaceId,
            action: decision.action === 'reject_all' ? 'reject_all' : 'preserve_baseline',
            selectedFromManifestIds: [baseManifest.id],
            supportingContrastIds: [],
            rationale: decision.rationale,
          });
          continue;
        }

        if (arraySurfaces.has(surfaceId) && validSelectedIds.length > 1) {
          const merged = new Map<string, ComponentRef>();
          for (const baseItem of baseManifest.components[
            surfaceId as 'subagents' | 'skills' | 'scripts' | 'plugins'
          ]) {
            merged.set(baseItem.id, baseItem);
          }
          for (const selId of validSelectedIds) {
            const cand = candidateByManifestId.get(selId);
            if (!cand) continue;
            for (const item of cand.manifest.components[
              surfaceId as 'subagents' | 'skills' | 'scripts' | 'plugins'
            ]) {
              merged.set(item.id, item);
            }
          }
          overrides[surfaceId] = Array.from(merged.values());
          componentDecisions.push({
            surfaceId,
            action: 'combine_candidates',
            selectedFromManifestIds: validSelectedIds,
            supportingContrastIds: validSelectedIds
              .map((id) => contrastByManifestId.get(id)?.id)
              .filter((id): id is NonNullable<typeof id> => id !== undefined),
            rationale: decision.rationale,
          });
        } else {
          const winnerId = validSelectedIds[0];
          if (winnerId) {
            const winnerCand = candidateByManifestId.get(winnerId);
            const winnerContrast = contrastByManifestId.get(winnerId);
            if (winnerCand && winnerContrast) {
              overrides[surfaceId] = winnerCand.manifest.components[surfaceId];
              componentDecisions.push({
                surfaceId,
                action: 'select_candidate',
                selectedFromManifestIds: [winnerId],
                supportingContrastIds: [winnerContrast.id],
                rationale: decision.rationale,
              });
            }
          }
        }
      }

      const compositionId = this.idFactory.create<'Composition'>() as CompositionId;
      const composedManifestId = `harness-composed-${compositionId.slice(0, 8)}` as HarnessId;

      const composedManifest =
        Object.keys(overrides).length > 0
          ? HarnessManifestToolkit.clone(baseManifest, {
              newId: composedManifestId,
              createdBy: 'composer',
              componentOverrides: overrides as Partial<HarnessComponents>,
            })
          : baseManifest;

      const validation = HarnessManifestToolkit.validate(
        composedManifest,
        surfaceRegistry,
        constitution,
      );
      if (!validation.valid) {
        return this.fallbackComposer.compose(params);
      }

      const manifestDiffFromBase = HarnessManifestToolkit.diff(
        baseManifest,
        composedManifest,
        surfaceRegistry,
      );

      const rejectedCandidateIds = candidates
        .map((c) => c.manifest.id)
        .filter((id) => {
          const c = contrastByManifestId.get(id);
          return (
            !c ||
            c.hypothesisOutcome.verdict !== 'supported' ||
            c.regressionDelta > 0 ||
            c.policyViolationDelta > 0
          );
        });

      return {
        id: compositionId,
        baseManifestId: baseManifest.id,
        inputCandidateIds: candidates.map((c) => c.manifest.id),
        composedManifest,
        manifestDiffFromBase,
        componentDecisions,
        rejectedCandidateIds,
        createdAt: new Date().toISOString(),
      };
    } catch {
      return this.fallbackComposer.compose(params);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Runtime-Materialized Probe Trial Executor Bridge
// ---------------------------------------------------------------------------

export interface RuntimeMaterializedProbeBridgeOptions {
  /**
   * Factory or instance provider that returns an `AgentRuntime` configured for the isolated workspace.
   */
  readonly runtimeFactory: (params: {
    readonly manifest: HarnessManifest;
    readonly materializedConfig: Record<string, unknown>;
    readonly workspacePath: string;
  }) => AgentRuntime | Promise<AgentRuntime>;
  readonly idFactory?: IdFactory;
}

/**
 * Creates a `ProbeTrialExecutor` that materializes a `HarnessManifest` into
 * `ExecutionOptions` and executes a live `AgentRuntime` instance inside the isolated probe workspace.
 */
export function createRuntimeMaterializedProbeExecutor(
  options: RuntimeMaterializedProbeBridgeOptions,
): ProbeTrialExecutor {
  const idFactory = options.idFactory ?? new UuidV7IdFactory();

  return async (params) => {
    const { manifest, materializedConfig, task, trialIndex, seed, workspacePath } =
      params;

    const runtime = await options.runtimeFactory({
      manifest,
      materializedConfig,
      workspacePath,
    });

    const goalId = createId<'Goal'>(
      `goal_${task.taskId}_r${trialIndex}_${idFactory.create<'Goal'>().slice(0, 6)}`,
    ) as GoalId;

    const goal: Goal = {
      id: goalId,
      description: task.prompt,
      status: GoalStatus.ACTIVE,
      constraints: {
        ...DEFAULT_GOAL_CONSTRAINTS,
        maxIterations: manifest.budgetProfile.maxIterationsPerProbe,
        maxDurationMs: manifest.budgetProfile.maxWallTimeMsPerProbe,
        maxCostDollars: manifest.budgetProfile.maxCostDollarsPerProbe,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        probeTaskId: task.taskId,
        probeSplit: task.split,
        probeSeed: seed,
        workspacePath,
        manifestId: manifest.id,
        manifestHash: manifest.contentHash,
      },
    };

    const executionOptions: ExecutionOptions = {
      architectMode: Boolean(materializedConfig['architectMode']),
      reasoningEffort:
        (materializedConfig['reasoningEffort'] as 'low' | 'medium' | 'high' | undefined) ??
        'medium',
      maxRetries: Number(materializedConfig['maxRetries'] ?? 2),
      requestTimeoutMs: Number(materializedConfig['requestTimeoutMs'] ?? 60_000),
      promptCaching: materializedConfig['enablePrefixCaching'] !== false,
      autoLintAfterWrite: materializedConfig['autoLintAfterWrite'] !== false,
      autoTestAfterWrite: materializedConfig['autoTestAfterWrite'] !== false,
      requireTdd: Boolean(materializedConfig['requireTdd']),
    };

    const result = await runtime.execute(goal, executionOptions);

    let promptTokens = 0;
    let completionTokens = 0;
    let cachedTokens = 0;
    let modelCalls = 0;
    let toolCalls = 0;
    let toolErrors = 0;
    let policyViolations = 0;
    let verifierPassed = result.success;

    for (const iter of result.iterations) {
      promptTokens += iter.tokenUsage.inputTokens;
      completionTokens += iter.tokenUsage.outputTokens;
      cachedTokens += iter.tokenUsage.cacheReadTokens ?? 0;
      modelCalls += 1;
      toolCalls += iter.toolResults.length;
      toolErrors += iter.toolResults.filter(
        (tr) => tr.status === ActionResultStatus.FAILURE,
      ).length;

      if (iter.phases?.policyDecisions) {
        policyViolations += iter.phases.policyDecisions.filter(
          (pd) => pd.decision === 'DENY',
        ).length;
      }
      if (iter.phases?.verificationResults?.performed) {
        verifierPassed = iter.phases.verificationResults.status === 'PASSED';
      }
    }

    if (promptTokens === 0 && result.totalTokens > 0) {
      promptTokens = Math.round(result.totalTokens * 0.85);
      completionTokens = result.totalTokens - promptTokens;
    }

    const totalTokens = promptTokens + completionTokens;
    const cacheHitRatio = promptTokens > 0 ? cachedTokens / promptTokens : 0;

    const failureSignalsObserved: FailureSignalType[] = [];
    if (toolErrors > 0) failureSignalsObserved.push('tool_error');
    if (policyViolations > 0) failureSignalsObserved.push('security_denial');
    if (!result.success && !verifierPassed) {
      failureSignalsObserved.push('mutation_without_verification');
    }

    const partialScore = result.success
      ? 1.0
      : verifierPassed
        ? 0.75
        : toolErrors === 0 && result.iterationCount > 0
          ? 0.4
          : 0.1;

    return {
      trialIndex,
      taskId: task.taskId,
      seed,
      success: result.success,
      partialScore,
      verifierPassed,
      iterationCount: result.iterationCount,
      promptTokens,
      completionTokens,
      cachedTokens,
      totalTokens,
      cacheHitRatio,
      modelCalls,
      toolCalls,
      toolErrors,
      policyViolations,
      regressionsDetected: 0,
      oscillationsDetected: 0,
      durationMs: result.durationMs,
      costDollars: result.totalCostDollars,
      contextMemoryTrafficTokens: totalTokens * Math.max(1, result.iterationCount),
      verificationCostDollars: Number((result.totalCostDollars * 0.15).toFixed(5)),
      finalPhase: result.status,
      failureSignalsObserved,
      outputArtifactRefs: [`exec-${result.executionId}`],
    };
  };
}
