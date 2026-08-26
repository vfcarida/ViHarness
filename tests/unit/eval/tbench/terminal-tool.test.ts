/**
 * Terminal Tool Unit Tests (P011).
 */
import { describe, it, expect } from 'vitest';
import { TerminalTool } from '../../../../src/infra/tools/terminal-tool.js';
import { MockDockerEnvironment, type TBenchTask } from '../../../../src/infra/eval/tbench/index.js';
import { UuidV7IdFactory } from '../../../../src/infra/id/uuid-id-factory.js';
import { ToolCategory, ToolRiskLevel } from '../../../../src/core/model/tool-types.js';

describe('Terminal Tool — P011', () => {
  const idFactory = new UuidV7IdFactory();
  const sampleTask: TBenchTask = {
    id: 'terminal-tool-test',
    instruction: 'Echo test message',
    category: 'software-engineering',
    difficulty: 'easy',
    tags: ['test'],
    timeout: 30,
    testScript: 'exit 0',
  };

  it('1. should conform to canonical Vi-Harness Tool definition schema', () => {
    const env = new MockDockerEnvironment();
    const tool = new TerminalTool({
      dockerEnv: env,
      container: {
        id: 'c1',
        name: 'c1',
        task: sampleTask,
        status: 'running',
        createdAt: Date.now(),
        workdir: '',
      },
      idFactory,
    });

    expect(tool.definition.name).toBe('terminal');
    expect(tool.definition.category).toBe(ToolCategory.COMMAND);
    expect(tool.definition.riskLevel).toBe(ToolRiskLevel.MEDIUM);
    expect(tool.definition.mutating).toBe(true);
    expect(tool.definition.inputSchema.required).toContain('command');
  });

  it('2. should execute command via docker environment and return structured ToolResult', async () => {
    const env = new MockDockerEnvironment();
    const container = await env.create(sampleTask);
    const tool = new TerminalTool({ dockerEnv: env, container, idFactory });

    const result = await tool.execute({
      command: 'node -e "console.log(\'TERMINAL_TOOL_ECHO\');"',
    });

    expect(result.success).toBe(true);
    expect(result.name).toBe('terminal');
    expect(result.output).toContain('TERMINAL_TOOL_ECHO');
    expect(result.metadata?.['exitCode']).toBe(0);

    await env.destroy(container);
  });

  it('3. should handle non-zero exit codes with success = false and error details', async () => {
    const env = new MockDockerEnvironment();
    const container = await env.create(sampleTask);
    const tool = new TerminalTool({ dockerEnv: env, container, idFactory });

    const result = await tool.execute({
      command: 'node -e "console.error(\'FAIL_MSG\'); process.exit(1);"',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.metadata?.['exitCode']).toBe(1);

    await env.destroy(container);
  });

  it('4. should return error for empty command input', async () => {
    const env = new MockDockerEnvironment();
    const container = await env.create(sampleTask);
    const tool = new TerminalTool({ dockerEnv: env, container, idFactory });

    const result = await tool.execute({ command: '   ' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('Empty command provided');

    await env.destroy(container);
  });

  it('5. should propagate correlationId from ToolExecutionContext into toolCallId', async () => {
    const env = new MockDockerEnvironment();
    const container = await env.create(sampleTask);
    const tool = new TerminalTool({ dockerEnv: env, container, idFactory });

    const result = await tool.execute(
      { command: 'node -e "console.log(\'CORRELATION_TEST\')"' },
      { correlationId: 'corr-id-999' as any },
    );

    expect(result.success).toBe(true);
    expect(result.toolCallId).toBe('corr-id-999');

    await env.destroy(container);
  });

  it('6. should catch execution errors if docker environment throws', async () => {
    const errorEnv = {
      create: async () => ({}) as any,
      exec: async () => {
        throw new Error('Connection refused to Docker daemon');
      },
      verify: async () => false,
      destroy: async () => {},
    };

    const tool = new TerminalTool({
      dockerEnv: errorEnv,
      container: {
        id: 'c1',
        name: 'c1',
        task: sampleTask,
        status: 'running',
        createdAt: Date.now(),
        workdir: '',
      },
      idFactory,
    });

    const result = await tool.execute({ command: 'ls -la' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection refused');
  });
});
