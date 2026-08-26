/**
 * Trajectory Dataset Exporter (SFT & DPO) Unit Tests.
 *
 * Verifies distillation of agent execution traces into multi-turn SFT conversation format
 * and extraction of (prompt, chosen, rejected) DPO preference pairs.
 */
import { describe, it, expect } from 'vitest';
import { TrajectoryDatasetExporter, UuidV7IdFactory } from '../../../src/infra/index.js';
import { AgentPhase, MessageRole, ActionResultStatus } from '../../../src/core/index.js';
import type { IterationTraceRecord } from '../../../src/core/model/trace-types.js';

describe('TrajectoryDatasetExporter', () => {
  const idFactory = new UuidV7IdFactory();

  it('exports execution traces as multi-turn SFT JSONL dataset', () => {
    const executionId = idFactory.create<'Execution'>();
    const taskId = idFactory.create<'Task'>();

    const sampleRecords: IterationTraceRecord[] = [
      {
        traceId: 'tr_1',
        executionId,
        taskId,
        iterationId: idFactory.create<'Iteration'>(),
        sequenceNumber: 1,
        phaseBefore: AgentPhase.EXPLORE,
        phaseAfter: AgentPhase.IMPLEMENT,
        selectedProviderId: 'openai',
        selectedModelId: 'gpt-4o',
        targetRole: 'ARCHITECT',
        promptTokens: 2000,
        completionTokens: 200,
        cachedTokens: 1000,
        totalTokens: 2200,
        costDollars: 0.01,
        messages: [{ role: MessageRole.USER, content: 'Add auth middleware.' }],
        proposedToolCalls: [{ name: 'read_file', input: { path: 'src/server.ts' }, id: 'c1' }],
        policyDecisions: [],
        executedToolResults: [
          {
            actionId: idFactory.create<'Action'>(),
            status: ActionResultStatus.SUCCESS,
            output: 'export const app = express();',
            durationMs: 40,
            executedAt: new Date(),
            metadata: { toolCallId: 'c1', toolName: 'read_file' },
          },
        ],
        evidenceCreated: [],
        durationMs: 300,
        timestamp: new Date(),
      },
    ];

    const sftJsonl = TrajectoryDatasetExporter.exportSft(sampleRecords);
    expect(typeof sftJsonl).toBe('string');
    const parsed = JSON.parse(sftJsonl);
    expect(parsed.id).toBe(`sft_${executionId}`);
    expect(parsed.messages.length).toBeGreaterThanOrEqual(3);
    expect(parsed.messages[0].role).toBe('system');
    expect(parsed.messages[1].role).toBe('user');
    expect(parsed.messages[2].role).toBe('assistant');
  });

  it('extracts DPO preference pairs from self-correcting iteration inflection points', () => {
    const executionId = idFactory.create<'Execution'>();
    const taskId = idFactory.create<'Task'>();

    const sampleRecords: IterationTraceRecord[] = [
      // Iteration 1: Proposes faulty command that fails
      {
        traceId: 'tr_1',
        executionId,
        taskId,
        iterationId: idFactory.create<'Iteration'>(),
        sequenceNumber: 1,
        phaseBefore: AgentPhase.IMPLEMENT,
        phaseAfter: AgentPhase.REPAIR,
        selectedProviderId: 'openai',
        selectedModelId: 'gpt-4o',
        targetRole: 'EDITOR',
        promptTokens: 2500,
        completionTokens: 200,
        cachedTokens: 1500,
        totalTokens: 2700,
        costDollars: 0.01,
        messages: [{ role: MessageRole.USER, content: 'Fix bug in auth' }],
        proposedToolCalls: [
          { name: 'run_command', input: { command: 'invalid-test-cmd' }, id: 'c_fail' },
        ],
        policyDecisions: [],
        executedToolResults: [
          {
            actionId: idFactory.create<'Action'>(),
            status: ActionResultStatus.FAILURE,
            output: 'command not found: invalid-test-cmd',
            durationMs: 20,
            executedAt: new Date(),
            metadata: { toolCallId: 'c_fail' },
          },
        ],
        evidenceCreated: [],
        durationMs: 200,
        timestamp: new Date(),
      },
      // Iteration 2: Corrects command and succeeds
      {
        traceId: 'tr_2',
        executionId,
        taskId,
        iterationId: idFactory.create<'Iteration'>(),
        sequenceNumber: 2,
        phaseBefore: AgentPhase.REPAIR,
        phaseAfter: AgentPhase.DONE,
        selectedProviderId: 'openai',
        selectedModelId: 'gpt-4o',
        targetRole: 'EDITOR',
        promptTokens: 2800,
        completionTokens: 200,
        cachedTokens: 2000,
        totalTokens: 3000,
        costDollars: 0.01,
        messages: [{ role: MessageRole.USER, content: 'Fix bug in auth' }],
        proposedToolCalls: [{ name: 'run_command', input: { command: 'npm test' }, id: 'c_ok' }],
        policyDecisions: [],
        executedToolResults: [
          {
            actionId: idFactory.create<'Action'>(),
            status: ActionResultStatus.SUCCESS,
            output: 'PASS: 12 tests passed',
            durationMs: 150,
            executedAt: new Date(),
            metadata: { toolCallId: 'c_ok' },
          },
        ],
        evidenceCreated: [],
        durationMs: 300,
        timestamp: new Date(),
      },
    ];

    const dpoJsonl = TrajectoryDatasetExporter.exportDpo(sampleRecords);
    expect(typeof dpoJsonl).toBe('string');
    const parsed = JSON.parse(dpoJsonl);
    expect(parsed.prompt).toBeDefined();
    expect(parsed.rejected).toContain('invalid-test-cmd');
    expect(parsed.chosen).toContain('npm test');
    expect(parsed.metadata.failedIteration).toBe(1);
    expect(parsed.metadata.correctedIteration).toBe(2);
  });
});
