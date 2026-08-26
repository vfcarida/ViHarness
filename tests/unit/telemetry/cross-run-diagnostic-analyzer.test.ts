/**
 * Cross-Run Diagnostic Analyzer Tests (Meta-Harness Pattern) — P009.
 *
 * Validates:
 * 1. Multi-run non-Markovian trace analysis.
 * 2. Recurring tool failure pattern detection with trace evidence.
 * 3. Oscillation loop and repair exhaustion detection -> Architect Mode recommendation.
 * 4. Context token bloat -> progressive compaction tuning recommendation.
 * 5. Prefix caching underutilization -> caching enablement recommendation.
 */
import { describe, it, expect } from 'vitest';
import { HarnessDiagnosticEngine, type RunTraceData } from '../../../src/infra/index.js';
import { AgentPhase, ActionResultStatus } from '../../../src/core/index.js';

describe('Cross-Run Diagnostic Analyzer (Meta-Harness Pattern) — P009', () => {
  const baseTime = new Date('2026-01-01T00:00:00.000Z');

  it('1. should detect recurring tool failure across multiple runs and produce TOOL_OPTIMIZATION recommendation with evidence', () => {
    // 3 runs where tool "run_linter" repeatedly fails
    const mockRuns: RunTraceData[] = [1, 2, 3].map((runIdx) => ({
      runId: `run-${runIdx}`,
      goalDescription: `Task ${runIdx}`,
      success: false,
      finalPhase: 'FAILED',
      durationMs: 2500,
      harnessConfig: {},
      scores: { totalTokens: 8000, totalCostDollars: 0.05 },
      traces: [
        {
          traceId: `trace-${runIdx}-1`,
          executionId: `run-${runIdx}` as any,
          taskId: `task-${runIdx}` as any,
          iterationId: `iter-1` as any,
          sequenceNumber: 1,
          phaseBefore: AgentPhase.IMPLEMENT,
          phaseAfter: AgentPhase.REPAIR,
          selectedProviderId: 'mock-provider',
          selectedModelId: 'mock-model',
          targetRole: 'GENERALIST',
          promptTokens: 2000,
          completionTokens: 300,
          cachedTokens: 100,
          totalTokens: 2300,
          costDollars: 0.015,
          messages: [],
          proposedToolCalls: [],
          policyDecisions: [],
          executedToolResults: [
            {
              actionId: `act-${runIdx}-1` as any,
              status: ActionResultStatus.FAILURE,
              output: 'ESLint command exited with code 1: Unresolved config file .eslintrc.js',
              error: 'ProcessError: exited with code 1',
              durationMs: 400,
              executedAt: baseTime,
              metadata: { toolName: 'run_linter' },
            },
          ],
          evidenceCreated: [],
          durationMs: 500,
          timestamp: baseTime,
        },
      ],
    }));

    const report = HarnessDiagnosticEngine.analyzeAcrossRuns(mockRuns);

    expect(report.runsAnalyzed).toBe(3);
    expect(report.aggregateSuccessRate).toBe(0);
    expect(report.recurringFailurePatterns.length).toBeGreaterThan(0);
    expect(report.recurringFailurePatterns[0]).toContain('run_linter');

    const toolRec = report.recommendations.find((r) => r.type === 'TOOL_OPTIMIZATION');
    expect(toolRec).toBeDefined();
    expect(toolRec?.parameter).toBe('toolFeedbackEnhancement_run_linter');
    expect(toolRec?.suggestedValue).toBe(true);
    expect(toolRec?.confidence).toBeGreaterThanOrEqual(0.8);
    expect(toolRec?.evidence.length).toBeGreaterThanOrEqual(1);
    expect(toolRec?.evidence[0]).toContain('run_linter');
  });

  it('2. should detect multi-run phase oscillation and recommend Architect Mode', () => {
    const mockRuns: RunTraceData[] = [1, 2].map((runIdx) => ({
      runId: `osc-run-${runIdx}`,
      goalDescription: `Complex Refactoring ${runIdx}`,
      success: false,
      finalPhase: 'FAILED',
      durationMs: 5000,
      harnessConfig: {},
      scores: { totalTokens: 15000, totalCostDollars: 0.12 },
      traces: [
        {
          traceId: `t-${runIdx}-1`,
          executionId: `osc-run-${runIdx}` as any,
          taskId: `task-${runIdx}` as any,
          iterationId: `it-1` as any,
          sequenceNumber: 1,
          phaseBefore: AgentPhase.INIT,
          phaseAfter: AgentPhase.IMPLEMENT,
          selectedProviderId: 'mock-provider',
          selectedModelId: 'mock-model',
          targetRole: 'GENERALIST',
          promptTokens: 1000,
          completionTokens: 200,
          totalTokens: 1200,
          costDollars: 0.01,
          messages: [],
          proposedToolCalls: [],
          policyDecisions: [],
          executedToolResults: [],
          evidenceCreated: [],
          durationMs: 200,
          timestamp: baseTime,
        },
        {
          traceId: `t-${runIdx}-2`,
          executionId: `osc-run-${runIdx}` as any,
          taskId: `task-${runIdx}` as any,
          iterationId: `it-2` as any,
          sequenceNumber: 2,
          phaseBefore: AgentPhase.IMPLEMENT,
          phaseAfter: AgentPhase.REPAIR,
          selectedProviderId: 'mock-provider',
          selectedModelId: 'mock-model',
          targetRole: 'GENERALIST',
          promptTokens: 1500,
          completionTokens: 250,
          totalTokens: 1750,
          costDollars: 0.012,
          messages: [],
          proposedToolCalls: [],
          policyDecisions: [],
          executedToolResults: [],
          evidenceCreated: [],
          durationMs: 250,
          timestamp: baseTime,
        },
        {
          traceId: `t-${runIdx}-3`,
          executionId: `osc-run-${runIdx}` as any,
          taskId: `task-${runIdx}` as any,
          iterationId: `it-3` as any,
          sequenceNumber: 3,
          phaseBefore: AgentPhase.REPAIR,
          phaseAfter: AgentPhase.IMPLEMENT,
          selectedProviderId: 'mock-provider',
          selectedModelId: 'mock-model',
          targetRole: 'GENERALIST',
          promptTokens: 2000,
          completionTokens: 300,
          totalTokens: 2300,
          costDollars: 0.015,
          messages: [],
          proposedToolCalls: [],
          policyDecisions: [],
          executedToolResults: [],
          evidenceCreated: [],
          durationMs: 300,
          timestamp: baseTime,
        },
      ],
    }));

    const report = HarnessDiagnosticEngine.analyzeAcrossRuns(mockRuns);

    const routingRec = report.recommendations.find((r) => r.type === 'ROUTING_CHANGE');
    expect(routingRec).toBeDefined();
    expect(routingRec?.parameter).toBe('architectMode');
    expect(routingRec?.suggestedValue).toBe(true);
    expect(routingRec?.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it('3. should detect context token bloat and recommend progressive compaction threshold tuning', () => {
    const mockRuns: RunTraceData[] = [1, 2, 3].map((runIdx) => ({
      runId: `bloat-run-${runIdx}`,
      goalDescription: `Long horizon run ${runIdx}`,
      success: true,
      finalPhase: 'DONE',
      durationMs: 8000,
      harnessConfig: {},
      scores: { totalTokens: 35000, totalCostDollars: 0.25 },
      traces: [
        {
          traceId: `t-${runIdx}-1`,
          executionId: `bloat-run-${runIdx}` as any,
          taskId: `task-${runIdx}` as any,
          iterationId: `it-1` as any,
          sequenceNumber: 1,
          phaseBefore: AgentPhase.IMPLEMENT,
          phaseAfter: AgentPhase.DONE,
          selectedProviderId: 'mock-provider',
          selectedModelId: 'mock-model',
          targetRole: 'GENERALIST',
          promptTokens: 30000,
          completionTokens: 5000,
          totalTokens: 35000,
          costDollars: 0.25,
          messages: [],
          proposedToolCalls: [],
          policyDecisions: [],
          executedToolResults: [],
          evidenceCreated: [],
          durationMs: 1000,
          timestamp: baseTime,
        },
      ],
    }));

    const report = HarnessDiagnosticEngine.analyzeAcrossRuns(mockRuns);

    const compRec = report.recommendations.find((r) => r.type === 'COMPACTION_TUNING');
    expect(compRec).toBeDefined();
    expect(compRec?.parameter).toBe('aggressiveCompactionThreshold');
    expect(compRec?.suggestedValue).toBe(0.65);
    expect(compRec?.evidence.length).toBeGreaterThan(0);
  });

  it('4. should detect low cache hit ratio across runs and recommend enablePrefixCaching', () => {
    const mockRuns: RunTraceData[] = [1, 2].map((runIdx) => ({
      runId: `cache-run-${runIdx}`,
      goalDescription: `Repeated run ${runIdx}`,
      success: true,
      finalPhase: 'DONE',
      durationMs: 4000,
      harnessConfig: {},
      scores: { totalTokens: 12000, totalCostDollars: 0.08 },
      traces: [
        {
          traceId: `t-${runIdx}-1`,
          executionId: `cache-run-${runIdx}` as any,
          taskId: `task-${runIdx}` as any,
          iterationId: `it-1` as any,
          sequenceNumber: 1,
          phaseBefore: AgentPhase.IMPLEMENT,
          phaseAfter: AgentPhase.DONE,
          selectedProviderId: 'mock-provider',
          selectedModelId: 'mock-model',
          targetRole: 'GENERALIST',
          promptTokens: 10000,
          completionTokens: 2000,
          cachedTokens: 500, // 5% cache hit ratio
          totalTokens: 12000,
          costDollars: 0.08,
          messages: [],
          proposedToolCalls: [],
          policyDecisions: [],
          executedToolResults: [],
          evidenceCreated: [],
          durationMs: 800,
          timestamp: baseTime,
        },
      ],
    }));

    const report = HarnessDiagnosticEngine.analyzeAcrossRuns(mockRuns);

    const cacheRec = report.recommendations.find(
      (r) => r.type === 'THRESHOLD_ADJUSTMENT' && r.parameter === 'enablePrefixCaching',
    );
    expect(cacheRec).toBeDefined();
    expect(cacheRec?.suggestedValue).toBe(true);
  });
});
