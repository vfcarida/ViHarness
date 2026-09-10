/**
 * ProjDevBench Execution Adapter.
 *
 * Configures workspace-scoped tools and runs the Vi-Harness agent loop against ProjDevBench specs.
 */
import type { ProjDevProblem, ProjDevProblemScore } from './types.js';
import type { ProjDevIsolatedWorkspace } from './workspace-manager.js';
import { ProjDevTaskLoader } from './task-loader.js';
import { ProjDevEvaluator } from './evaluator.js';
import type { AgentRuntime } from '../../../core/interfaces/agent-runtime.js';
import type { ExecutionOptions } from '../../../core/model/runtime-types.js';
import type { Tool } from '../../../core/interfaces/tool.js';
import { DefaultToolRegistry } from '../../tools/default-tool-registry.js';
import { DefaultToolExecutor } from '../../tools/default-tool-executor.js';
import type { IdFactory } from '../../../core/types/identifiers.js';
import type { Clock } from '../../../core/interfaces/clock.js';
import { createWorkspaceTools } from '../../tools/workspace-tools.js';

export interface ProjDevExecutionAdapterOptions {
  readonly runtime: AgentRuntime;
  readonly idFactory: IdFactory;
  readonly clock?: Clock;
  readonly evaluator?: ProjDevEvaluator;
}

export class ProjDevExecutionAdapter {
  private readonly runtime: AgentRuntime;
  private readonly idFactory: IdFactory;
  private readonly evaluator: ProjDevEvaluator;

  constructor(options: ProjDevExecutionAdapterOptions) {
    this.runtime = options.runtime;
    this.idFactory = options.idFactory;
    this.evaluator = options.evaluator ?? new ProjDevEvaluator();
  }

  /**
   * Creates workspace-scoped filesystem and execution tools for the problem.
   */
  createWorkspaceTools(workspacePath: string): Tool[] {
    return createWorkspaceTools(workspacePath, { idFactory: this.idFactory });
  }

  /**
   * Executes a ProjDevBench problem using the agent runtime and evaluates the result.
   */
  async runProblem(
    problem: ProjDevProblem,
    workspace: ProjDevIsolatedWorkspace,
    executionOptions?: Partial<ExecutionOptions>,
  ): Promise<ProjDevProblemScore> {
    const goal = ProjDevTaskLoader.mapProblemToGoal(problem, this.idFactory);

    // Build workspace-scoped tool registry & executor
    const tools = this.createWorkspaceTools(workspace.workspacePath);
    const registry = new DefaultToolRegistry();
    for (const t of tools) {
      registry.register(t);
    }
    const toolExecutor = new DefaultToolExecutor({
      registry,
      idFactory: this.idFactory,
    });

    const runtimeOptions: ExecutionOptions = {
      ...executionOptions,
      toolExecutor,
      architectMode: executionOptions?.architectMode ?? false,
    };

    // Execute agent loop
    let result;

    try {
      result = await this.runtime.execute(goal, runtimeOptions);
    } catch (err: any) {
      result = {
        executionId: this.idFactory.create<'Execution'>(),
        goalId: goal.id,
        taskId: this.idFactory.create<'Task'>(),
        success: false,
        status: 'FAILED' as any,
        summary: `Runtime execution error: ${err.message}`,
        iterationCount: 0,
        durationMs: 0,
        totalCostDollars: 0,
        totalTokens: 0,
        iterations: [],
      };
    }

    const tokenUsage = {
      inputTokens: Math.round(result.totalTokens * 0.8),
      outputTokens: Math.round(result.totalTokens * 0.2),
      totalTokens: result.totalTokens,
    };

    // Score problem through dual evaluation protocol
    const score = await this.evaluator.evaluateProblem({
      problem,
      workspacePath: workspace.workspacePath,
      tokenUsage,
      costDollars: result.totalCostDollars,
      durationMs: result.durationMs,
      iterationCount: result.iterationCount,
      runtimeSuccess: result.success,
    });

    return score;
  }
}
