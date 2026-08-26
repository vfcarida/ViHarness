import { describe, it, expect, beforeEach } from 'vitest';
import {
  DefaultCheckpointStore,
  DefaultGitManager,
  DefaultRollbackManager,
  UuidV7IdFactory,
  TestClock,
} from '../../../src/infra/index.js';
import { AgentPhase, StateMachine } from '../../../src/core/index.js';
import type { TaskId } from '../../../src/core/index.js';

describe('Repository State Management & Checkpoints', () => {
  let checkpointStore: DefaultCheckpointStore;
  let gitManager: DefaultGitManager;
  let rollbackManager: DefaultRollbackManager;
  let idFactory: UuidV7IdFactory;
  let clock: TestClock;
  let taskId: TaskId;

  beforeEach(() => {
    idFactory = new UuidV7IdFactory();
    clock = new TestClock(new Date('2024-01-01T00:00:00Z'));

    checkpointStore = new DefaultCheckpointStore({ idFactory, clock });
    gitManager = new DefaultGitManager({
      initialBranch: 'main',
      initialCommit: 'c000000000000000000000000000000000000000',
    });
    rollbackManager = new DefaultRollbackManager();

    taskId = idFactory.create<'Task'>();
  });

  it('should create a checkpoint with full metadata and file ownership attribution', async () => {
    const stateMachine = new StateMachine({
      taskId,
      idFactory,
      clock,
      initialPhase: AgentPhase.IMPLEMENT,
    });

    const commitRef = await gitManager.createCommit('Agent milestone commit');

    const checkpoint = await checkpointStore.create({
      taskId,
      iteration: 3,
      state: stateMachine.state,
      gitRef: commitRef,
      evidenceSummary: 'Unit tests passed',
      modelId: 'claude-3-5-sonnet',
      reason: 'Feature implementation complete',
      agentOwnedFiles: ['src/auth/login.ts'],
      userOwnedFiles: ['user-config.json'],
    });

    expect(checkpoint.id).toBeDefined();
    expect(checkpoint.gitRef).toBe(commitRef);
    expect(checkpoint.iteration).toBe(3);
    expect(checkpoint.agentOwnedFiles).toContain('src/auth/login.ts');
    expect(checkpoint.userOwnedFiles).toContain('user-config.json');
  });

  it('should restore agent state from a stored checkpoint', async () => {
    const stateMachine = new StateMachine({
      taskId,
      idFactory,
      clock,
      initialPhase: AgentPhase.PLAN,
    });

    const cp = await checkpointStore.create({
      taskId,
      iteration: 2,
      state: stateMachine.state,
      reason: 'Plan finalized',
    });

    const restoredState = await checkpointStore.restore(cp.id);
    expect(restoredState.phase).toBe(AgentPhase.PLAN);
    expect(restoredState.taskId).toBe(taskId);
  });

  it('should detect dirty workspace state and separate agent-owned vs user-owned changes', async () => {
    expect(await gitManager.isDirty()).toBe(false);

    // Agent modifies source code
    gitManager.markFileOwner('src/utils/math.ts', 'agent');
    // User modifies local notes
    gitManager.markFileOwner('user-notes.md', 'user');

    const status = await gitManager.getStatus();
    expect(status.isDirty).toBe(true);
    expect(status.agentOwnedChanges).toContain('src/utils/math.ts');
    expect(status.userOwnedChanges).toContain('user-notes.md');
  });

  it('should perform Safe Rollback: revert agent changes while preserving user changes', async () => {
    const stateMachine = new StateMachine({ taskId, idFactory, clock });
    const commitRef = await gitManager.createCommit('Initial commit');

    // Agent modified auth.ts
    gitManager.markFileOwner('src/auth.ts', 'agent');
    // User modified my-script.py
    gitManager.markFileOwner('my-script.py', 'user');

    const cp = await checkpointStore.create({
      taskId,
      iteration: 1,
      state: stateMachine.state,
      gitRef: commitRef,
      agentOwnedFiles: ['src/auth.ts'],
      userOwnedFiles: ['my-script.py'],
    });

    // Execute rollback
    const result = await rollbackManager.rollbackToCheckpoint(cp.id, checkpointStore, gitManager);

    expect(result.success).toBe(true);
    expect(result.revertedFiles).toContain('src/auth.ts');
    expect(result.preservedUserChanges).toContain('my-script.py');
  });

  it('should handle failed rollback gracefully when checkpoint ID is invalid', async () => {
    const invalidId = idFactory.create<'Checkpoint'>();
    const result = await rollbackManager.rollbackToCheckpoint(
      invalidId,
      checkpointStore,
      gitManager,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Checkpoint not found');
  });

  it('should support milestone listing and replay per task', async () => {
    const sm = new StateMachine({ taskId, idFactory, clock });

    await checkpointStore.create({ taskId, iteration: 1, state: sm.state, reason: 'Milestone 1' });
    await checkpointStore.create({ taskId, iteration: 2, state: sm.state, reason: 'Milestone 2' });

    const taskCheckpoints = await checkpointStore.list(taskId);
    expect(taskCheckpoints).toHaveLength(2);
    expect(taskCheckpoints[0]!.iteration).toBe(1);
    expect(taskCheckpoints[1]!.iteration).toBe(2);
  });
});
