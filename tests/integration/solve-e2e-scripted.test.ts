/**
 * Scripted Provider End-to-End Integration Test — Track 11
 *
 * Realistically verifies the complete solve workflow without network or live API keys:
 * - Deterministic multi-turn trajectory: read -> write -> verify -> done
 * - Tool execution order and argument fidelity
 * - State machine phase transitions and loop iteration progress
 * - Output git diff patch generation (--output-patch)
 * - Structured event telemetry and observer dispatch
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runSolveCli } from '../../src/cli/commands/solve.js';
import { createRuntime } from '../../src/index.js';
import { DefaultToolRegistry } from '../../src/infra/tools/default-tool-registry.js';
import { DefaultToolExecutor } from '../../src/infra/tools/default-tool-executor.js';
import { ReadFileTool } from '../../src/infra/tools/builtin/read-file-tool.js';
import { WriteFileTool } from '../../src/infra/tools/builtin/write-file-tool.js';
import { DefaultPolicyEngine } from '../../src/infra/security/default-policy-engine.js';
import { DefaultVerificationEngine } from '../../src/infra/verification/default-verification-engine.js';
import { DefaultEvidenceStore } from '../../src/infra/evidence/default-evidence-store.js';
import { ScriptedModelProvider } from '../../src/infra/model/scripted-model-provider.js';
import { UtilityModelRouter } from '../../src/infra/router/utility-model-router.js';
import { UuidV7IdFactory } from '../../src/infra/id/uuid-id-factory.js';
import { SystemClock } from '../../src/infra/time/system-clock.js';
import { GoalStatus, type Goal } from '../../src/core/model/goal.js';
import { AgentEventType, type AgentEvent } from '../../src/core/model/runtime-types.js';

describe('Scripted Provider E2E Solve Integration — Track 11', { timeout: 15000 }, () => {
  it('1. CLI solve command executes multi-turn scripted agent, generates patch, and exits 0', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-e2e-cli-scripted-'));
    const patchPath = path.join(workspaceRoot, 'output', 'solution.patch');

    // Create a initial target file
    fs.writeFileSync(path.join(workspaceRoot, 'target.ts'), '// initial content\n');

    try {
      const exitCode = await runSolveCli([
        '--prompt',
        'Refactor target.ts and create solution.ts',
        '--cwd',
        workspaceRoot,
        '--provider-id',
        'scripted',
        '--output-patch',
        patchPath,
        '--max-iterations',
        '5',
      ]);

      expect(exitCode).toBe(0);

      // Verify that solution.ts was created by the scripted provider
      const solutionFile = path.join(workspaceRoot, 'solution.ts');
      expect(fs.existsSync(solutionFile)).toBe(true);
      const content = fs.readFileSync(solutionFile, 'utf-8');
      expect(content).toContain('export const status = "fixed";');

      // Verify output patch file was generated
      expect(fs.existsSync(patchPath)).toBe(true);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('2. Multi-turn runtime trajectory asserts phase transitions, tool order, and telemetry', async () => {
    const clock = new SystemClock();
    const idFactory = new UuidV7IdFactory();
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-e2e-runtime-trajectory-'));

    const initialFile = path.join(workspaceRoot, 'calculator.ts');
    fs.writeFileSync(initialFile, 'export function multiply(a: number, b: number): number { return 0; }\n');

    // 1. Tools
    const toolRegistry = new DefaultToolRegistry();
    toolRegistry.register(new ReadFileTool(idFactory));
    toolRegistry.register(new WriteFileTool(idFactory));

    const policyEngine = new DefaultPolicyEngine();
    const toolExecutor = new DefaultToolExecutor({
      registry: toolRegistry,
      policyEngine,
      idFactory,
      clock,
    });

    // 2. Multi-turn scripted provider: read -> write -> verify -> done
    const router = new UtilityModelRouter();
    const scriptedProvider = new ScriptedModelProvider({
      providerId: 'scripted-trajectory',
      descriptor: { id: 'scripted-model' },
      steps: [
        // Turn 1: Inspect calculator.ts
        {
          content: 'I need to inspect calculator.ts first.',
          toolCalls: [
            {
              id: idFactory.create<'ToolCall'>(),
              name: 'read_file',
              input: { path: initialFile },
            },
          ],
        },
        // Turn 2: Write fixed implementation
        {
          content: 'Writing correct implementation to calculator.ts.',
          toolCalls: [
            {
              id: idFactory.create<'ToolCall'>(),
              name: 'write_file',
              input: {
                path: initialFile,
                content: 'export function multiply(a: number, b: number): number { return a * b; }\n',
              },
            },
          ],
        },
        // Turn 3: Verify content
        {
          content: 'Verifying updated content.',
          toolCalls: [
            {
              id: idFactory.create<'ToolCall'>(),
              name: 'read_file',
              input: { path: initialFile },
            },
          ],
        },
        // Turn 4: Conclude goal
        {
          content: 'Multiplication function is correctly implemented and verified. Task complete.',
          toolCalls: [],
        },
      ],
    });
    router.registerProvider(scriptedProvider);

    // 3. Evidence & Verification
    const evidenceStore = new DefaultEvidenceStore();
    const verificationEngine = new DefaultVerificationEngine({ evidenceStore, idFactory, clock });

    // 4. Runtime & Event Telemetry Capture
    const runtime = createRuntime({
      router,
      policyEngine,
      toolExecutor,
      verificationEngine,
      evidenceStore,
      idFactory,
      clock,
    });

    const recordedEvents: AgentEvent[] = [];
    runtime.subscribe({
      onEvent: (ev) => {
        recordedEvents.push(ev);
      },
    });

    // 5. Goal Execution
    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Fix the multiply implementation in calculator.ts and verify result.',
      status: GoalStatus.ACTIVE,
      tasks: [],
      constraints: { maxIterations: 10, maxCostDollars: 0.5, maxDurationMs: 30000 },
      metadata: { workspaceRoot },
      createdAt: clock.now(),
      updatedAt: clock.now(),
    };

    try {
      const result = await runtime.execute(goal);

      // Status check
      expect(result.status).toBe(GoalStatus.COMPLETED);
      expect(result.iterations.length).toBe(4);

      // Check tool execution sequence across recorded telemetry events
      const toolCompletedEvents = recordedEvents.filter((e) => e.type === AgentEventType.ToolCompleted);
      expect(toolCompletedEvents.length).toBe(3);
      const toolNames = toolCompletedEvents.map((e) => {
        const act = (e.data as any).result;
        return act?.toolName ?? act?.metadata?.['toolName'] ?? (e.data as any).action?.toolName;
      });
      expect(toolNames).toEqual(['read_file', 'write_file', 'read_file']);

      // Check file content was modified
      const updatedContent = fs.readFileSync(initialFile, 'utf-8');
      expect(updatedContent).toBe('export function multiply(a: number, b: number): number { return a * b; }\n');

      // Check telemetry events
      const eventTypes = recordedEvents.map((e) => e.type);
      expect(eventTypes).toContain(AgentEventType.AgentStarted);
      expect(eventTypes).toContain(AgentEventType.IterationStarted);
      expect(eventTypes).toContain(AgentEventType.ToolCompleted);
      expect(eventTypes).toContain(AgentEventType.AgentCompleted);

      // Verify prompt history tracked by scripted provider
      expect(scriptedProvider.requestHistory.length).toBe(4);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
