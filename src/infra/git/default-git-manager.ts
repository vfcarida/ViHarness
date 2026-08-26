// Pattern: Two-phase git commits (ref: Aider)
/**
 * Default Git Manager (In-Memory Simulation for Unit Testing).
 *
 * Implements GitManager interface:
 * Provides workspace state tracking, diff generation, branch creation,
 * file restoration, baseline measurement, and explicit file ownership attribution (agent vs user).
 */
import type { GitManager } from '../../core/interfaces/git-manager.js';
import type { WorkspaceState } from '../../core/model/git-types.js';

export interface DefaultGitManagerOptions {
  readonly initialBranch?: string;
  readonly initialCommit?: string;
}

export class DefaultGitManager implements GitManager {
  private currentBranchName: string;
  private headCommitSha: string;
  private readonly fileOwners = new Map<string, 'agent' | 'user'>();
  private readonly modifiedFilesSet = new Set<string>();
  private readonly stagedFilesSet = new Set<string>();
  private readonly untrackedFilesSet = new Set<string>();
  private readonly baselineUserFiles = new Set<string>();
  private baselineCaptured = false;
  private commitCounter = 1;

  constructor(options?: DefaultGitManagerOptions) {
    this.currentBranchName = options?.initialBranch ?? 'main';
    this.headCommitSha = options?.initialCommit ?? 'c000000000000000000000000000000000000000';
  }

  markFileOwner(path: string, owner: 'agent' | 'user'): void {
    this.fileOwners.set(path, owner);
    this.modifiedFilesSet.add(path);
  }

  markUntracked(path: string, owner: 'agent' | 'user' = 'user'): void {
    this.fileOwners.set(path, owner);
    this.untrackedFilesSet.add(path);
  }

  async isDirty(): Promise<boolean> {
    return (
      this.modifiedFilesSet.size > 0 ||
      this.stagedFilesSet.size > 0 ||
      this.untrackedFilesSet.size > 0
    );
  }

  async captureBaseline(): Promise<WorkspaceState> {
    const status = await this.getStatus();
    for (const file of [
      ...this.modifiedFilesSet,
      ...this.stagedFilesSet,
      ...this.untrackedFilesSet,
    ]) {
      if (this.fileOwners.get(file) !== 'agent') {
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
    const isDirty = await this.isDirty();
    const agentOwnedChanges: string[] = [];
    const userOwnedChanges: string[] = [];

    const allChanges = new Set([
      ...this.modifiedFilesSet,
      ...this.stagedFilesSet,
      ...this.untrackedFilesSet,
    ]);

    for (const file of allChanges) {
      const explicitOwner = this.fileOwners.get(file);
      if (explicitOwner === 'agent') {
        agentOwnedChanges.push(file);
      } else if (explicitOwner === 'user' || this.baselineUserFiles.has(file)) {
        userOwnedChanges.push(file);
      } else if (this.baselineCaptured) {
        agentOwnedChanges.push(file);
      } else {
        userOwnedChanges.push(file);
      }
    }

    return {
      isDirty,
      agentOwnedChanges,
      userOwnedChanges,
      untrackedFiles: Array.from(this.untrackedFilesSet),
      modifiedFiles: Array.from(this.modifiedFilesSet),
      stagedFiles: Array.from(this.stagedFilesSet),
      currentBranch: this.currentBranchName,
      headCommit: this.headCommitSha,
    };
  }

  async createCommit(_message: string): Promise<string> {
    this.commitCounter++;
    this.headCommitSha = `c${String(this.commitCounter).padStart(39, '0')}`;
    this.modifiedFilesSet.clear();
    this.stagedFilesSet.clear();
    this.untrackedFilesSet.clear();
    return this.headCommitSha;
  }

  async createBranch(branchName: string): Promise<void> {
    this.currentBranchName = branchName;
  }

  async getDiff(targetRef?: string): Promise<string> {
    const ref = targetRef ?? this.headCommitSha;
    const modified = Array.from(this.modifiedFilesSet).join(', ');
    return `diff --git a/b relative to ${ref}: modified [${modified}]`;
  }

  async checkout(ref: string): Promise<void> {
    this.headCommitSha = ref;
  }

  async restorePath(path: string): Promise<void> {
    this.modifiedFilesSet.delete(path);
    this.stagedFilesSet.delete(path);
    this.untrackedFilesSet.delete(path);
    this.fileOwners.delete(path);
  }
}
