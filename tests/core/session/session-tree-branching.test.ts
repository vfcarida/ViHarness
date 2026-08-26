/**
 * Session Tree Branching & Lineage Unit Tests (P008).
 *
 * Validates:
 * 1. Forking at arbitrary sequence boundaries with seedLength tracking (Pi pattern).
 * 2. Independent divergence of parent and child branches.
 * 3. Tree navigation: findAncestors, findChildren, findCommonAncestor.
 * 4. Boundary range validation.
 */
import { describe, it, expect } from 'vitest';
import { DefaultSession, InMemorySessionStore } from '../../../src/core/session/index.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';
import { TestClock } from '../../../src/infra/time/test-clock.js';
import { HarnessError } from '../../../src/core/errors/base-error.js';

describe('Session Tree Branching & Lineage (Pi Pattern) — P008', () => {
  const clock = new TestClock(new Date('2026-01-01T00:00:00.000Z'));
  const idFactory = new UuidV7IdFactory();

  it('1. should fork session at sequence boundary, inheriting seed events', () => {
    const parent = new DefaultSession({
      header: {
        version: 1,
        id: idFactory.create<'Session'>(),
        createdAt: clock.now().getTime(),
        cwd: '/workspace',
      },
      idFactory,
      clock,
    });

    parent.append('turn/start', { turn: 1 }); // seq 0
    parent.append('user/message', { content: 'Explore code' }); // seq 1
    parent.append('turn/end', { turn: 1, reason: { kind: 'complete' } }); // seq 2
    parent.append('turn/start', { turn: 2 }); // seq 3
    parent.append('user/message', { content: 'Plan approach A' }); // seq 4
    parent.append('turn/end', { turn: 2, reason: { kind: 'complete' } }); // seq 5

    // Fork after Turn 1 (at seq 2)
    const child = parent.fork(2);

    expect(child.id).not.toBe(parent.id);
    expect(child.header.parentSession).toBe(parent.id);
    expect(child.header.seedLength).toBe(3);
    expect(child.firstLiveSeq).toBe(3);
    expect(child.header.delegationDepth).toBe(1);
    expect(child.log).toHaveLength(3);
    expect(child.log[0]?.seq).toBe(0);
    expect(child.log[1]?.seq).toBe(1);
    expect(child.log[2]?.seq).toBe(2);
  });

  it('2. should diverge independently after fork without cross-contamination', () => {
    const parent = new DefaultSession({
      header: { version: 1, id: idFactory.create<'Session'>(), createdAt: clock.now().getTime() },
      idFactory,
      clock,
    });

    parent.append('user/message', { content: 'Base prompt' }); // seq 0

    const childBranchA = parent.fork(0);
    const childBranchB = parent.fork(0);

    // Branch A explores Solution 1
    childBranchA.append('user/message', { content: 'Try Solution 1' }); // seq 1

    // Branch B explores Solution 2
    childBranchB.append('user/message', { content: 'Try Solution 2' }); // seq 1

    // Parent continues with Solution 3
    parent.append('user/message', { content: 'Try Solution 3' }); // seq 1

    expect(parent.log).toHaveLength(2);
    expect((parent.log[1]?.data as any).content).toBe('Try Solution 3');

    expect(childBranchA.log).toHaveLength(2);
    expect((childBranchA.log[1]?.data as any).content).toBe('Try Solution 1');

    expect(childBranchB.log).toHaveLength(2);
    expect((childBranchB.log[1]?.data as any).content).toBe('Try Solution 2');
  });

  it('3. should enforce valid boundary ranges when forking', () => {
    const session = new DefaultSession({
      header: { version: 1, id: idFactory.create<'Session'>(), createdAt: clock.now().getTime() },
      idFactory,
      clock,
    });

    session.append('turn/start', { turn: 1 }); // seq 0

    // Out of bounds: greater than max sequence
    expect(() => session.fork(5)).toThrow(HarnessError);

    // Out of bounds: less than -1
    expect(() => session.fork(-2)).toThrow(HarnessError);

    // Boundary -1 produces completely empty seed
    const emptyChild = session.fork(-1);
    expect(emptyChild.log).toHaveLength(0);
    expect(emptyChild.header.seedLength).toBe(0);
  });

  it('4. should navigate ancestor tree from child to root (findAncestors)', () => {
    const store = new InMemorySessionStore({ idFactory, clock });

    const root = store.create();
    root.append('user/message', { content: 'Root prompt' });

    const branch1 = store.fork(root.id);
    branch1.append('user/message', { content: 'Subtask 1' });

    const subBranch1 = store.fork(branch1.id);
    subBranch1.append('user/message', { content: 'Subtask 1.1' });

    const ancestors = store.findAncestors(subBranch1.id);
    expect(ancestors).toHaveLength(3);
    expect(ancestors[0]?.id).toBe(root.id);
    expect(ancestors[1]?.id).toBe(branch1.id);
    expect(ancestors[2]?.id).toBe(subBranch1.id);
  });

  it('5. should find immediate children spawned from a session (findChildren)', () => {
    const store = new InMemorySessionStore({ idFactory, clock });

    const root = store.create();
    root.append('user/message', { content: 'Root' });

    const childA = store.fork(root.id);
    const childB = store.fork(root.id);
    const childC = store.fork(root.id);

    // Grandchild
    store.fork(childA.id);

    const childrenOfRoot = store.findChildren(root.id);
    expect(childrenOfRoot).toHaveLength(3);
    expect(childrenOfRoot.map((c) => c.id).sort()).toEqual(
      [childA.id, childB.id, childC.id].sort(),
    );
  });

  it('6. should calculate lowest common ancestor between two arbitrary branches (findCommonAncestor)', () => {
    const store = new InMemorySessionStore({ idFactory, clock });

    const root = store.create();

    const branchA = store.fork(root.id);
    const leafA1 = store.fork(branchA.id);
    const leafA2 = store.fork(branchA.id);

    const branchB = store.fork(root.id);
    const leafB1 = store.fork(branchB.id);

    // Common ancestor of leafA1 and leafA2 is branchA
    const lcaA = store.findCommonAncestor(leafA1.id, leafA2.id);
    expect(lcaA?.id).toBe(branchA.id);

    // Common ancestor of leafA1 and leafB1 is root
    const lcaAB = store.findCommonAncestor(leafA1.id, leafB1.id);
    expect(lcaAB?.id).toBe(root.id);

    // Common ancestor of a node with itself is itself
    const lcaSelf = store.findCommonAncestor(leafA1.id, leafA1.id);
    expect(lcaSelf?.id).toBe(leafA1.id);
  });

  it('7. should increment delegationDepth across multiple hierarchical forks', () => {
    const store = new InMemorySessionStore({ idFactory, clock });

    const root = store.create();
    expect(root.header.delegationDepth).toBe(0);

    const level1 = store.fork(root.id);
    expect(level1.header.delegationDepth).toBe(1);

    const level2 = store.fork(level1.id);
    expect(level2.header.delegationDepth).toBe(2);

    const level3 = store.fork(level2.id);
    expect(level3.header.delegationDepth).toBe(3);
  });
});
