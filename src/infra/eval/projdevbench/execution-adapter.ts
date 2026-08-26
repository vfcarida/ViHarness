/**
 * ProjDevBench Execution Adapter.
 *
 * Configures workspace-scoped tools and runs the Vi-Harness agent loop against ProjDevBench specs.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import type { ProjDevProblem, ProjDevProblemScore } from './types.js';
import type { ProjDevIsolatedWorkspace } from './workspace-manager.js';
import { ProjDevTaskLoader } from './task-loader.js';
import { ProjDevEvaluator } from './evaluator.js';
import type { AgentRuntime } from '../../../core/interfaces/agent-runtime.js';
import type { ExecutionOptions } from '../../../core/model/runtime-types.js';
import type { Tool } from '../../../core/interfaces/tool.js';
import { ToolCategory, ToolRiskLevel } from '../../../core/model/tool-types.js';
import { DefaultToolRegistry } from '../../tools/default-tool-registry.js';
import { DefaultToolExecutor } from '../../tools/default-tool-executor.js';
import type { IdFactory } from '../../../core/types/identifiers.js';
import type { Clock } from '../../../core/interfaces/clock.js';
import { HarnessError } from '../../../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../../core/errors/error-codes.js';

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
    const sanitizePath = (targetPath: string): string => {
      const resolved = path.resolve(workspacePath, targetPath);
      if (!resolved.startsWith(workspacePath)) {
        throw new HarnessError({
          code: ErrorCode.POLICY_DENIED,
          category: ErrorCategory.POLICY,
          message: `Path traversal violation: Access outside workspace is denied (${targetPath})`,
        });
      }
      return resolved;
    };

    const readFileTool: Tool = {
      definition: {
        name: 'read_file',
        version: '1.0.0',
        description: 'Read the contents of a file inside the project workspace.',
        category: ToolCategory.READ,
        riskLevel: ToolRiskLevel.LOW,
        mutating: false,
        idempotent: true,
        defaultTimeoutMs: 30000,
        requiredPermissions: [],
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      execute: async (input, context) => {
        const start = Date.now();
        const callId = (context?.correlationId ?? this.idFactory.create<'ToolCall'>()) as any;
        try {
          const filePath = sanitizePath(String(input['path']));
          if (!fs.existsSync(filePath)) {
            return {
              toolCallId: callId,
              name: 'read_file',
              success: false,
              output: `File not found: ${input['path']}`,
              durationMs: Date.now() - start,
            };
          }
          const content = fs.readFileSync(filePath, 'utf-8');
          return {
            toolCallId: callId,
            name: 'read_file',
            success: true,
            output: content,
            durationMs: Date.now() - start,
          };
        } catch (err: any) {
          return {
            toolCallId: callId,
            name: 'read_file',
            success: false,
            output: err.message,
            durationMs: Date.now() - start,
          };
        }
      },
    };

    const writeFileTool: Tool = {
      definition: {
        name: 'write_file',
        version: '1.0.0',
        description: 'Write content to a file inside the project workspace.',
        category: ToolCategory.WRITE,
        riskLevel: ToolRiskLevel.MEDIUM,
        mutating: true,
        idempotent: false,
        defaultTimeoutMs: 30000,
        requiredPermissions: [],
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
      },
      execute: async (input, context) => {
        const start = Date.now();
        const callId = (context?.correlationId ?? this.idFactory.create<'ToolCall'>()) as any;
        try {
          const filePath = sanitizePath(String(input['path']));
          const parentDir = path.dirname(filePath);
          if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
          }
          fs.writeFileSync(filePath, String(input['content'] ?? ''), 'utf-8');
          return {
            toolCallId: callId,
            name: 'write_file',
            success: true,
            output: `Successfully wrote ${input['path']}`,
            durationMs: Date.now() - start,
          };
        } catch (err: any) {
          return {
            toolCallId: callId,
            name: 'write_file',
            success: false,
            output: err.message,
            durationMs: Date.now() - start,
          };
        }
      },
    };

    const listDirTool: Tool = {
      definition: {
        name: 'list_directory',
        version: '1.0.0',
        description: 'List files and directories in the project workspace.',
        category: ToolCategory.READ,
        riskLevel: ToolRiskLevel.LOW,
        mutating: false,
        idempotent: true,
        defaultTimeoutMs: 30000,
        requiredPermissions: [],
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
        },
      },
      execute: async (input, context) => {
        const start = Date.now();
        const callId = (context?.correlationId ?? this.idFactory.create<'ToolCall'>()) as any;
        try {
          const dirPath = input['path'] ? sanitizePath(String(input['path'])) : workspacePath;
          if (!fs.existsSync(dirPath)) {
            return {
              toolCallId: callId,
              name: 'list_directory',
              success: false,
              output: `Directory not found: ${input['path']}`,
              durationMs: Date.now() - start,
            };
          }
          const entries = fs.readdirSync(dirPath, { withFileTypes: true });
          const listing = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n');
          return {
            toolCallId: callId,
            name: 'list_directory',
            success: true,
            output: listing || '(empty directory)',
            durationMs: Date.now() - start,
          };
        } catch (err: any) {
          return {
            toolCallId: callId,
            name: 'list_directory',
            success: false,
            output: err.message,
            durationMs: Date.now() - start,
          };
        }
      },
    };

    const runCommandTool: Tool = {
      definition: {
        name: 'run_command',
        version: '1.0.0',
        description: 'Run a shell command inside the project workspace directory.',
        category: ToolCategory.EXECUTE,
        riskLevel: ToolRiskLevel.MEDIUM,
        mutating: true,
        idempotent: false,
        defaultTimeoutMs: 30000,
        requiredPermissions: [],
        inputSchema: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      },
      execute: async (input, context) => {
        const start = Date.now();
        const callId = (context?.correlationId ?? this.idFactory.create<'ToolCall'>()) as any;
        const cmd = String(input['command']);
        return new Promise((resolve) => {
          child_process.exec(
            cmd,
            { cwd: workspacePath, timeout: 30000, maxBuffer: 5 * 1024 * 1024 },
            (error, stdout, stderr) => {
              if (error) {
                resolve({
                  toolCallId: callId,
                  name: 'run_command',
                  success: false,
                  output: `Exit Code ${(error as any).code ?? 1}\nStdout: ${stdout}\nStderr: ${stderr}`,
                  durationMs: Date.now() - start,
                });
              } else {
                resolve({
                  toolCallId: callId,
                  name: 'run_command',
                  success: true,
                  output: stdout || '(command produced no output)',
                  durationMs: Date.now() - start,
                });
              }
            },
          );
        });
      },
    };

    return [readFileTool, writeFileTool, listDirTool, runCommandTool];
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
