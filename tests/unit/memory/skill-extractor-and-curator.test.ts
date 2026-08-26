/**
 * Skill Extractor & Curator Lifecycle Unit Tests (P007).
 *
 * Validates:
 * 1. Background SkillExtractor extracts learned pattern skills from successful completions.
 * 2. Does not extract skills from failed/cancelled runs.
 * 3. Tracks useCount upon retrieval/usage.
 * 4. Hermes Curator lifecycle transitions (active -> stale at 30 iterations, archived at 100 iterations).
 * 5. Frequently used patterns receive importance score boosts.
 */
import { describe, it, expect } from 'vitest';
import {
  InMemoryMemoryStore,
  SkillExtractor,
  SkillCurator,
  UuidV7IdFactory,
  TestClock,
} from '../../../src/infra/index.js';
import {
  MemoryTier,
  MemoryType,
  MemoryStatus,
  AgentPhase,
  type ExecutionResult,
  type IterationRecord,
  TerminationReason,
} from '../../../src/core/index.js';

describe('Skill Extractor & Curator Lifecycle (Hermes Pattern) — P007', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));

  function createMockExecution(success: boolean, iterationCount: number): ExecutionResult {
    const iterations: IterationRecord[] = [];
    for (let i = 1; i <= iterationCount; i++) {
      iterations.push({
        iterationId: idFactory.create<'Iteration'>(),
        sequenceNumber: i,
        startedAt: clock.now(),
        completedAt: clock.now(),
        stateBefore: AgentPhase.IMPLEMENT,
        stateAfter: i === iterationCount ? AgentPhase.DONE : AgentPhase.VERIFY,
        modelId: 'gpt-4o',
        providerId: 'openai',
        actionProposed: null,
        toolResults: [
          {
            toolCallId: idFactory.create<'ToolCall'>(),
            name: 'apply_patch',
            action: {
              id: idFactory.create<'Action'>(),
              toolName: 'apply_patch',
              input: {},
              rationale: 'edit',
              confidence: 0.9,
              timeoutMs: 5000,
              createdAt: clock.now(),
            },
            output: 'success',
            success: true,
            durationMs: 50,
          },
        ],
        evidenceCreated: [],
        tokenUsage: { inputTokens: 500, outputTokens: 100 },
        costDollars: 0.002,
        terminationDecision: {
          terminal: i === iterationCount,
          reason: i === iterationCount ? TerminationReason.SUCCESS : null,
          evidence: [],
          iterationsAnalyzed: i,
          evidenceIds: [],
          confidence: 1.0,
          humanRequired: false,
        },
      });
    }

    return {
      executionId: idFactory.create<'Execution'>(),
      goalId: idFactory.create<'Goal'>(),
      taskId: idFactory.create<'Task'>(),
      success,
      status: success ? 'COMPLETED' : 'FAILED',
      summary: 'Authentication patch applied and verified',
      iterationCount,
      durationMs: 1500,
      totalCostDollars: 0.01,
      totalTokens: 2500,
      iterations,
    };
  }

  it('1. should extract learned pattern from successful completion with problem type and tools used', async () => {
    const memoryStore = new InMemoryMemoryStore({ idFactory, clock });
    const extractor = new SkillExtractor({ memoryStore, idFactory, clock });

    const execution = createMockExecution(true, 3);
    const memory = await extractor.extractFromExecution(
      execution,
      'Fix OAuth token refresh bug in login service',
      'Implement robust authentication',
    );

    expect(memory).not.toBeNull();
    expect(memory?.type).toBe(MemoryType.PATTERN);
    expect(memory?.tier).toBe(MemoryTier.PROCEDURAL);
    expect(memory?.confidence).toBe(0.9);
    expect(memory?.importance).toBe(0.85);
    expect(memory?.content).toContain('AUTHENTICATION');
    expect(memory?.content).toContain('apply_patch');
    expect(memory?.metadata['useCount']).toBe(0);
    expect(memory?.metadata['problemType']).toBe('AUTHENTICATION');
  });

  it('2. should not extract skill when execution failed or cancelled', async () => {
    const memoryStore = new InMemoryMemoryStore({ idFactory, clock });
    const extractor = new SkillExtractor({ memoryStore, idFactory, clock });

    const failedExecution = createMockExecution(false, 5);
    const memory = await extractor.extractFromExecution(failedExecution, 'Failing task', 'Goal');

    expect(memory).toBeNull();
  });

  it('3. should track and increment useCount when pattern skill is used', async () => {
    const memoryStore = new InMemoryMemoryStore({ idFactory, clock });
    const extractor = new SkillExtractor({ memoryStore, idFactory, clock });

    const execution = createMockExecution(true, 2);
    const created = await extractor.extractFromExecution(
      execution,
      'Refactor database schema for migrations',
      'Database stability',
    );

    expect(created).not.toBeNull();
    const memoryId = created!.id;

    // Use once
    const used1 = await extractor.recordUsage(memoryId);
    expect(used1?.metadata['useCount']).toBe(1);

    // Use second time
    const used2 = await extractor.recordUsage(memoryId);
    expect(used2?.metadata['useCount']).toBe(2);
    expect(used2?.importance).toBeGreaterThanOrEqual(created!.importance);
  });

  it('4. should transition unused patterns to STALE (30 iterations) and ARCHIVED (100 iterations)', async () => {
    const memoryStore = new InMemoryMemoryStore({ idFactory, clock });
    const curator = new SkillCurator({
      memoryStore,
      clock,
      staleThresholdIterations: 30,
      archiveThresholdIterations: 100,
    });

    // Create a pattern memory
    const pattern = await memoryStore.createRecord({
      type: MemoryType.PATTERN,
      content: 'Pattern: optimize cache layer',
      source: 'extractor',
      confidence: 0.9,
      importance: 0.75,
      status: MemoryStatus.ACTIVE,
      tags: ['pattern'],
      metadata: { iterationsSinceLastUse: 0, useCount: 0 },
    });

    // Advance 10 iterations -> Still ACTIVE
    await curator.advanceIterationCounter(10);
    let report = await curator.curate();
    expect(report.markedStale).toBe(0);
    expect(report.markedArchived).toBe(0);
    expect((await memoryStore.getRecord(pattern.id))?.status).toBe(MemoryStatus.ACTIVE);

    // Advance 25 more iterations (total 35) -> Marks STALE
    await curator.advanceIterationCounter(25);
    report = await curator.curate();
    expect(report.markedStale).toBe(1);
    expect((await memoryStore.getRecord(pattern.id))?.status).toBe(MemoryStatus.STALE);

    // Advance 70 more iterations (total 105) -> Marks ARCHIVED
    await curator.advanceIterationCounter(70);
    report = await curator.curate();
    expect(report.markedArchived).toBe(1);
    expect((await memoryStore.getRecord(pattern.id))?.status).toBe(MemoryStatus.ARCHIVED);
  });

  it('5. should boost importance score for frequently used patterns (>= 3 uses)', async () => {
    const memoryStore = new InMemoryMemoryStore({ idFactory, clock });
    const curator = new SkillCurator({ memoryStore, clock });

    const pattern = await memoryStore.createRecord({
      type: MemoryType.PATTERN,
      content: 'Pattern: use parallel test runner for faster feedback',
      source: 'extractor',
      confidence: 0.9,
      importance: 0.7,
      status: MemoryStatus.ACTIVE,
      tags: ['pattern'],
      metadata: { iterationsSinceLastUse: 2, useCount: 4 }, // 4 uses
    });

    const report = await curator.curate();
    expect(report.boostedImportance).toBe(1);

    const updated = await memoryStore.getRecord(pattern.id);
    expect(updated?.importance).toBeGreaterThan(0.7);
    expect(updated?.importance).toBeCloseTo(0.9, 2); // 0.70 + 4 * 0.05 = 0.90
  });
});
