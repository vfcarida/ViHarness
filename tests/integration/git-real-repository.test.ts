import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  RealGitManager,
  DefaultRollbackManager,
  DefaultCheckpointStore,
  UuidV7IdFactory,
  TestClock,
  AgentPhase,
} from '../../src/index.js';
import type { TaskId } from '../../src/index.js';

const execFileAsync = promisify(execFile);

describe('Real Repository Git & Checkpoint Integration Suite', { timeout: 30000 }, () => {
  let tempRepoDir: string;
  let gitManager: RealGitManager;
  let rollbackManager: DefaultRollbackManager;
  let checkpointStore: DefaultCheckpointStore;
  let idFactory: UuidV7IdFactory;
  let clock: TestClock;
  let taskId: TaskId;

  async function execGit(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd: tempRepoDir,
      encoding: 'utf-8',
    });
    return stdout.trim();
  }

  beforeEach(async () => {
    idFactory = new UuidV7IdFactory();
    clock = new TestClock(new Date('2026-01-01T00:00:00Z'));
    taskId = idFactory.create<'Task'>();

    // 1. Create real temp directory for Git repo
    tempRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-harness-git-test-'));

    // 2. Initialize real Git repo
    await execGit(['init']);
    await execGit(['config', 'user.name', 'Vi Harness Test']);
    await execGit(['config', 'user.email', 'harness@example.com']);
    await execGit(['checkout', '-b', 'main']);

    // 3. Create initial committed file
    fs.writeFileSync(path.join(tempRepoDir, 'README.md'), '# Initial Repository\n', 'utf-8');
    await execGit(['add', '-A']);
    await execGit(['commit', '-m', 'Initial commit']);

    // 4. Instantiate components
    gitManager = new RealGitManager({ workingDir: tempRepoDir });
    rollbackManager = new DefaultRollbackManager();
    checkpointStore = new DefaultCheckpointStore({ idFactory, clock });
  }, 60000);

  afterEach(async () => {
    // Cleanup temporary directory safely on Windows
    if (tempRepoDir && fs.existsSync(tempRepoDir)) {
      try {
        fs.rmSync(tempRepoDir, { recursive: true, force: true });
      } catch {
        await new Promise((r) => setTimeout(r, 50));
        try {
          if (fs.existsSync(tempRepoDir)) {
            fs.rmSync(tempRepoDir, { recursive: true, force: true });
          }
        } catch {
          // ignore
        }
      }
    }
  });

  // =========================================================================
  // 1. Clean Repository Measurement
  // =========================================================================

  it('1. Clean repository: measures branch, commit SHA, and non-dirty status', async () => {
    const dirty = await gitManager.isDirty();
    expect(dirty).toBe(false);

    const status = await gitManager.getStatus();
    expect(status.isDirty).toBe(false);
    expect(status.currentBranch).toBe('main');
    expect(status.headCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(status.modifiedFiles).toHaveLength(0);
    expect(status.untrackedFiles).toHaveLength(0);
    expect(status.agentOwnedChanges).toHaveLength(0);
    expect(status.userOwnedChanges).toHaveLength(0);
  });

  // =========================================================================
  // 2. Dirty Repository & Pre-existing User Changes Baseline
  // =========================================================================

  it('2. Dirty repository: captures baseline user changes before agent starts', async () => {
    // User modifies README and creates user_draft.txt BEFORE agent runs
    fs.appendFileSync(path.join(tempRepoDir, 'README.md'), 'User uncommitted edit.\n', 'utf-8');
    fs.writeFileSync(path.join(tempRepoDir, 'user_draft.txt'), 'User draft content.\n', 'utf-8');

    // Measure dirty state
    expect(await gitManager.isDirty()).toBe(true);

    // Agent captures baseline
    const baseline = await gitManager.captureBaseline();
    expect(baseline.isDirty).toBe(true);
    expect(baseline.untrackedFiles).toContain('user_draft.txt');
    expect(baseline.modifiedFiles).toContain('README.md');
    expect(baseline.userOwnedChanges).toContain('README.md');
    expect(baseline.userOwnedChanges).toContain('user_draft.txt');
    expect(baseline.agentOwnedChanges).toHaveLength(0);
  });

  // =========================================================================
  // 3. Agent Changes & Delta Calculation
  // =========================================================================

  it('3. Agent changes: calculates agent delta relative to baseline', async () => {
    // Pre-existing user change
    fs.writeFileSync(path.join(tempRepoDir, 'user_notes.txt'), 'User notes.\n', 'utf-8');
    await gitManager.captureBaseline();

    // Agent creates a feature file and modifies code
    fs.writeFileSync(
      path.join(tempRepoDir, 'agent_feature.ts'),
      'export const feature = 42;\n',
      'utf-8',
    );
    fs.writeFileSync(path.join(tempRepoDir, 'agent_fix.ts'), 'export const fix = true;\n', 'utf-8');

    const status = await gitManager.getStatus();
    expect(status.userOwnedChanges).toContain('user_notes.txt');
    expect(status.agentOwnedChanges).toContain('agent_feature.ts');
    expect(status.agentOwnedChanges).toContain('agent_fix.ts');

    const delta = await gitManager.getAgentDelta();
    expect(delta).toHaveLength(2);
    expect(delta).toContain('agent_feature.ts');
    expect(delta).toContain('agent_fix.ts');
  });

  // =========================================================================
  // 4. User Changes During Agent Execution
  // =========================================================================

  it('4. User changes during agent execution: explicit user file marking preserves user changes', async () => {
    await gitManager.captureBaseline();

    // Agent modifies file
    fs.writeFileSync(path.join(tempRepoDir, 'agent_patch.ts'), 'const a = 1;\n', 'utf-8');

    // User also modifies a config file mid-execution
    fs.writeFileSync(
      path.join(tempRepoDir, 'user_override.json'),
      '{ "theme": "dark" }\n',
      'utf-8',
    );
    gitManager.markFileOwner('user_override.json', 'user');

    const status = await gitManager.getStatus();
    expect(status.agentOwnedChanges).toContain('agent_patch.ts');
    expect(status.userOwnedChanges).toContain('user_override.json');
  });

  // =========================================================================
  // 5. Real Checkpoint Creation & Restore
  // =========================================================================

  it('5. Checkpoint creation: creates real Git commit and records checkpoint SHA', async () => {
    await gitManager.captureBaseline();

    fs.writeFileSync(path.join(tempRepoDir, 'feature.ts'), 'export const v = 1;\n', 'utf-8');

    // Create real commit
    const commitSha = await gitManager.createCommit('Milestone 1: Added feature.ts');
    expect(commitSha).toMatch(/^[0-9a-f]{40}$/);

    const cp = await checkpointStore.create({
      taskId,
      gitRef: commitSha,
      reason: 'Milestone 1 checkpoint',
      state: {
        id: idFactory.create<'State'>(),
        taskId,
        phase: AgentPhase.IMPLEMENT,
        previousPhase: AgentPhase.PLAN,
        iterationId: idFactory.create<'Iteration'>(),
        iterationCount: 1,
        repairCount: 0,
        metadata: {},
        createdAt: clock.now(),
        updatedAt: clock.now(),
      },
      agentOwnedFiles: ['feature.ts'],
    });

    expect(cp.gitRef).toBe(commitSha);

    const retrievedCp = await checkpointStore.getCheckpoint(cp.id);
    expect(retrievedCp?.gitRef).toBe(commitSha);
  });

  // =========================================================================
  // 6. Safe Rollback Behavior (Preserves User Changes, Reverts Agent Changes)
  // =========================================================================

  it(
    '6. Safe rollback: reverts agent-owned changes without destroying pre-existing user changes',
    { timeout: 60000 },
    async () => {
      // 1. User pre-existing change
      fs.writeFileSync(
        path.join(tempRepoDir, 'user_uncommitted.txt'),
        'User work in progress.\n',
        'utf-8',
      );
      await gitManager.captureBaseline();

      // 2. Initial agent work + checkpoint
      fs.writeFileSync(
        path.join(tempRepoDir, 'good_agent_code.ts'),
        'console.log("good");\n',
        'utf-8',
      );
      const cpCommitSha = await gitManager.createCommit('Checkpoint 1: Good code');

      const checkpoint = await checkpointStore.create({
        taskId,
        gitRef: cpCommitSha,
        reason: 'Good state',
        state: {
          id: idFactory.create<'State'>(),
          taskId,
          phase: AgentPhase.IMPLEMENT,
          previousPhase: AgentPhase.PLAN,
          iterationId: idFactory.create<'Iteration'>(),
          iterationCount: 1,
          repairCount: 0,
          metadata: {},
          createdAt: clock.now(),
          updatedAt: clock.now(),
        },
        agentOwnedFiles: ['good_agent_code.ts'],
      });

      // 3. Agent creates bad file
      fs.writeFileSync(path.join(tempRepoDir, 'bad_agent_code.ts'), 'syntax error!\n', 'utf-8');
      gitManager.markFileOwner('bad_agent_code.ts', 'agent');

      expect(fs.existsSync(path.join(tempRepoDir, 'bad_agent_code.ts'))).toBe(true);

      // 4. Rollback to checkpoint
      const rollbackResult = await rollbackManager.rollbackToCheckpoint(
        checkpoint.id,
        checkpointStore,
        gitManager,
      );

      expect(rollbackResult.success).toBe(true);

      // Bad agent file must be removed
      expect(fs.existsSync(path.join(tempRepoDir, 'bad_agent_code.ts'))).toBe(false);

      // Pre-existing user file MUST BE PRESERVED
      expect(fs.existsSync(path.join(tempRepoDir, 'user_uncommitted.txt'))).toBe(true);
      expect(fs.readFileSync(path.join(tempRepoDir, 'user_uncommitted.txt'), 'utf-8')).toBe(
        'User work in progress.\n',
      );
    },
  );

  // =========================================================================
  // 7. Failed Rollback Handling
  // =========================================================================

  it('7. Failed rollback: handles invalid checkpoint or invalid Git ref gracefully', async () => {
    const fakeCpId = idFactory.create<'Checkpoint'>();

    const result = await rollbackManager.rollbackToCheckpoint(
      fakeCpId,
      checkpointStore,
      gitManager,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Checkpoint not found');
  });

  it('8. Branch creation: creates real Git branch and switches workspace', async () => {
    await gitManager.createBranch('task/feature-xyz');

    const status = await gitManager.getStatus();
    expect(status.currentBranch).toBe('task/feature-xyz');
  });
});
