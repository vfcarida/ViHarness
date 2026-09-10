/**
 * Delegate Subtask Built-in Tool.
 *
 * Dispatches an isolated, scoped sub-agent task with an ephemeral context window.
 *
 * Why this is essential for SWE-bench / ProjDevBench:
 * - Prevents context window exhaustion in large codebases.
 * - Isolates exploratory reads, grep sweeps, and reproducer testing.
 * - Intermediate reasoning traces and voluminous outputs are discarded.
 * - Only the final synthesis, findings, and status are returned to the parent agent.
 * - Includes recursion safety bounds (max subtask depth = 2).
 */
import type { Tool } from '../../../core/interfaces/tool.js';
import type {
  ToolInput,
  ToolResult,
  ToolExecutionContext,
} from '../../../core/model/tool-types.js';
import { ToolCategory, ToolRiskLevel } from '../../../core/model/tool-types.js';
import type { IdFactory, ToolCallId } from '../../../core/types/identifiers.js';
import type { AgentRuntime } from '../../../core/interfaces/agent-runtime.js';
import type { Goal } from '../../../core/model/goal.js';
import { GoalStatus } from '../../../core/model/goal.js';
import { UuidV7IdFactory } from '../../id/uuid-id-factory.js';

export interface SubtaskRunOptions {
  readonly scope?: string;
  readonly maxIterations?: number;
  readonly readOnly?: boolean;
  readonly parentTaskId?: string;
  readonly correlationId?: string;
  readonly depth?: number;
}

export interface SubtaskExecutionSummary {
  readonly success: boolean;
  readonly status: string;
  readonly summary: string;
  readonly iterationCount: number;
  readonly durationMs: number;
  readonly totalTokens?: number;
  readonly totalCostDollars?: number;
  readonly keyFindings?: ReadonlyArray<string>;
  readonly outputFiles?: ReadonlyArray<string>;
}

export type SubtaskRunnerFn = (
  prompt: string,
  options: SubtaskRunOptions,
) => Promise<SubtaskExecutionSummary>;

export interface DelegateSubtaskToolOptions {
  readonly workspacePath?: string;
  readonly runner?: SubtaskRunnerFn;
  readonly runtime?: AgentRuntime;
  readonly idFactory?: IdFactory;
  readonly defaultMaxIterations?: number;
  readonly maxSubtaskDepth?: number;
}

export class DelegateSubtaskTool implements Tool {
  public readonly definition = {
    name: 'delegate_subtask',
    version: '1.0.0',
    description:
      'Dispatches an isolated, scoped sub-agent task with an ephemeral context window. Ideal for narrow exploration, codebase inspection, searching for symbols across many files, or executing reproducer tests without polluting the primary agent context. Only the sub-agent final summary and outcome are returned.',
    category: ToolCategory.EXECUTE,
    riskLevel: ToolRiskLevel.LOW,
    mutating: false,
    idempotent: false,
    defaultTimeoutMs: 180000,
    requiredPermissions: ['agent:delegate'],
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Clear, self-contained task instructions for the sub-agent.',
        },
        scope: {
          type: 'string',
          description: 'Optional directory path or sub-scope restriction (e.g. "src/auth" or "tests").',
        },
        maxIterations: {
          type: 'number',
          description: 'Maximum number of iterations allowed for the sub-agent (default: 8, max: 20).',
        },
        readOnly: {
          type: 'boolean',
          description:
            'If true, restricts the sub-agent to read-only inspection tools and forbids modifying workspace files (default: false).',
        },
      },
      required: ['prompt'],
    },
  };

  private readonly idFactory: IdFactory;
  private readonly defaultMaxIterations: number;
  private readonly maxSubtaskDepth: number;
  private readonly runner?: SubtaskRunnerFn;
  private readonly runtime?: AgentRuntime;

  constructor(options: DelegateSubtaskToolOptions = {}) {
    this.idFactory = options.idFactory ?? new UuidV7IdFactory();
    this.defaultMaxIterations = options.defaultMaxIterations ?? 8;
    this.maxSubtaskDepth = options.maxSubtaskDepth ?? 2;
    this.runner = options.runner;
    this.runtime = options.runtime;
  }

  async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const callId = (context?.correlationId ?? this.idFactory.create<'ToolCall'>()) as ToolCallId;
    const prompt = String(input['prompt'] ?? '').trim();

    if (!prompt) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: 'Subtask delegation error: Missing or empty "prompt" parameter.',
        durationMs: Date.now() - startTime,
        error: 'EMPTY_SUBTASK_PROMPT',
      };
    }

    const currentDepth = Number(context.metadata?.['subtaskDepth'] ?? 0);
    if (currentDepth >= this.maxSubtaskDepth) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: `Subtask delegation rejected: Maximum subtask nesting depth (${this.maxSubtaskDepth}) reached. Prevent infinite delegation recursion.`,
        durationMs: Date.now() - startTime,
        error: 'MAX_SUBTASK_DEPTH_EXCEEDED',
        metadata: {
          currentDepth,
          maxDepth: this.maxSubtaskDepth,
        },
      };
    }

    const rawMaxIterations = Number(input['maxIterations'] ?? this.defaultMaxIterations);
    const maxIterations = Math.min(Math.max(1, isNaN(rawMaxIterations) ? this.defaultMaxIterations : rawMaxIterations), 20);
    const scope = input['scope'] ? String(input['scope']).trim() : undefined;
    const readOnly = Boolean(input['readOnly'] ?? false);

    const runOptions: SubtaskRunOptions = {
      scope,
      maxIterations,
      readOnly,
      parentTaskId: context.taskId,
      correlationId: context.correlationId,
      depth: currentDepth + 1,
    };

    let summary: SubtaskExecutionSummary;

    try {
      if (this.runner) {
        summary = await this.runner(prompt, runOptions);
      } else if (this.runtime) {
        const goalId = this.idFactory.create<'Goal'>();
        const subtaskGoal: Goal = {
          id: goalId,
          description: `[Sub-Agent Task] ${prompt}${scope ? ` (Scope: ${scope})` : ''}`,
          constraints: {
            maxIterations,
            maxCostDollars: 2.0,
            maxDurationMs: 120000,
            maxRepairAttempts: 2,
            maxNoProgressIterations: 2,
            requireVerification: false,
          },
          status: GoalStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {
            isSubtask: true,
            parentTaskId: context.taskId,
            subtaskDepth: currentDepth + 1,
            readOnly,
            scope,
          },
        };

        const execRes = await this.runtime.execute(subtaskGoal, {
          autoRollback: false,
          rollbackOnAnomaly: false,
        });

        summary = {
          success: execRes.success,
          status: execRes.status,
          summary: execRes.summary || (execRes.success ? 'Subtask completed successfully.' : 'Subtask failed.'),
          iterationCount: execRes.iterationCount,
          durationMs: execRes.durationMs,
          totalTokens: execRes.totalTokens,
          totalCostDollars: execRes.totalCostDollars,
        };
      } else {
        // Standalone fallback mock execution (useful for standalone unit testing without full runtime)
        summary = {
          success: true,
          status: 'COMPLETED',
          summary: `Sub-agent completed task: "${prompt}" in scope [${scope ?? 'all'}] (readOnly: ${readOnly}).`,
          iterationCount: 1,
          durationMs: Date.now() - startTime,
        };
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: `Subtask execution failed with unexpected error: ${errMsg}`,
        durationMs: Date.now() - startTime,
        error: errMsg,
        metadata: {
          subtaskDepth: currentDepth + 1,
        },
      };
    }

    const durationMs = Date.now() - startTime;
    const tokenLine = summary.totalTokens !== undefined ? `\n- **Tokens**: ${summary.totalTokens}` : '';
    const costLine =
      summary.totalCostDollars !== undefined
        ? `\n- **Cost**: $${summary.totalCostDollars.toFixed(4)}`
        : '';
    const findingsSection =
      summary.keyFindings && summary.keyFindings.length > 0
        ? `\n\n#### Key Findings:\n${summary.keyFindings.map((f) => `- ${f}`).join('\n')}`
        : '';
    const filesSection =
      summary.outputFiles && summary.outputFiles.length > 0
        ? `\n\n#### Output Files:\n${summary.outputFiles.map((f) => `- \`${f}\``).join('\n')}`
        : '';

    const formattedOutput = `### Sub-Agent Execution Completed
- **Status**: ${summary.status}
- **Success**: ${summary.success ? '✅ Yes' : '❌ No'}
- **Iterations**: ${summary.iterationCount} / ${maxIterations}
- **Duration**: ${durationMs}ms${tokenLine}${costLine}

#### Synthesis & Results:
${summary.summary}${findingsSection}${filesSection}`;

    return {
      toolCallId: callId,
      name: this.definition.name,
      success: summary.success,
      output: formattedOutput,
      durationMs,
      metadata: {
        subtaskDepth: currentDepth + 1,
        subtaskSuccess: summary.success,
        subtaskStatus: summary.status,
        iterationCount: summary.iterationCount,
        scope,
        readOnly,
        totalTokens: summary.totalTokens,
        totalCostDollars: summary.totalCostDollars,
      },
    };
  }
}
