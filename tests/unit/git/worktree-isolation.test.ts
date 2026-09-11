import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as child_process from 'node:child_process';
import {
  WorktreeIsolationManager,
  type RolloutWorkspace,
} from '../../../src/infra/git/worktree-isolation-manager.js';
import {
  RolloutSelector,
  type RolloutCandidate,
} from '../../../src/infra/eval/rollout-selector.js';

describe('WorktreeIsolationManager & RolloutSelector Suite', () => {
  let tempBase: string;
  let manager: WorktreeIsolationManager;

  beforeEach(() => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'vih-worktree-base-'));
    manager = new WorktreeIsolationManager();
  });

  afterEach(async () => {
    try {
      await manager.cleanupAll(tempBase);
      fs.rmSync(tempBase, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('creates isolated rollout workspace via fallback copy when not in git repository', async () => {
    fs.writeFileSync(path.join(tempBase, 'app.ts'), 'export const version = 1;', 'utf-8');

    const rollout = await manager.createRollout(tempBase, 'r1');
    expect(rollout.id).toBe('r1');
    expect(rollout.isWorktree).toBe(false);
    expect(fs.existsSync(path.join(rollout.path, 'app.ts'))).toBe(true);

    // Modifying rollout does not affect base
    fs.writeFileSync(path.join(rollout.path, 'app.ts'), 'export const version = 2;', 'utf-8');
    expect(fs.readFileSync(path.join(tempBase, 'app.ts'), 'utf-8')).toBe('export const version = 1;');

    await manager.cleanupRollout(rollout, tempBase);
    expect(fs.existsSync(rollout.path)).toBe(false);
  });

  it('creates isolated rollout via git worktree when in initialized git repository', async () => {
    // Initialize git repo in tempBase
    try {
      child_process.execSync('git init', { cwd: tempBase, stdio: 'ignore' });
      child_process.execSync('git config user.email "test@example.com"', { cwd: tempBase, stdio: 'ignore' });
      child_process.execSync('git config user.name "Test User"', { cwd: tempBase, stdio: 'ignore' });
      fs.writeFileSync(path.join(tempBase, 'index.ts'), 'console.log("base");', 'utf-8');
      child_process.execSync('git add index.ts', { cwd: tempBase, stdio: 'ignore' });
      child_process.execSync('git commit -m "initial commit"', { cwd: tempBase, stdio: 'ignore' });
    } catch {
      // If git CLI is missing in environment, test passes via fallback
      return;
    }

    const rollout = await manager.createRollout(tempBase, 'git-r1');
    expect(rollout.isWorktree).toBe(true);
    expect(fs.existsSync(path.join(rollout.path, 'index.ts'))).toBe(true);

    // Modify file in worktree
    fs.writeFileSync(path.join(rollout.path, 'index.ts'), 'console.log("rollout mod");', 'utf-8');
    expect(fs.readFileSync(path.join(tempBase, 'index.ts'), 'utf-8')).toBe('console.log("base");');

    await manager.cleanupRollout(rollout, tempBase);
    expect(fs.existsSync(rollout.path)).toBe(false);
  });

  it('RolloutSelector returns null on empty candidates', () => {
    const res = RolloutSelector.selectBestRollout([]);
    expect(res).toBeNull();
  });

  it('RolloutSelector prefers candidate with higher test pass rate', () => {
    const c1: RolloutCandidate = {
      rolloutId: 'c1',
      workspacePath: '/tmp/c1',
      patch: 'diff1',
      success: false,
      testPassRate: 0.5,
      compilerWarningsCount: 0,
      linesChanged: 10,
      durationMs: 1000,
    };
    const c2: RolloutCandidate = {
      rolloutId: 'c2',
      workspacePath: '/tmp/c2',
      patch: 'diff2',
      success: true,
      testPassRate: 1.0,
      compilerWarningsCount: 0,
      linesChanged: 15,
      durationMs: 1200,
    };

    const res = RolloutSelector.selectBestRollout([c1, c2]);
    expect(res).not.toBeNull();
    expect(res!.winner.rolloutId).toBe('c2');
    expect(res!.ranking.length).toBe(2);
    expect(res!.ranking[0]!.candidate.rolloutId).toBe('c2');
  });

  it('RolloutSelector penalizes compiler warnings and code churn as tie-breakers', () => {
    const c1: RolloutCandidate = {
      rolloutId: 'c1-warnings',
      workspacePath: '/tmp/c1',
      patch: 'diff1',
      success: true,
      testPassRate: 1.0,
      compilerWarningsCount: 4, // penalty
      linesChanged: 10,
      durationMs: 1000,
    };
    const c2: RolloutCandidate = {
      rolloutId: 'c2-clean',
      workspacePath: '/tmp/c2',
      patch: 'diff2',
      success: true,
      testPassRate: 1.0,
      compilerWarningsCount: 0, // clean
      linesChanged: 12,
      durationMs: 1100,
    };

    const res = RolloutSelector.selectBestRollout([c1, c2]);
    expect(res!.winner.rolloutId).toBe('c2-clean');
    expect(res!.ranking[0]!.compositeScore).toBeGreaterThan(res!.ranking[1]!.compositeScore);
  });
});
