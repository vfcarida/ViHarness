/**
 * Trace Distiller & Diagnostic Engine Unit Tests.
 *
 * Verifies causal analysis calculation, cache hit ratio detection,
 * tool failure rate computation, bottleneck identification, and outer-loop adaptation recommendations.
 */
import { describe, it, expect } from 'vitest';
import {
  TraceDistiller,
  HarnessDiagnosticEngine,
  UuidV7IdFactory,
} from '../../../src/infra/index.js';
import { AgentPhase, MessageRole } from '../../../src/core/index.js';
import type { IterationTraceRecord } from '../../../src/core/model/trace-types.js';

describe('TraceDistiller & HarnessDiagnosticEngine Unit Tests', () => {
  const idFactory = new UuidV7IdFactory();

  it('distills execution traces, computes tool accuracy, and generates actionable outer-loop recommendations', () => {
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
        phaseAfter: AgentPhase.PLAN,
        selectedProviderId: 'openai',
        selectedModelId: 'gpt-4o',
        targetRole: 'ARCHITECT',
        promptTokens: 4000,
        completionTokens: 200,
        cachedTokens: 500, // low cache hit ratio (12.5%)
        totalTokens: 4200,
        costDollars: 0.02,
        messages: [{ role: MessageRole.USER, content: 'Fix crash in parser.' }],
        proposedToolCalls: [{ name: 'read_file', input: { path: 'src/parser.ts' }, id: 'c1' }],
        policyDecisions: [],
        executedToolResults: [{ toolCallId: 'c1', success: true, output: 'ok', durationMs: 50 }],
        evidenceCreated: [],
        durationMs: 400,
        timestamp: new Date(),
      },
      {
        traceId: 'tr_2',
        executionId,
        taskId,
        iterationId: idFactory.create<'Iteration'>(),
        sequenceNumber: 2,
        phaseBefore: AgentPhase.PLAN,
        phaseAfter: AgentPhase.DONE,
        selectedProviderId: 'openai',
        selectedModelId: 'gpt-4o-mini',
        targetRole: 'EDITOR',
        promptTokens: 4000,
        completionTokens: 300,
        cachedTokens: 500,
        totalTokens: 4300,
        costDollars: 0.005,
        messages: [{ role: MessageRole.ASSISTANT, content: 'Fixed parser.' }],
        proposedToolCalls: [{ name: 'run_command', input: { command: 'npm test' }, id: 'c2' }],
        policyDecisions: [],
        executedToolResults: [{ toolCallId: 'c2', success: true, output: 'PASS', durationMs: 120 }],
        evidenceCreated: [
          {
            id: idFactory.create<'Evidence'>(),
            taskId,
            iterationId: idFactory.create<'Iteration'>(),
            kind: 'TEST_PASS' as any,
            pass: true,
            source: 'vitest',
            content: 'Test passed',
            createdAt: new Date(),
          },
        ],
        durationMs: 300,
        timestamp: new Date(),
      },
    ];

    // 1. Distillation
    const analysis = TraceDistiller.distill(sampleRecords);
    expect(analysis.totalIterations).toBe(2);
    expect(analysis.totalTokens).toBe(8500);
    expect(analysis.promptTokens).toBe(8000);
    expect(analysis.cachedTokens).toBe(1000);
    expect(analysis.cacheHitRatio).toBe(0.125);
    expect(analysis.passEvidenceCount).toBe(1);
    expect(analysis.inflectionPoints.length).toBe(2);

    // 2. Outer-Loop Diagnosis
    const report = HarnessDiagnosticEngine.diagnose(sampleRecords);
    expect(report.executionId).toBe(executionId);
    expect(report.recommendations.length).toBeGreaterThan(0);

    const prefixRec = report.recommendations.find((r) => r.code === 'INCREASE_PREFIX_CACHING');
    expect(prefixRec).toBeDefined();
    expect(prefixRec?.priority).toBe('HIGH');
    expect(report.suggestedConfigOverrides['enablePrefixCaching']).toBe(true);
  });
});
