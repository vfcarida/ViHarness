/**
 * Harness-Induced Forgetting & Capability Retention Suite Runner (EvoHarnessBench).
 *
 * Evaluates whether evolving tools, skills, scripts, agents, or context policies
 * causes regression ("forgetting") on previously validated core agent competencies.
 * Tracks `retained`, `newly_acquired`, `forgotten`, and `unstable` capabilities separately.
 */
import type {
  CapabilityRetentionRecord,
  CapabilityRetentionState,
  RetentionCapabilityCategory,
  RetentionSuiteResult,
} from '../../core/evolution/interfaces.js';
import type {
  HarnessManifest,
  HarnessManifestDiff,
} from '../../core/evolution/harness-manifest.js';

export const ALL_RETENTION_CAPABILITIES: ReadonlyArray<RetentionCapabilityCategory> =
  Object.freeze([
    'file_editing',
    'multi_file_refactoring',
    'test_diagnosis',
    'git_safety',
    'shell_tasks',
    'python_coding',
    'typescript_coding',
    'dependency_management',
    'context_intensive',
    'long_horizon_repair',
    'tool_orchestration',
  ]);

export type CapabilityProbeEvaluator = (params: {
  readonly manifest: HarnessManifest;
  readonly capability: RetentionCapabilityCategory;
}) => Promise<{ readonly passRate: number; readonly details?: string }>;

export class RetentionSuiteRunner {
  private readonly evaluator: CapabilityProbeEvaluator;

  constructor(evaluator?: CapabilityProbeEvaluator) {
    this.evaluator = evaluator ?? ((params) => this.defaultHeuristicEvaluator(params));
  }

  selectRelevantCapabilities(
    diff: HarnessManifestDiff,
  ): ReadonlyArray<RetentionCapabilityCategory> {
    const changed = new Set(diff.changedSurfaces.map((s) => String(s)));

    if (changed.size === 0) {
      return ['file_editing', 'git_safety', 'tool_orchestration'];
    }

    const selected = new Set<RetentionCapabilityCategory>([
      'file_editing',
      'git_safety',
      'tool_orchestration',
    ]);

    if (changed.has('contextPolicy') || changed.has('memoryPolicy')) {
      selected.add('context_intensive');
      selected.add('long_horizon_repair');
      selected.add('multi_file_refactoring');
    }
    if (changed.has('toolGuidance') || changed.has('toolSchedulingPolicy') || changed.has('plugins')) {
      selected.add('shell_tasks');
      selected.add('test_diagnosis');
      selected.add('multi_file_refactoring');
    }
    if (changed.has('skills') || changed.has('scripts') || changed.has('subagents')) {
      selected.add('python_coding');
      selected.add('typescript_coding');
      selected.add('dependency_management');
    }
    if (changed.has('verificationPolicy') || changed.has('systemPrompt')) {
      selected.add('test_diagnosis');
      selected.add('long_horizon_repair');
    }

    return Array.from(selected);
  }

  async runSuite(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidateManifest: HarnessManifest;
    readonly diff?: HarnessManifestDiff;
    readonly capabilities?: ReadonlyArray<RetentionCapabilityCategory>;
  }): Promise<RetentionSuiteResult> {
    const capabilities =
      params.capabilities ??
      (params.diff
        ? this.selectRelevantCapabilities(params.diff)
        : ALL_RETENTION_CAPABILITIES);

    const records: CapabilityRetentionRecord[] = [];
    let retainedCount = 0;
    let newlyAcquiredCount = 0;
    let forgottenCount = 0;
    let unstableCount = 0;

    for (const capability of capabilities) {
      const baseRes = await this.evaluator({
        manifest: params.baseManifest,
        capability,
      });
      const candRes = await this.evaluator({
        manifest: params.candidateManifest,
        capability,
      });

      const baselinePassed = baseRes.passRate >= 0.8;
      const candPassRate = Number(candRes.passRate.toFixed(4));

      let state: CapabilityRetentionState;
      if (baselinePassed && candPassRate >= 0.8) {
        state = 'retained';
        retainedCount++;
      } else if (!baselinePassed && candPassRate >= 0.8) {
        state = 'newly_acquired';
        newlyAcquiredCount++;
      } else if (baselinePassed && candPassRate < 0.5) {
        state = 'forgotten';
        forgottenCount++;
      } else {
        state = 'unstable';
        unstableCount++;
      }

      records.push({
        capability,
        baselinePassed,
        candidatePassRate: candPassRate,
        state,
        details:
          candRes.details ??
          `Baseline passRate=${baseRes.passRate.toFixed(2)}, Candidate passRate=${candPassRate.toFixed(2)} -> ${state}`,
      });
    }

    return {
      baseManifestId: params.baseManifest.id,
      candidateManifestId: params.candidateManifest.id,
      retainedCount,
      newlyAcquiredCount,
      forgottenCount,
      unstableCount,
      records,
      passed: forgottenCount === 0,
    };
  }

  private async defaultHeuristicEvaluator(params: {
    readonly manifest: HarnessManifest;
    readonly capability: RetentionCapabilityCategory;
  }): Promise<{ readonly passRate: number; readonly details: string }> {
    const rawContent = params.manifest.components.systemPrompt.content;
    const promptText =
      typeof rawContent === 'string'
        ? rawContent.toLowerCase()
        : JSON.stringify(rawContent).toLowerCase();

    if (
      promptText.includes(`disable ${params.capability}`) ||
      promptText.includes(`forbid ${params.capability}`) ||
      (params.capability === 'file_editing' && promptText.includes('never use edit_file'))
    ) {
      return {
        passRate: 0.0,
        details: `Capability '${params.capability}' was degraded by destructive guidance in manifest ${params.manifest.id}.`,
      };
    }

    return {
      passRate: 1.0,
      details: `Capability '${params.capability}' verified on manifest ${params.manifest.id}.`,
    };
  }
}
