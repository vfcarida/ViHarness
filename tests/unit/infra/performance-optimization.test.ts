import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import {
  PerformanceProfiler,
  TelemetryCategory,
  AdaptiveContextBudget,
  EvidenceCache,
  ParallelToolExecutor,
  DefaultToolExecutor,
  DefaultToolRegistry,
  ReadFileTool,
  WriteFileTool,
  ListDirectoryTool,
  BASELINE_SCENARIOS,
  BaselineScenarioCategory,
  EvidenceOutcome,
  EvidenceType,
  UuidV7IdFactory,
  TestClock,
  DefaultPolicyEngine,
  LocalDevelopmentSandbox,
} from '../../../src/index.js';
import type { PerformanceBaseline, Evidence } from '../../../src/index.js';

describe('Performance & Cost Optimization Suite', () => {
  let idFactory: UuidV7IdFactory;
  let clock: TestClock;
  let profiler: PerformanceProfiler;

  beforeEach(() => {
    idFactory = new UuidV7IdFactory();
    clock = new TestClock(new Date('2026-08-13T00:00:00Z'));
    profiler = new PerformanceProfiler();
  });

  it('1. Performance Profiler: Measures telemetry across 10 categories & computes before/after metrics', () => {
    profiler.record(TelemetryCategory.MODEL_CALLS, 3, 'count');
    profiler.record(TelemetryCategory.TOKEN_USAGE, 4500, 'tokens');
    profiler.record(TelemetryCategory.CONTEXT_COMPILATION, 120, 'ms');
    profiler.record(TelemetryCategory.TOOL_CALLS, 6, 'count');
    profiler.record(TelemetryCategory.REPEATED_RETRIEVAL, 1, 'count');
    profiler.record(TelemetryCategory.REDUNDANT_VERIFICATION, 0, 'count');
    profiler.record(TelemetryCategory.SUBAGENT_USAGE, 1, 'count');
    profiler.record(TelemetryCategory.SERIALIZATION_OVERHEAD, 15, 'ms');
    profiler.record(TelemetryCategory.PERSISTENCE_OVERHEAD, 25, 'ms');
    profiler.record(TelemetryCategory.MODEL_ROUTING, 10, 'ms');

    expect(profiler.calculateSum(TelemetryCategory.TOKEN_USAGE)).toBe(4500);

    const before: PerformanceBaseline = {
      totalTokens: 10000,
      totalCostUSD: 0.1,
      totalLatencyMs: 3000,
      successRate: 1.0,
      regressionRate: 0.0,
    };

    const after: PerformanceBaseline = {
      totalTokens: 4500,
      totalCostUSD: 0.045,
      totalLatencyMs: 1500,
      successRate: 1.0,
      regressionRate: 0.0,
    };

    const comparison = PerformanceProfiler.compare(before, after);

    expect(comparison.costReductionPercent).toBeCloseTo(55, 1);
    expect(comparison.latencyReductionPercent).toBeCloseTo(50, 1);
    expect(comparison.tokenReductionPercent).toBeCloseTo(55, 1);
    expect(comparison.satisfiesReliabilityPolicy).toBe(true);
  });

  it('2. Reliability Invariant Enforcement: Rejects optimizations that lower reliability below threshold', () => {
    const before: PerformanceBaseline = {
      totalTokens: 10000,
      totalCostUSD: 0.1,
      totalLatencyMs: 3000,
      successRate: 1.0,
      regressionRate: 0.0,
    };

    // Simulated unsafe optimization that dropped success rate to 90%
    const unsafeAfter: PerformanceBaseline = {
      totalTokens: 2000,
      totalCostUSD: 0.02,
      totalLatencyMs: 800,
      successRate: 0.9,
      regressionRate: 0.05,
    };

    const comparison = PerformanceProfiler.compare(before, unsafeAfter);
    expect(comparison.satisfiesReliabilityPolicy).toBe(false);
  });

  it('3. Adaptive Context Budget: Dynamic token allocation for SMALL_BUG vs MULTI_FILE_REFACTOR', () => {
    const smallBugBudget = AdaptiveContextBudget.computeBudget(
      BaselineScenarioCategory.SMALL_BUG,
      1,
    );
    expect(smallBugBudget.maxTokens).toBe(4000);

    const refactorBudget = AdaptiveContextBudget.computeBudget(
      BaselineScenarioCategory.MULTI_FILE_REFACTOR,
      1,
    );
    expect(refactorBudget.maxTokens).toBe(16000);
  });

  it('4. Evidence Cache: Reuses evidence for unchanged source files and invalidates on modification', () => {
    const cache = new EvidenceCache();
    const taskId = idFactory.create<'Task'>();

    const dummyEvidence: Evidence = {
      id: idFactory.create<'Evidence'>(),
      taskId,
      type: EvidenceType.TEST_RESULT,
      outcome: EvidenceOutcome.PASS,
      summary: 'Unit tests passed',
      data: {},
      createdAt: clock.now(),
      pass: true,
      checkId: 'check-pricing-engine',
    };

    const originalHashes = { 'src/pricing.ts': 'hash-v1-abc' };
    cache.put('check-pricing-engine', dummyEvidence, originalHashes);

    // Hit with identical file hash
    const hit = cache.get('check-pricing-engine', { 'src/pricing.ts': 'hash-v1-abc' });
    expect(hit).toBeDefined();
    expect(hit?.outcome).toBe(EvidenceOutcome.PASS);

    // Miss on file modification
    const miss = cache.get('check-pricing-engine', { 'src/pricing.ts': 'hash-v2-modified' });
    expect(miss).toBeNull();
  });

  it('5. Parallel Safe Tool Executor: Executes non-mutating read tools concurrently', async () => {
    const registry = new DefaultToolRegistry();
    registry.register(new ReadFileTool(idFactory));
    registry.register(new ListDirectoryTool(idFactory));
    registry.register(new WriteFileTool(idFactory));

    const policyEngine = new DefaultPolicyEngine({ idFactory, clock });
    const sandbox = new LocalDevelopmentSandbox({ idFactory });
    const defaultExecutor = new DefaultToolExecutor({
      registry,
      policyEngine,
      sandbox,
      idFactory,
      clock,
    });

    const parallelExecutor = new ParallelToolExecutor(defaultExecutor, registry);

    const srcIndexPath = path.resolve(process.cwd(), 'src/index.ts');
    const srcPath = path.resolve(process.cwd(), 'src');

    const batch = [
      { toolName: 'read_file', input: { path: srcIndexPath } },
      { toolName: 'list_directory', input: { path: srcPath } },
    ];

    const taskId = idFactory.create<'Task'>();
    const results = await parallelExecutor.executeBatch(batch, { taskId });
    if (!results[0]?.success) {
      console.log('Result 0 Error:', results[0]?.error);
    }
    expect(results).toHaveLength(2);
    expect(results[0]?.success).toBe(true);
    expect(results[1]?.success).toBe(true);
  });
});
