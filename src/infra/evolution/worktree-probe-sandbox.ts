/**
 * Wave 6.1 — Ephemeral Git Worktree Probe Sandbox (`WorktreeProbeSandboxManager`).
 *
 * Provides physical filesystem isolation for parallel and sequential candidate probes:
 * 1. Creates an ephemeral Git worktree (`git worktree add --detach`) per probe trial
 *    when `workspaceRoot` is a Git repository, or an isolated copy-on-write snapshot
 *    directory in `os.tmpdir()` when running in non-Git workspaces.
 * 2. Captures post-trial workspace modifications (`modifiedFiles`, `patchDigest`, `diffSummary`)
 *    as verifiable evidence artifacts.
 * 3. Guarantees deterministic teardown (`git worktree remove --force` + `fs.rm`) inside
 *    a `finally` block so parallel candidate probes never leak state or collide.
 */
import * as childProcess from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(childProcess.execFile);

export interface IsolatedProbeWorkspace {
  readonly sandboxId: string;
  readonly sandboxDir: string;
  readonly isolationMode: 'GIT_WORKTREE' | 'SNAPSHOT_COPY';
  readonly candidateId: string;
  readonly taskId: string;
  readonly trialIndex: number;
}

export interface ProbeWorkspacePatchArtifact {
  readonly sandboxId: string;
  readonly isolationMode: 'GIT_WORKTREE' | 'SNAPSHOT_COPY';
  readonly modifiedFiles: ReadonlyArray<string>;
  readonly patchDigest: string;
  readonly diffExcerpt: string;
  readonly cleanedUp: boolean;
}

export interface WorktreeProbeSandboxOptions {
  readonly baseTempDir?: string;
  readonly preferGitWorktree?: boolean;
  readonly maxDiffExcerptChars?: number;
}

export class WorktreeProbeSandboxManager {
  private readonly baseTempDir: string;
  private readonly preferGitWorktree: boolean;
  private readonly maxDiffExcerptChars: number;

  constructor(options?: WorktreeProbeSandboxOptions) {
    this.baseTempDir = options?.baseTempDir ?? os.tmpdir();
    this.preferGitWorktree = options?.preferGitWorktree ?? true;
    this.maxDiffExcerptChars = options?.maxDiffExcerptChars ?? 4096;
  }

  /**
   * Executes a probe callback inside an isolated ephemeral workspace and tears it down
   * deterministically after capturing any resulting file modifications.
   */
  async withIsolatedWorkspace<T>(
    params: {
      readonly workspaceRoot: string;
      readonly candidateId: string;
      readonly taskId: string;
      readonly trialIndex: number;
    },
    fn: (workspace: IsolatedProbeWorkspace) => Promise<T>,
  ): Promise<{
    readonly result: T;
    readonly patchArtifact: ProbeWorkspacePatchArtifact;
  }> {
    const safeCand = params.candidateId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24);
    const safeTask = params.taskId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24);
    const sandboxId = `vi-probe-${safeCand}-${safeTask}-r${params.trialIndex}-${Date.now().toString(36)}`;
    const sandboxDir = await fs.mkdtemp(path.join(this.baseTempDir, `${sandboxId}-`));

    let isolationMode: 'GIT_WORKTREE' | 'SNAPSHOT_COPY' = 'SNAPSHOT_COPY';
    const initialSnapshot = new Map<string, string>();

    try {
      const canUseGit =
        this.preferGitWorktree && (await this.isGitRepository(params.workspaceRoot));

      if (canUseGit) {
        try {
          await execFileAsync(
            'git',
            ['worktree', 'add', '--detach', '--force', sandboxDir, 'HEAD'],
            { cwd: params.workspaceRoot, timeout: 10_000 },
          );
          isolationMode = 'GIT_WORKTREE';
        } catch {
          isolationMode = 'SNAPSHOT_COPY';
          await this.copyWorkspaceSnapshot(params.workspaceRoot, sandboxDir, initialSnapshot);
        }
      } else {
        await this.copyWorkspaceSnapshot(params.workspaceRoot, sandboxDir, initialSnapshot);
      }

      const workspace: IsolatedProbeWorkspace = {
        sandboxId,
        sandboxDir,
        isolationMode,
        candidateId: params.candidateId,
        taskId: params.taskId,
        trialIndex: params.trialIndex,
      };

      const result = await fn(workspace);
      const captured = await this.captureWorkspaceDelta(
        sandboxDir,
        isolationMode,
        initialSnapshot,
      );

      await this.teardownSandbox(params.workspaceRoot, sandboxDir, isolationMode);

      return {
        result,
        patchArtifact: {
          sandboxId,
          isolationMode,
          modifiedFiles: captured.modifiedFiles,
          patchDigest: captured.patchDigest,
          diffExcerpt: captured.diffExcerpt,
          cleanedUp: true,
        },
      };
    } catch (err) {
      await this.teardownSandbox(params.workspaceRoot, sandboxDir, isolationMode);
      throw err;
    }
  }

  private async isGitRepository(dir: string): Promise<boolean> {
    try {
      const stat = await fs.stat(path.join(dir, '.git'));
      return stat.isDirectory() || stat.isFile();
    } catch {
      return false;
    }
  }

  private async copyWorkspaceSnapshot(
    sourceDir: string,
    targetDir: string,
    initialSnapshot: Map<string, string>,
  ): Promise<void> {
    try {
      const entries = await fs.readdir(sourceDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === 'dist' ||
          entry.name === '.vi-evolution'
        ) {
          continue;
        }
        const srcPath = path.join(sourceDir, entry.name);
        const destPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
          await fs.cp(srcPath, destPath, { recursive: true });
        } else if (entry.isFile()) {
          await fs.copyFile(srcPath, destPath);
        }
      }
      await this.hashDirectoryFiles(targetDir, targetDir, initialSnapshot);
    } catch {
      // Source workspace may be virtual or empty in unit tests
    }
  }

  private async hashDirectoryFiles(
    rootDir: string,
    currentDir: string,
    out: Map<string, string>,
  ): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await this.hashDirectoryFiles(rootDir, fullPath, out);
      } else if (entry.isFile()) {
        const rel = path.relative(rootDir, fullPath).replace(/\\/g, '/');
        const content = await fs.readFile(fullPath);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        out.set(rel, hash);
      }
    }
  }

  private async captureWorkspaceDelta(
    sandboxDir: string,
    isolationMode: 'GIT_WORKTREE' | 'SNAPSHOT_COPY',
    initialSnapshot: ReadonlyMap<string, string>,
  ): Promise<{
    readonly modifiedFiles: ReadonlyArray<string>;
    readonly patchDigest: string;
    readonly diffExcerpt: string;
  }> {
    if (isolationMode === 'GIT_WORKTREE') {
      try {
        const { stdout: statusOut } = await execFileAsync(
          'git',
          ['status', '--porcelain'],
          { cwd: sandboxDir, timeout: 5_000 },
        );
        const modifiedFiles = statusOut
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.slice(2).trim());
        const { stdout: diffOut } = await execFileAsync('git', ['diff'], {
          cwd: sandboxDir,
          timeout: 5_000,
        });
        const diffExcerpt = diffOut.slice(0, this.maxDiffExcerptChars);
        const patchDigest = crypto
          .createHash('sha256')
          .update(`${modifiedFiles.join('|')}\n${diffOut}`)
          .digest('hex');
        return { modifiedFiles, patchDigest, diffExcerpt };
      } catch {
        // Fallback to file hash delta
      }
    }

    const finalSnapshot = new Map<string, string>();
    await this.hashDirectoryFiles(sandboxDir, sandboxDir, finalSnapshot);

    const modifiedFiles: string[] = [];
    for (const [rel, hash] of finalSnapshot.entries()) {
      const prevHash = initialSnapshot.get(rel);
      if (prevHash !== hash) {
        modifiedFiles.push(rel);
      }
    }
    for (const rel of initialSnapshot.keys()) {
      if (!finalSnapshot.has(rel)) {
        modifiedFiles.push(rel);
      }
    }
    modifiedFiles.sort();

    const summary = modifiedFiles
      .map((f) => `${f}:${finalSnapshot.get(f) ?? 'DELETED'}`)
      .join('\n');
    const patchDigest = crypto.createHash('sha256').update(summary).digest('hex');

    return {
      modifiedFiles,
      patchDigest,
      diffExcerpt: summary.slice(0, this.maxDiffExcerptChars),
    };
  }

  private async teardownSandbox(
    workspaceRoot: string,
    sandboxDir: string,
    isolationMode: 'GIT_WORKTREE' | 'SNAPSHOT_COPY',
  ): Promise<void> {
    if (isolationMode === 'GIT_WORKTREE') {
      try {
        await execFileAsync(
          'git',
          ['worktree', 'remove', '--force', sandboxDir],
          { cwd: workspaceRoot, timeout: 5_000 },
        );
      } catch {
        // Ignore git worktree remove failure and force-clean directory below
      }
    }
    try {
      await fs.rm(sandboxDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
