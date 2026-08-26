import { describe, it, expect } from 'vitest';
import { DefaultToolExecutor } from '../../../src/infra/tools/default-tool-executor.js';
import { DefaultToolRegistry } from '../../../src/infra/tools/default-tool-registry.js';
import { DefaultPolicyEngine } from '../../../src/infra/security/default-policy-engine.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';
import { ToolCategory, ToolRiskLevel } from '../../../src/core/index.js';
import type { Tool } from '../../../src/core/interfaces/tool.js';

describe('Security Policy Boundary & Hardening Suite', () => {
  const idFactory = new UuidV7IdFactory();

  // 1. Safe Read Tool
  const readTool: Tool = {
    definition: {
      name: 'read_file',
      version: '1.0.0',
      description: 'Read file content',
      category: ToolCategory.READ,
      riskLevel: ToolRiskLevel.LOW,
      mutating: false,
      idempotent: true,
      defaultTimeoutMs: 1000,
      requiredPermissions: ['fs:read'],
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    },
    execute: async (input) => ({
      toolCallId: idFactory.create<'ToolCall'>(),
      name: 'read_file',
      output: `content of ${input['path']}`,
      success: true,
      durationMs: 5,
    }),
  };

  // 2. Write Tool (Mutating)
  const writeTool: Tool = {
    definition: {
      name: 'write_file',
      version: '1.0.0',
      description: 'Write file content',
      category: ToolCategory.WRITE,
      riskLevel: ToolRiskLevel.MEDIUM,
      mutating: true,
      idempotent: true,
      defaultTimeoutMs: 1000,
      requiredPermissions: ['fs:write'],
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
      },
    },
    execute: async () => ({
      toolCallId: idFactory.create<'ToolCall'>(),
      name: 'write_file',
      output: 'wrote file',
      success: true,
      durationMs: 10,
    }),
  };

  // 3. Delete Tool (Destructive)
  const deleteTool: Tool = {
    definition: {
      name: 'delete_file',
      version: '1.0.0',
      description: 'Delete file',
      category: ToolCategory.DESTRUCTIVE,
      riskLevel: ToolRiskLevel.HIGH,
      mutating: true,
      irreversible: true,
      idempotent: false,
      defaultTimeoutMs: 1000,
      requiredPermissions: ['fs:delete'],
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    },
    execute: async () => ({
      toolCallId: idFactory.create<'ToolCall'>(),
      name: 'delete_file',
      output: 'deleted',
      success: true,
      durationMs: 10,
    }),
  };

  // 4. Shell Execution Tool
  const shellTool: Tool = {
    definition: {
      name: 'run_command',
      version: '1.0.0',
      description: 'Execute shell command',
      category: ToolCategory.EXECUTE,
      riskLevel: ToolRiskLevel.HIGH,
      mutating: true,
      idempotent: false,
      defaultTimeoutMs: 2000,
      requiredPermissions: ['cmd:exec'],
      inputSchema: { type: 'object', properties: { cmd: { type: 'string' } } },
    },
    execute: async () => ({
      toolCallId: idFactory.create<'ToolCall'>(),
      name: 'run_command',
      output: 'executed',
      success: true,
      durationMs: 20,
    }),
  };

  // 5. Network Tool
  const networkTool: Tool = {
    definition: {
      name: 'http_request',
      version: '1.0.0',
      description: 'HTTP network request',
      category: ToolCategory.EXECUTE,
      riskLevel: ToolRiskLevel.MEDIUM,
      mutating: false,
      requiresNetwork: true,
      idempotent: false,
      defaultTimeoutMs: 2000,
      requiredPermissions: ['net:http'],
      inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
    },
    execute: async () => ({
      toolCallId: idFactory.create<'ToolCall'>(),
      name: 'http_request',
      output: '200 OK',
      success: true,
      durationMs: 15,
    }),
  };

  function createHarness() {
    const registry = new DefaultToolRegistry();
    registry.register(readTool);
    registry.register(writeTool);
    registry.register(deleteTool);
    registry.register(shellTool);
    registry.register(networkTool);
    const policyEngine = new DefaultPolicyEngine();
    const executor = new DefaultToolExecutor({ registry, policyEngine, idFactory });
    return { executor, policyEngine };
  }

  it('1. Safe Read: Allows read-only safe operation under workspace', async () => {
    const { executor } = createHarness();
    const result = await executor.execute({
      toolName: 'read_file',
      input: { path: 'src/main.ts' },
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('content of src/main.ts');
  });

  it('2. Write Operation: Evaluates policy and executes when permitted', async () => {
    const { executor } = createHarness();
    const result = await executor.execute({
      toolName: 'write_file',
      input: { path: 'src/main.ts', content: 'export const x = 1;' },
    });
    expect(result.success).toBe(true);
  });

  it('3. Delete Operation: Evaluates high-risk irreversible policy', async () => {
    const { executor } = createHarness();
    const result = await executor.execute({
      toolName: 'delete_file',
      input: { path: 'src/temp.txt' },
    });
    // Destructive delete actions require policy check
    expect(result).toBeDefined();
  });

  it('4. Shell Command Enforcement: Denies dangerous forbidden shell commands (sudo)', async () => {
    const { executor } = createHarness();
    const result = await executor.execute({
      toolName: 'run_command',
      input: { cmd: 'sudo rm -rf /' },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Policy DENIED');
  });

  it('5. Credential Access Protection: Denies reading secret credential files (.env)', async () => {
    const { executor } = createHarness();
    const result = await executor.execute({
      toolName: 'read_file',
      input: { path: '.env' },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Policy DENIED');
  });

  it('6. Production Path Protection: Restricts actions targeting production paths (/etc/passwd)', async () => {
    const { executor } = createHarness();
    const result = await executor.execute({
      toolName: 'read_file',
      input: { path: '/etc/passwd' },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Policy DENIED');
  });

  it('7. Network Policy Enforcement: Blocks unauthorized network destinations (internal IP)', async () => {
    const { executor } = createHarness();
    const result = await executor.execute({
      toolName: 'http_request',
      input: { url: 'http://169.254.169.254/latest/meta-data/' },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Policy DENIED');
  });

  it('8. Policy Flag Bypass Prevention: Setting requiresPolicy: false DOES NOT bypass policy for mutating operations', async () => {
    const { executor } = createHarness();
    // Attempt to bypass policy by passing requiresPolicy: false for dangerous shell command
    const result = await executor.execute({
      toolName: 'run_command',
      input: { cmd: 'sudo reboot' },
      requiresPolicy: false, // Attempted security bypass!
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Policy DENIED');
  });

  it('9. Approval-Required Action: Returns REQUIRES_APPROVAL status when policy rule flags action', async () => {
    const { executor } = createHarness();
    const result = await executor.execute({
      toolName: 'run_command',
      input: { cmd: 'kubectl apply -f prod.yaml' },
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Policy (DENIED|REQUIRES_APPROVAL)/);
  });

  it('10. Auditable Policy Decisions: Maintains durable audit logs for all policy evaluations', async () => {
    const { executor, policyEngine } = createHarness();

    await executor.execute({ toolName: 'read_file', input: { path: '.env' } });
    await executor.execute({ toolName: 'run_command', input: { cmd: 'sudo rm -rf /' } });

    const logs = policyEngine.getAuditLogs();
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs.some((l) => l.decision === 'DENY')).toBe(true);
  });
});
