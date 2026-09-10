import { describe, it, expect, vi } from 'vitest';
import {
  MockModelProvider,
  UtilityModelRouter,
  DefaultContextCompiler,
  UuidV7IdFactory,
  TestClock,
  DefaultToolRegistry,
  DefaultToolExecutor,
} from '../../../src/infra/index.js';
import { DefaultAgentRuntime } from '../../../src/runtime/default-agent-runtime.js';
import { AgentEventType, GoalStatus, ToolCategory, ToolRiskLevel } from '../../../src/core/index.js';
import type { Goal, AgentEvent, Tool } from '../../../src/core/index.js';

describe('Automatic Rollback on Loop Anomaly', () => {
  it('triggers revert_file when stagnation anomaly is detected with autoRollback enabled', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new TestClock(new Date('2024-01-01T00:00:00Z'));
    const compiler = new DefaultContextCompiler({ idFactory, clock });

    // Mock provider always producing the same tool call with identical parameters
    const mockProvider = new MockModelProvider({
      providerId: 'primary-mock',
      defaultResponseText: 'I will modify main.c',
      defaultToolCalls: [
        {
          id: 'tc-1',
          name: 'edit_file',
          parameters: { path: 'src/main.c', old_string: 'foo', new_string: 'bar' },
        },
      ],
    });

    const router = new UtilityModelRouter();
    router.registerProvider(mockProvider);

    const registry = new DefaultToolRegistry();

    // Register edit_file dummy tool
    const editTool: Tool = {
      definition: {
        name: 'edit_file',
        version: '1.0.0',
        description: 'Edit file',
        category: ToolCategory.EXECUTE,
        riskLevel: ToolRiskLevel.LOW,
        mutating: true,
        idempotent: false,
        defaultTimeoutMs: 5000,
        requiredPermissions: [],
        inputSchema: { type: 'object', properties: {} },
      },
      execute: vi.fn().mockResolvedValue({
        toolCallId: 'tc-1',
        name: 'edit_file',
        success: true,
        output: 'Replaced 1 occurrence',
        durationMs: 5,
        metadata: { path: 'src/main.c' },
      }),
    };
    registry.register(editTool);

    // Register revert_file mock tool
    const revertToolExecute = vi.fn().mockResolvedValue({
      toolCallId: 'revert-tc',
      name: 'revert_file',
      success: true,
      output: 'Reverted workspace changes with git restore .',
      durationMs: 10,
    });

    const revertTool: Tool = {
      definition: {
        name: 'revert_file',
        version: '1.0.0',
        description: 'Revert file',
        category: ToolCategory.EXECUTE,
        riskLevel: ToolRiskLevel.HIGH,
        mutating: true,
        idempotent: false,
        defaultTimeoutMs: 5000,
        requiredPermissions: [],
        inputSchema: { type: 'object', properties: {} },
      },
      execute: revertToolExecute,
    };
    registry.register(revertTool);

    const toolExecutor = new DefaultToolExecutor({ registry, idFactory });

    // Mock failing verification engine to keep agent in repair cycle
    const verificationEngine = {
      verify: vi.fn().mockResolvedValue({
        status: 'FAILED',
        summary: 'Unit test failed: assertion error in test_login',
        confidence: 0.9,
        evidenceIds: [],
        taskId: idFactory.create<'Task'>(),
        verifiedAt: clock.now(),
        suiteId: 'test-suite',
        durationMs: 10,
        scope: 'repository' as const,
        affectedFiles: ['src/main.c'],
        checkExecutions: [],
      }),
    };

    const runtime = new DefaultAgentRuntime({
      router,
      compiler,
      toolExecutor,
      verificationEngine: verificationEngine as any,
      idFactory,
      clock,
    });

    const events: AgentEvent[] = [];
    runtime.subscribe({
      onEvent: (e) => events.push(e),
    });

    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Fix stuck issue',
      constraints: {
        maxIterations: 8,
        maxCostDollars: 1.0,
        maxDurationMs: 60000,
        maxRepairAttempts: 5,
        maxNoProgressIterations: 5,
        requireVerification: true,
      },
      status: GoalStatus.ACTIVE,
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    await runtime.execute(goal, {
      autoRollback: true,
      toolExecutor,
    });

    // Verify revert_file was invoked because 3 identical turns occurred
    expect(revertToolExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '.',
      }),
      expect.anything(),
    );

    // Verify rollback evidence was emitted
    const rollbackEvent = events.find(
      (e) =>
        e.type === AgentEventType.EvidenceCreated &&
        (e.data as any).evidence?.summary?.includes('[AUTOMATIC ROLLBACK TRIGGERED]'),
    );
    expect(rollbackEvent).toBeDefined();
  });
});
