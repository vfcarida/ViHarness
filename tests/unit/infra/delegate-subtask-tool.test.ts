import { describe, it, expect, vi } from 'vitest';
import {
  DelegateSubtaskTool,
  type SubtaskRunOptions,
  type SubtaskExecutionSummary,
} from '../../../src/infra/tools/builtin/delegate-subtask-tool.js';
import { createWorkspaceTools } from '../../../src/infra/tools/workspace-tools.js';

describe('DelegateSubtaskTool Suite', () => {
  it('rejects execution when prompt is empty or missing', async () => {
    const tool = new DelegateSubtaskTool();
    const result = await tool.execute({ prompt: '' }, { correlationId: 'c1' } as any);

    expect(result.success).toBe(false);
    expect(result.error).toBe('EMPTY_SUBTASK_PROMPT');
    expect(result.output).toContain('Missing or empty "prompt" parameter');
  });

  it('executes subtask runner successfully and returns synthesized markdown', async () => {
    let capturedPrompt = '';
    let capturedOptions: SubtaskRunOptions | undefined;

    const mockRunner = async (
      prompt: string,
      options: SubtaskRunOptions,
    ): Promise<SubtaskExecutionSummary> => {
      capturedPrompt = prompt;
      capturedOptions = options;
      return {
        success: true,
        status: 'COMPLETED',
        summary: 'Located authentication token refresh handler in src/auth/token.ts line 42.',
        iterationCount: 3,
        durationMs: 1250,
        totalTokens: 1840,
        totalCostDollars: 0.0035,
        keyFindings: ['Uses RS256 JWT validation', 'Expires in 3600 seconds'],
        outputFiles: ['src/auth/token.ts'],
      };
    };

    const tool = new DelegateSubtaskTool({ runner: mockRunner });
    const result = await tool.execute(
      {
        prompt: 'Find token renewal logic',
        scope: 'src/auth',
        maxIterations: 5,
        readOnly: true,
      },
      { correlationId: 'call-sub-1', taskId: 'parent-task-99' } as any,
    );

    expect(result.success).toBe(true);
    expect(capturedPrompt).toBe('Find token renewal logic');
    expect(capturedOptions?.scope).toBe('src/auth');
    expect(capturedOptions?.maxIterations).toBe(5);
    expect(capturedOptions?.readOnly).toBe(true);
    expect(capturedOptions?.parentTaskId).toBe('parent-task-99');

    // Ephemeral summary verification
    expect(result.output).toContain('### Sub-Agent Execution Completed');
    expect(result.output).toContain('**Status**: COMPLETED');
    expect(result.output).toContain('**Iterations**: 3 / 5');
    expect(result.output).toContain('**Tokens**: 1840');
    expect(result.output).toContain('Key Findings:');
    expect(result.output).toContain('Uses RS256 JWT validation');
    expect(result.output).toContain('src/auth/token.ts');

    // Metadata
    expect(result.metadata?.subtaskDepth).toBe(1);
    expect(result.metadata?.subtaskSuccess).toBe(true);
    expect(result.metadata?.totalTokens).toBe(1840);
  });

  it('enforces recursion safety and rejects nested subtask delegation when max depth is exceeded', async () => {
    const mockRunner = vi.fn();
    const tool = new DelegateSubtaskTool({ runner: mockRunner, maxSubtaskDepth: 2 });

    const result = await tool.execute(
      { prompt: 'Deeply nested subtask' },
      {
        correlationId: 'c-deep',
        metadata: { subtaskDepth: 2 }, // already at depth 2
      } as any,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('MAX_SUBTASK_DEPTH_EXCEEDED');
    expect(result.output).toContain('Maximum subtask nesting depth (2) reached');
    expect(mockRunner).not.toHaveBeenCalled();
  });

  it('handles subtask runner failures gracefully without crashing the caller', async () => {
    const failingRunner = async (): Promise<SubtaskExecutionSummary> => {
      throw new Error('Container network unreachable during subtask');
    };

    const tool = new DelegateSubtaskTool({ runner: failingRunner });
    const result = await tool.execute(
      { prompt: 'Run flaky subtask' },
      { correlationId: 'c-err' } as any,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Container network unreachable during subtask');
    expect(result.output).toContain('Subtask execution failed with unexpected error');
  });

  it('runs standalone fallback when no runner or runtime is injected', async () => {
    const tool = new DelegateSubtaskTool();
    const result = await tool.execute(
      { prompt: 'Standalone inspection', scope: 'lib' },
      { correlationId: 'c-standalone' } as any,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('Sub-agent completed task: "Standalone inspection"');
    expect(result.metadata?.subtaskDepth).toBe(1);
  });

  it('createWorkspaceTools registers delegate_subtask tool when enableDelegation is true', () => {
    const toolsWithoutDelegation = createWorkspaceTools('.');
    expect(toolsWithoutDelegation.map((t) => t.definition.name)).not.toContain('delegate_subtask');

    const toolsWithDelegation = createWorkspaceTools('.', { enableDelegation: true });
    expect(toolsWithDelegation.map((t) => t.definition.name)).toContain('delegate_subtask');
    expect(toolsWithDelegation.length).toBe(7);
  });

  it('createWorkspaceTools passes subtaskRunner to delegate_subtask tool', async () => {
    let runnerCalled = false;
    const tools = createWorkspaceTools('.', {
      subtaskRunner: async () => {
        runnerCalled = true;
        return {
          success: true,
          status: 'COMPLETED',
          summary: 'Runner called through factory',
          iterationCount: 1,
          durationMs: 50,
        };
      },
    });

    const subtaskTool = tools.find((t) => t.definition.name === 'delegate_subtask');
    expect(subtaskTool).toBeDefined();

    const res = await subtaskTool!.execute({ prompt: 'test' }, { correlationId: 'c1' } as any);
    expect(res.success).toBe(true);
    expect(runnerCalled).toBe(true);
  });
});
