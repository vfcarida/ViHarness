/**
 * SQLite Experience Store Unit Tests (P013).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../../../src/infra/storage/sqlite-store.js';
import {
  SqliteExperienceStore,
  computeTaskHash,
} from '../../../src/infra/storage/experience-store.js';

describe('SQLite Experience Store — P013', () => {
  let store: SqliteStore;
  let expStore: SqliteExperienceStore;

  beforeEach(async () => {
    store = new SqliteStore(':memory:');
    await store.open();
    expStore = new SqliteExperienceStore({ store });
  });

  afterEach(async () => {
    await store.close();
  });

  it('1. should compute deterministic task hashes from descriptions', () => {
    const h1 = computeTaskHash('Fix memory leak in HTTP worker');
    const h2 = computeTaskHash('fix memory leak in http worker!');
    expect(h1).toBe(h2);
  });

  it('2. should save and retrieve experience record with trace and score', async () => {
    await expStore.saveExperience({
      id: 'exp-01',
      taskDescription: 'Implement binary search',
      outcome: 'success',
      score: 0.95,
      trace: [
        { step: 1, action: 'read_file' },
        { step: 2, action: 'write_file' },
      ],
    });

    const exp = await expStore.getExperience('exp-01');
    expect(exp).toBeDefined();
    expect(exp?.id).toBe('exp-01');
    expect(exp?.outcome).toBe('success');
    expect(exp?.score).toBe(0.95);
    expect(Array.isArray(exp?.trace)).toBe(true);
    expect((exp?.trace as any)[0].action).toBe('read_file');
    expect(exp?.accessCount).toBe(1);
  });

  it('3. should find similar experiences by exact task match and ranking', async () => {
    await expStore.saveExperience({
      id: 'exp-exact',
      taskDescription: 'Refactor database connection pool',
      outcome: 'success',
      score: 1.0,
      trace: { action: 'pool_refactor' },
    });

    await expStore.saveExperience({
      id: 'exp-other',
      taskDescription: 'Build UI button component',
      outcome: 'partial',
      score: 0.5,
      trace: { action: 'ui_button' },
    });

    const matches = await expStore.findSimilar('Refactor database connection pool', 0.8, 5);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]?.id).toBe('exp-exact');
    expect(matches[0]?.accessCount).toBe(1);
  });

  it('4. should list recent experiences ordered by created_at DESC', async () => {
    for (let i = 1; i <= 5; i++) {
      await expStore.saveExperience({
        id: `exp-${i}`,
        taskDescription: `Task ${i}`,
        outcome: 'success',
        score: 0.8,
        trace: {},
        createdAt: 1000 * i,
      });
    }

    const recent = await expStore.listRecent(3);
    expect(recent).toHaveLength(3);
    expect(recent[0]?.id).toBe('exp-5');
    expect(recent[2]?.id).toBe('exp-3');
  });

  it('5. should prune old and excess experiences beyond retention policy', async () => {
    const now = Date.now();
    const oldTimestamp = now - 100 * 24 * 60 * 60 * 1000; // 100 days ago

    await expStore.saveExperience({
      id: 'exp-expired',
      taskDescription: 'Old Task',
      outcome: 'failure',
      score: 0.1,
      trace: {},
      accessedAt: oldTimestamp,
    });

    await expStore.saveExperience({
      id: 'exp-fresh',
      taskDescription: 'Fresh Task',
      outcome: 'success',
      score: 1.0,
      trace: {},
      accessedAt: now,
    });

    const result = await expStore.prune(90, 1000);
    expect(result.prunedCount).toBe(1);

    expect(await expStore.getExperience('exp-expired')).toBeNull();
    expect(await expStore.getExperience('exp-fresh')).toBeDefined();
  });

  it('6. should return null for non-existent experience ID', async () => {
    const res = await expStore.getExperience('non-existent-exp');
    expect(res).toBeNull();
  });

  it('7. should return empty list when no similar experiences found', async () => {
    const res = await expStore.findSimilar('Quantum Teleportation Algorithm', 0.99);
    expect(res).toHaveLength(0);
  });

  it('8. should support storing and retrieving raw string traces', async () => {
    await expStore.saveExperience({
      id: 'exp-raw-string',
      taskDescription: 'Raw text task',
      outcome: 'partial',
      trace: 'STEP 1: Run tests\nSTEP 2: Fix lint\nSTEP 3: Done',
    });

    const exp = await expStore.getExperience('exp-raw-string');
    expect(typeof exp?.trace).toBe('string');
    expect(exp?.trace).toContain('STEP 1: Run tests');
  });

  it('9. should update existing experience on save with matching ID', async () => {
    await expStore.saveExperience({
      id: 'exp-update',
      taskDescription: 'Initial task',
      outcome: 'failure',
      score: 0.2,
      trace: {},
    });

    await expStore.saveExperience({
      id: 'exp-update',
      taskDescription: 'Updated task',
      outcome: 'success',
      score: 0.98,
      trace: { retry: true },
    });

    const exp = await expStore.getExperience('exp-update');
    expect(exp?.outcome).toBe('success');
    expect(exp?.score).toBe(0.98);
  });

  it('10. should assign default scores based on outcome when not explicitly passed', async () => {
    await expStore.saveExperience({
      id: 'exp-s',
      taskDescription: 'T1',
      outcome: 'success',
      trace: {},
    });
    await expStore.saveExperience({
      id: 'exp-p',
      taskDescription: 'T2',
      outcome: 'partial',
      trace: {},
    });
    await expStore.saveExperience({
      id: 'exp-f',
      taskDescription: 'T3',
      outcome: 'failure',
      trace: {},
    });

    const s = await expStore.getExperience('exp-s');
    const p = await expStore.getExperience('exp-p');
    const f = await expStore.getExperience('exp-f');

    expect(s?.score).toBe(1.0);
    expect(p?.score).toBe(0.5);
    expect(f?.score).toBe(0.0);
  });
});
