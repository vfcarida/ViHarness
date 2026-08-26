import { describe, it, expect } from 'vitest';
import { InMemoryMemoryStore } from '../../../src/infra/memory/in-memory-memory-store.js';
import { MemoryLifecycle } from '../../../src/infra/memory/memory-lifecycle.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';
import { SystemClock } from '../../../src/infra/time/system-clock.js';
import {
  MemoryTier,
  MemoryType,
  MemoryScope,
  MemoryStatus,
} from '../../../src/core/model/memory-types.js';
import type { MemoryProvenance } from '../../../src/core/model/memory-types.js';

describe('Hardened Memory Subsystem Unit Test Suite', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new SystemClock();

  function createStore() {
    return new InMemoryMemoryStore({ idFactory, clock });
  }

  it('1. Memory Creation & Promotion: Raw tool data starts as CANDIDATE; promoted when rules satisfied', async () => {
    const store = createStore();

    // Raw tool observation without promotion tags -> CANDIDATE
    const candidateRec = await store.createRecord({
      type: MemoryType.EXPERIENCE,
      content: 'Read file src/auth/service.ts successfully',
      source: 'tool:read_file',
      importance: 0.3,
    });

    expect(candidateRec.status).toBe(MemoryStatus.CANDIDATE);

    // Explicit user decision -> ACTIVE (Promoted)
    const userRec = await store.createRecord({
      type: MemoryType.DECISION,
      content: 'User decision: Use OAuth2 with JWT bearer tokens',
      source: 'user',
      importance: 0.9,
      tags: ['user_decision'],
    });

    expect(userRec.status).toBe(MemoryStatus.ACTIVE);

    // Promote candidate after repeated successful usage
    await store.recordUsage(candidateRec.id, true);
    const updatedCandidate = await store.getRecord(candidateRec.id);
    expect([MemoryStatus.ACTIVE, MemoryStatus.PROMOTED]).toContain(updatedCandidate?.status);
  });

  it('2. Stale Memory Transition: Marks memory STALE on architecture changes', async () => {
    const store = createStore();

    const activeRec = await store.createRecord({
      type: MemoryType.PATTERN,
      content: 'Legacy Auth Architecture: Uses session cookies on port 8080',
      source: 'architect',
      importance: 0.85,
      scope: MemoryScope.REPOSITORY,
      tags: ['architecture'],
    });

    expect(activeRec.status).toBe(MemoryStatus.ACTIVE);

    // System architecture updated -> mark legacy memory STALE
    const staleRec = await store.markStale(activeRec.id, 'Migrated to OAuth2 on port 443');
    expect(staleRec.status).toBe(MemoryStatus.STALE);
    expect(staleRec.metadata['staleReason']).toContain('Migrated to OAuth2');

    // Querying activeOnly excludes STALE memory
    const activeQuery = await store.retrieve({ activeOnly: true });
    const activeIds = activeQuery.map((s) => s.record.id);
    expect(activeIds).not.toContain(activeRec.id);
  });

  it('3. Invalidation Transition: Marks memory INVALIDATED on proven error or rollback', async () => {
    const store = createStore();

    const activeRec = await store.createRecord({
      type: MemoryType.FACT,
      content: 'Database connection string contains hardcoded password',
      source: 'verifier',
      importance: 0.9,
      tags: ['security'],
    });

    const invalidatedRec = await store.invalidate(
      activeRec.id,
      'Secret rotated and removed from codebase',
    );
    expect(invalidatedRec.status).toBe(MemoryStatus.INVALIDATED);

    const activeQuery = await store.retrieve({ activeOnly: true });
    expect(activeQuery.map((s) => s.record.id)).not.toContain(activeRec.id);
  });

  it('4. Contradiction & Conflict Resolution: Flags contradiction and resolves explicitly without silent overwrite', async () => {
    const store = createStore();

    // Memory entry 1
    const rec1 = await store.createRecord({
      type: MemoryType.FACT,
      topic: 'http_port',
      content: 'Auth Service HTTP port MUST be 8080',
      source: 'legacy_doc',
      importance: 0.8,
      tags: ['architecture'],
    });

    // Memory entry 2 (contradictory claim on same topic)
    const rec2 = await store.createRecord({
      type: MemoryType.FACT,
      topic: 'http_port',
      content: 'Auth Service HTTP port MUST be 443',
      source: 'security_audit',
      importance: 0.95,
      tags: ['architecture', 'must_preserve'],
    });

    const conflicts = await store.getConflicts();
    expect(conflicts).toHaveLength(1);

    const conflict = conflicts[0]!;
    expect(conflict.topic).toBe('http_port');
    expect(conflict.existingRecord.id).toBe(rec1.id);
    expect(conflict.conflictingRecord.id).toBe(rec2.id);

    // Explicitly resolve conflict in favor of rec2 (security audit port 443)
    const winner = await store.resolveConflict(conflict.conflictId, rec2.id);
    expect(winner.id).toBe(rec2.id);
    expect(winner.status).toBe(MemoryStatus.ACTIVE);

    const loser = await store.getRecord(rec1.id);
    expect(loser?.status).toBe(MemoryStatus.INVALIDATED);

    const remainingConflicts = await store.getConflicts();
    expect(remainingConflicts).toHaveLength(0);
  });

  it('5. Source Provenance: Preserves source origin, tool, file path, commit, phase, and timestamp', async () => {
    const store = createStore();
    const now = new Date();

    const provenance: MemoryProvenance = {
      source: 'tool:read_file',
      toolName: 'read_file',
      filePath: 'src/config/env.ts',
      commitHash: 'git-a1b2c3d',
      agentPhase: 'EXPLORE',
      timestamp: now,
    };

    const rec = await store.createRecord({
      type: MemoryType.PATTERN,
      content: 'Config loader requires JWT_SECRET in environment variables',
      source: 'tool:read_file',
      provenance,
      importance: 0.85,
      tags: ['architecture'],
    });

    expect(rec.provenance).toBeDefined();
    expect(rec.provenance?.toolName).toBe('read_file');
    expect(rec.provenance?.filePath).toBe('src/config/env.ts');
    expect(rec.provenance?.commitHash).toBe('git-a1b2c3d');
    expect(rec.provenance?.agentPhase).toBe('EXPLORE');
  });

  it('6. Memory Scope & Selective Retrieval: Filters across GLOBAL, REPOSITORY, TASK, FILE, COMPONENT scopes', async () => {
    const store = createStore();

    await store.createRecord({
      type: MemoryType.FACT,
      content: 'Global Enterprise Standard: ESM modules only',
      source: 'architect',
      scope: MemoryScope.GLOBAL,
      importance: 0.9,
      tags: ['architecture'],
    });

    await store.createRecord({
      type: MemoryType.FACT,
      content: 'File specific rule for src/auth.ts: export default AuthManager',
      source: 'linter',
      scope: MemoryScope.FILE,
      scopeTarget: 'src/auth.ts',
      importance: 0.8,
      tags: ['file_rule', 'architecture'],
    });

    const fileQuery = await store.retrieve({
      scopes: [MemoryScope.FILE],
      scopeTarget: 'src/auth.ts',
    });

    expect(fileQuery).toHaveLength(1);
    expect(fileQuery[0]?.record.scopeTarget).toBe('src/auth.ts');

    const globalQuery = await store.retrieve({
      scopes: [MemoryScope.GLOBAL],
    });
    expect(globalQuery).toHaveLength(1);
    expect(globalQuery[0]?.record.scope).toBe(MemoryScope.GLOBAL);
  });
});
