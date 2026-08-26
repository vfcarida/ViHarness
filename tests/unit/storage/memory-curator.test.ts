/**
 * SQLite Memory Curator Unit Tests (P013).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../../../src/infra/storage/sqlite-store.js';
import { SqliteMemoryCurator } from '../../../src/infra/storage/memory-curator.js';

describe('SQLite Memory Curator (Hermes Lifecycle) — P013', () => {
  let store: SqliteStore;
  let curator: SqliteMemoryCurator;

  beforeEach(async () => {
    store = new SqliteStore(':memory:');
    await store.open();
    curator = new SqliteMemoryCurator({ store });
  });

  afterEach(async () => {
    await store.close();
  });

  it('1. should store and retrieve scoped memory (global, project, session)', async () => {
    await curator.set('global', 'user_preference', 'prefer_typescript');
    await curator.set('project', 'build_tool', 'vite');
    await curator.set('session', 'temp_fix', 'apply_patch_1');

    expect(await curator.get('global', 'user_preference')).toBe('prefer_typescript');
    expect(await curator.get('project', 'build_tool')).toBe('vite');
    expect(await curator.get('session', 'temp_fix')).toBe('apply_patch_1');
  });

  it('2. should isolate memory across different scopes with same key', async () => {
    await curator.set('global', 'key_x', 'val_global');
    await curator.set('project', 'key_x', 'val_project');

    expect(await curator.get('global', 'key_x')).toBe('val_global');
    expect(await curator.get('project', 'key_x')).toBe('val_project');
  });

  it('3. should delete memory entries cleanly', async () => {
    await curator.set('project', 'temp', '123');
    expect(await curator.get('project', 'temp')).toBe('123');

    await curator.delete('project', 'temp');
    expect(await curator.get('project', 'temp')).toBeNull();
  });

  it('4. should list memory entries by scope and status', async () => {
    await curator.set('project', 'k1', 'v1');
    await curator.set('project', 'k2', 'v2');
    await curator.set('global', 'k3', 'v3');

    const projectEntries = await curator.list('project');
    expect(projectEntries).toHaveLength(2);

    const allActive = await curator.list(undefined, 'active');
    expect(allActive).toHaveLength(3);
  });

  it('5. should run Hermes lifecycle transitions: active -> stale (30d) -> archived (90d)', async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const baseTime = new Date('2026-01-01T00:00:00Z').getTime();

    // 1. Create entries at baseTime
    await curator.set('project', 'recent_entry', 'value1');
    await curator.set('project', 'stale_candidate', 'value2');
    await curator.set('project', 'archive_candidate', 'value3');

    // Manually set access timestamps for lifecycle test
    store.db
      .prepare("UPDATE memory SET accessed_at = ? WHERE key = 'recent_entry'")
      .run(baseTime + 30 * dayMs);
    store.db
      .prepare("UPDATE memory SET accessed_at = ? WHERE key = 'stale_candidate'")
      .run(baseTime - 5 * dayMs);
    store.db
      .prepare("UPDATE memory SET accessed_at = ? WHERE key = 'archive_candidate'")
      .run(baseTime - 65 * dayMs);

    // Pass 1: Run sweep at baseTime + 30 days
    // active candidates inactive for >=30d transition to stale
    const sweep1Time = baseTime + 30 * dayMs;
    const sweep1 = await curator.sweep(30, 90, sweep1Time);

    expect(sweep1.transitionedToStale).toBe(2); // stale_candidate & archive_candidate

    const staleEntries = await curator.list('project', 'stale');
    expect(staleEntries.map((e) => e.key).sort()).toEqual(['archive_candidate', 'stale_candidate']);

    // Pass 2: Run sweep again - archive_candidate (inactive >90d) transitions from stale to archived
    const sweep2 = await curator.sweep(30, 90, sweep1Time);
    expect(sweep2.transitionedToArchived).toBe(1); // archive_candidate

    const archivedEntries = await curator.list('project', 'archived');
    expect(archivedEntries.map((e) => e.key)).toEqual(['archive_candidate']);
  });

  it('6. should reactivate stale memory back to active upon access', async () => {
    await curator.set('project', 'reactivate_me', 'important_data');
    store.db.prepare("UPDATE memory SET status = 'stale' WHERE key = 'reactivate_me'").run();

    const staleList = await curator.list('project', 'stale');
    expect(staleList).toHaveLength(1);

    const val = await curator.get('project', 'reactivate_me');
    expect(val).toBe('important_data');

    const activeList = await curator.list('project', 'active');
    expect(activeList.map((e) => e.key)).toContain('reactivate_me');
  });

  it('7. should consolidate memory entries when count exceeds threshold', async () => {
    for (let i = 1; i <= 5; i++) {
      await curator.set('project', `pref_${i}`, `rule_${i}`);
    }

    const res = await curator.consolidate('project', 3);
    expect(res.consolidatedCount).toBe(5);

    const activeEntries = await curator.list('project', 'active');
    expect(activeEntries).toHaveLength(1);
    expect(activeEntries[0]?.key).toContain('consolidated_');
    expect(activeEntries[0]?.value).toContain('[pref_1]: rule_1');
  });
});
