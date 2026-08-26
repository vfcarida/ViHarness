import { describe, it, expect, beforeEach } from 'vitest';
import {
  DefaultToolExecutor,
  DefaultToolRegistry,
  ReadFileTool,
  WriteFileTool,
  RunCommandTool,
  CommandSanitizer,
  UuidV7IdFactory,
} from '../../../src/infra/index.js';
import { ToolCategory, PolicyDecisionType } from '../../../src/core/index.js';
import type { Tool, PolicyEngine } from '../../../src/core/index.js';

describe('Tool Execution Layer', () => {
  let executor: DefaultToolExecutor;
  let registry: DefaultToolRegistry;
  let idFactory: UuidV7IdFactory;

  beforeEach(() => {
    idFactory = new UuidV7IdFactory();
    registry = new DefaultToolRegistry();

    registry.register(new ReadFileTool(idFactory));
    registry.register(new WriteFileTool(idFactory));
    registry.register(new RunCommandTool(idFactory));

    executor = new DefaultToolExecutor({
      registry,
      idFactory,
    });
  });

  it('should register tools and filter by category (READ, WRITE, EXECUTE)', () => {
    const readTools = registry.listTools(ToolCategory.READ);
    const writeTools = registry.listTools(ToolCategory.WRITE);
    const execTools = registry.listTools(ToolCategory.EXECUTE);

    expect(readTools).toHaveLength(1);
    expect(readTools[0]!.definition.name).toBe('read_file');
    expect(writeTools[0]!.definition.name).toBe('write_file');
    expect(execTools[0]!.definition.name).toBe('run_command');
  });

  it('should validate tool input schemas and reject invalid arguments', async () => {
    const validation = registry.validateInput('read_file', {}); // Missing 'path'
    expect(validation.valid).toBe(false);
    expect(validation.errors).toBeDefined();

    await expect(
      executor.execute({
        toolName: 'read_file',
        input: {}, // Invalid
      }),
    ).rejects.toThrow();
  });

  it('should execute READ tool (read_file) deterministically', async () => {
    const result = await executor.execute({
      toolName: 'read_file',
      input: { path: 'src/index.ts' },
    });

    expect(result.success).toBe(true);
    expect(result.name).toBe('read_file');
    expect(result.output).toContain('src/index.ts');
    expect(result.toolCallId).toBeDefined();
    expect(result.metadata?.['correlationId']).toBeDefined();
  });

  it('should execute WRITE tool (write_file) deterministically', async () => {
    const result = await executor.execute({
      toolName: 'write_file',
      input: { path: 'dist/output.json', content: '{"status":"ok"}' },
    });

    expect(result.success).toBe(true);
    expect(result.name).toBe('write_file');
    expect(result.output).toContain('15 bytes');
  });

  it('should sanitize shell commands and block dangerous execution vectors', async () => {
    const dangerousCheck = CommandSanitizer.sanitize('sudo rm -rf /');
    expect(dangerousCheck.allowed).toBe(false);

    const safeCheck = CommandSanitizer.sanitize('  npm test  ');
    expect(safeCheck.allowed).toBe(true);
    expect(safeCheck.normalizedCommand).toBe('npm test');

    const result = await executor.execute({
      toolName: 'run_command',
      input: { command: 'sudo rm -rf /' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Forbidden shell command vector');
  });

  it('should reject tool execution when Policy Engine decision is DENY', async () => {
    const mockDenyPolicy: PolicyEngine = {
      evaluate: async (act) => ({
        decision: PolicyDecisionType.DENY,
        reason: 'Writing files is restricted by security policy',
        evaluatedAt: new Date(),
        action: act,
      }),
    };

    const policyExecutor = new DefaultToolExecutor({
      registry,
      policyEngine: mockDenyPolicy,
      idFactory,
    });

    const result = await policyExecutor.execute({
      toolName: 'write_file',
      input: { path: 'protected.config', content: 'data' },
      requiresPolicy: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Policy DENIED tool execution');
    expect(result.metadata?.['correlationId']).toBeDefined();
  });

  it('should enforce execution timeout for slow tools', async () => {
    const slowTool: Tool = {
      definition: {
        name: 'slow_tool',
        version: '1.0.0',
        description: 'Slow mock tool',
        category: ToolCategory.EXECUTE,
        riskLevel: 'LOW' as any,
        mutating: false,
        idempotent: true,
        defaultTimeoutMs: 50, // 50ms timeout
        requiredPermissions: [],
        inputSchema: { type: 'object' },
      },
      execute: async () => {
        await new Promise((r) => setTimeout(r, 200)); // Delays 200ms
        return {
          toolCallId: idFactory.create<'ToolCall'>(),
          name: 'slow_tool',
          output: 'Done',
          success: true,
          durationMs: 200,
        };
      },
    };

    registry.register(slowTool);

    await expect(
      executor.execute({
        toolName: 'slow_tool',
        input: {},
        context: { timeoutMs: 50 },
      }),
    ).rejects.toThrow();
  });

  it('should handle execution cancellation via AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort(); // Cancel upfront

    const result = await executor.execute({
      toolName: 'read_file',
      input: { path: 'src/main.ts' },
      context: { signal: controller.signal },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('cancelled via AbortSignal');
  });
});
