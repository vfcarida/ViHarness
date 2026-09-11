/**
 * Worktree Isolation Manager.
 *
 * Manages isolated development working trees for multi-rollout agent execution:
 * - Uses `git worktree add` to create instant, zero-copy working directories
 * - Provides parallel isolation without cloning repositories
 * - Safely removes ephemeral worktrees and branches upon completion
 * - Gracefully falls back to directory copies when Git is unavailable
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const execFileAsync = promisify(execFile);

export interface RolloutWorkspace {
  readonly id: string;
  readonly path: string;
  readonly branchName: string;
  readonly isWorktree: boolean;
}

export class WorktreeIsolationManager {
  private readonly activeRollouts: Map<string, RolloutWorkspace> = new Map();

  /**
   * Check if git is available and target path is inside a working tree.
   */
  private async isGitRepo(dir: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: dir,
        timeout: 5000,
      });
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Creates an isolated rollout workspace (via git worktree if available, else copy).
   */
  async createRollout(baseDir: string, rolloutId: string): Promise<RolloutWorkspace> {
    const resolvedBase = path.resolve(baseDir);
    const hasGit = await this.isGitRepo(resolvedBase);

    const uniqueTag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const tempDir = path.join(os.tmpdir(), `vih-rollout-${rolloutId}-${uniqueTag}`);
    const branchName = `vih-rollout-${rolloutId}-${uniqueTag}`;

    if (hasGit) {
      try {
        await execFileAsync(
          'git',
          ['worktree', 'add', '-b', branchName, tempDir, 'HEAD'],
          { cwd: resolvedBase, timeout: 15000 },
        );

        const rollout: RolloutWorkspace = {
          id: rolloutId,
          path: tempDir,
          branchName,
          isWorktree: true,
        };
        this.activeRollouts.set(rolloutId, rollout);
        return rollout;
      } catch {
        // Fallback to directory copy if worktree add fails (e.g. bare repo or locked tree)
      }
    }

    // Fallback: Copy directory structure excluding build/cache artifacts
    fs.mkdirSync(tempDir, { recursive: true });
    this.copyDirectoryExcluding(resolvedBase, tempDir, [
      '.git',
      'node_modules',
      'dist',
      'build',
      'out',
      '.cache',
    ]);

    const rollout: RolloutWorkspace = {
      id: rolloutId,
      path: tempDir,
      branchName: '',
      isWorktree: false,
    };
    this.activeRollouts.set(rolloutId, rollout);
    return rollout;
  }

  /**
   * Cleans up an individual rollout workspace.
   */
  async cleanupRollout(rollout: RolloutWorkspace, baseDir: string): Promise<void> {
    const resolvedBase = path.resolve(baseDir);

    if (rollout.isWorktree) {
      try {
        await execFileAsync('git', ['worktree', 'remove', '--force', rollout.path], {
          cwd: resolvedBase,
          timeout: 10000,
        });
      } catch {
        // Force delete directory if git worktree remove encounters issues
        try {
          fs.rmSync(rollout.path, { recursive: true, force: true });
        } catch {
          // Ignore
        }
      }

      if (rollout.branchName) {
        try {
          await execFileAsync('git', ['branch', '-D', rollout.branchName], {
            cwd: resolvedBase,
            timeout: 5000,
          });
        } catch {
          // Ignore branch deletion error
        }
      }
    } else {
      try {
        fs.rmSync(rollout.path, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }

    this.activeRollouts.delete(rollout.id);
  }

  /**
   * Cleans up all active rollouts.
   */
  async cleanupAll(baseDir: string): Promise<void> {
    const rollouts = Array.from(this.activeRollouts.values());
    for (const rollout of rollouts) {
      await this.cleanupRollout(rollout, baseDir);
    }
  }

  private copyDirectoryExcluding(src: string, dest: string, excludeList: string[]): void {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      if (excludeList.includes(entry.name)) continue;

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this.copyDirectoryExcluding(srcPath, destPath, excludeList);
      } else if (entry.isFile()) {
        try {
          fs.copyFileSync(srcPath, destPath);
        } catch {
          // Ignore copy failures
        }
      }
    }
  }
}
