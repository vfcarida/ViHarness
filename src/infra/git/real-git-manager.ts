// Pattern: Two-phase git commits & safe rollback (ref: Aider)
/**
 * Real Git Manager.
 *
 * Implements GitManager interface for real repository workloads:
 * Uses Node.js child_process.execFile to execute real git binary CLI commands against a working tree.
 * Measures real repository status, current commit, branch, dirty state, and diffs.
 * Enforces baseline capture, agent delta calculation, and non-destructive rollback semantics.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { GitManager } from '../../core/interfaces/git-manager.js';
import type { WorkspaceState } from '../../core/model/git-types.js';
import { HarnessError } from '../../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../core/errors/error-codes.js';

import { scrubEnv } from '../security/env-scrubber.js';

const execFileAsync = promisify(execFile);

export interface RealGitManagerOptions {
  /** Absolute path to working repository directory. */
  readonly workingDir: string;
}

export class RealGitManager implements GitManager {
  private readonly workingDir: string;
  private readonly explicitFileOwners = new Map<string, 'agent' | 'user'>();
  private readonly baselineUserFiles = new Set<string>();
  private baselineCaptured = false;
  private baselineHeadSha = '';
  private baselineBranchName = '';
  private userStateCommitSha?: string;

  constructor(options: RealGitManagerOptions) {
    if (!options.workingDir) {
      throw new HarnessError({
        code: ErrorCode.CONFIG_INVALID,
        category: ErrorCategory.CONFIGURATION,
        message: 'RealGitManager requires a valid workingDir option.',
      });
    }
    this.workingDir = path.resolve(options.workingDir);
  }

  /** Return recorded baseline commit SHA (if baseline was captured). */
  get baselineHead(): string {
    return this.baselineHeadSha;
  }

  /** Return recorded baseline branch name (if baseline was captured). */
  get baselineBranch(): string {
    return this.baselineBranchName;
  }

  /** Return user-state commit SHA created during two-phase commit (if any). */
  get userStateCommit(): string | undefined {
    return this.userStateCommitSha;
  }

  /** Run a git CLI command in workingDir with environment scrubbing. */
  private async execGit(args: ReadonlyArray<string>): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
        cwd: this.workingDir,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        env: scrubEnv(process.env as Record<string, string>),
      });
      return stdout;
    } catch (err: unknown) {
      const execErr = err as { stderr?: string; stdout?: string; message?: string };
      const msg =
        execErr.stderr?.trim() || execErr.stdout?.trim() || execErr.message || String(err);
      throw new HarnessError({
        code: ErrorCode.GIT_OPERATION_FAILED,
        category: ErrorCategory.INFRASTRUCTURE,
        message: `Git command failed [git ${args.join(' ')}]: ${msg}`,
      });
    }
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/^\.\//, '');
  }

  markFileOwner(pathRel: string, owner: 'agent' | 'user'): void {
    this.explicitFileOwners.set(this.normalizePath(pathRel), owner);
  }

  async isDirty(): Promise<boolean> {
    const porcelain = (await this.execGit(['status', '--porcelain=v1'])).trim();
    return porcelain.length > 0;
  }

  /**
   * Prepares two-phase commit: If repository has uncommitted dirty changes,
   * creates a user-state commit before agent execution so rollbacks only undo agent changes.
   */
  async prepareTwoPhaseCommit(options?: {
    preserveUserChanges?: boolean;
    commitMessage?: string;
  }): Promise<{ userStateCommit?: string; wasDirty: boolean }> {
    const dirty = await this.isDirty();
    if (!dirty) {
      this.userStateCommitSha = undefined;
      return { wasDirty: false };
    }

    if (options?.preserveUserChanges === false) {
      return { wasDirty: true };
    }

    const message =
      options?.commitMessage ?? '[vi-harness] preserve user changes before agent execution';
    const commitSha = await this.createCommit(message);
    this.userStateCommitSha = commitSha;
    this.baselineHeadSha = commitSha;
    return { userStateCommit: commitSha, wasDirty: true };
  }

  async captureBaseline(options?: { preserveUserChanges?: boolean }): Promise<WorkspaceState> {
    // If preserveUserChanges is explicitly enabled and workspace is dirty, perform two-phase commit
    if (options?.preserveUserChanges === true && (await this.isDirty())) {
      await this.prepareTwoPhaseCommit(options);
    }

    const status = await this.getStatus();
    this.baselineHeadSha = status.headCommit;
    this.baselineBranchName = status.currentBranch;

    for (const file of [...status.modifiedFiles, ...status.stagedFiles, ...status.untrackedFiles]) {
      if (this.explicitFileOwners.get(file) !== 'agent') {
        this.baselineUserFiles.add(file);
      }
    }

    this.baselineCaptured = true;
    return status;
  }

  async getAgentDelta(): Promise<ReadonlyArray<string>> {
    const status = await this.getStatus();
    return status.agentOwnedChanges;
  }

  async getStatus(): Promise<WorkspaceState> {
    let currentBranch = 'main';
    try {
      currentBranch = (await this.execGit(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    } catch {
      currentBranch = 'HEAD';
    }

    let headCommit = '0000000000000000000000000000000000000000';
    try {
      headCommit = (await this.execGit(['rev-parse', 'HEAD'])).trim();
    } catch {
      // Empty repo before first commit
    }

    const porcelain = await this.execGit(['status', '--porcelain=v1']);

    const untrackedFilesSet = new Set<string>();
    const modifiedFilesSet = new Set<string>();
    const stagedFilesSet = new Set<string>();
    const allChangedSet = new Set<string>();

    if (porcelain) {
      const rawLines = porcelain.split(/\r?\n/);
      for (const line of rawLines) {
        if (!line || line.length < 3) continue;
        const indexStatus = line[0];
        const worktreeStatus = line[1];

        if (!indexStatus || !worktreeStatus) continue;

        // Format: "XY Path" or "XY Path -> NewPath"
        let fileRel = line.substring(2).trim();
        if (fileRel.startsWith('"') && fileRel.endsWith('"')) {
          fileRel = fileRel.slice(1, -1);
        }
        if (fileRel.includes(' -> ')) {
          const splitParts = fileRel.split(' -> ');
          if (splitParts[1]) {
            fileRel = splitParts[1].trim();
            if (fileRel.startsWith('"') && fileRel.endsWith('"')) {
              fileRel = fileRel.slice(1, -1);
            }
          }
        }
        fileRel = this.normalizePath(fileRel);

        allChangedSet.add(fileRel);

        if (indexStatus === '?' && worktreeStatus === '?') {
          untrackedFilesSet.add(fileRel);
        } else {
          if (indexStatus !== ' ' && indexStatus !== '?') {
            stagedFilesSet.add(fileRel);
          }
          if (worktreeStatus !== ' ' && worktreeStatus !== '?') {
            modifiedFilesSet.add(fileRel);
          }
        }
      }
    }

    const agentOwnedChanges: string[] = [];
    const userOwnedChanges: string[] = [];

    for (const file of allChangedSet) {
      const explicitOwner = this.explicitFileOwners.get(file);

      if (explicitOwner === 'agent') {
        agentOwnedChanges.push(file);
      } else if (explicitOwner === 'user' || this.baselineUserFiles.has(file)) {
        userOwnedChanges.push(file);
      } else if (this.baselineCaptured) {
        // Touched after baseline capture and not in baseline -> Agent owned
        agentOwnedChanges.push(file);
      } else {
        userOwnedChanges.push(file);
      }
    }

    return {
      isDirty: allChangedSet.size > 0,
      agentOwnedChanges,
      userOwnedChanges,
      untrackedFiles: Array.from(untrackedFilesSet),
      modifiedFiles: Array.from(modifiedFilesSet),
      stagedFiles: Array.from(stagedFilesSet),
      currentBranch,
      headCommit,
    };
  }

  async createCommit(message: string): Promise<string> {
    await this.execGit(['add', '-A']);
    await this.execGit(['commit', '-m', message, '--allow-empty']);
    return (await this.execGit(['rev-parse', 'HEAD'])).trim();
  }

  async createBranch(branchName: string): Promise<void> {
    await this.execGit(['checkout', '-b', branchName]);
  }

  async getDiff(targetRef?: string): Promise<string> {
    const ref = targetRef ?? 'HEAD';
    return (await this.execGit(['diff', ref])).trim();
  }

  async checkout(ref: string): Promise<void> {
    await this.execGit(['checkout', ref]);
  }

  async restorePath(pathRel: string, ref?: string): Promise<void> {
    const normPath = this.normalizePath(pathRel);
    const fullPath = path.join(this.workingDir, normPath);

    const status = await this.getStatus();
    const isUntracked = status.untrackedFiles.includes(normPath);

    if (isUntracked) {
      // Remove untracked file created by agent
      if (fs.existsSync(fullPath)) {
        await fs.promises.rm(fullPath, { force: true, recursive: true });
      }
    } else {
      // Tracked file: checkout/restore specified ref or HEAD
      const targetRef = ref ?? 'HEAD';
      try {
        await this.execGit(['checkout', targetRef, '--', normPath]);
      } catch {
        // If file didn't exist in targetRef (created by agent in a later commit), delete it to restore state
        if (fs.existsSync(fullPath)) {
          await fs.promises.rm(fullPath, { force: true, recursive: true });
        }
      }
    }

    this.explicitFileOwners.delete(normPath);
  }
}
