/**
 * Worktree Docker Bridge.
 *
 * Provides dynamic volume mount bridging for Docker containers executing
 * inside Git worktrees (e.g. speculative multi-rollout execution under --rollouts + --sandbox docker).
 *
 * Problem Solved:
 * Git worktrees do not contain a full `.git/` directory; instead, `<worktree>/.git`
 * is a text pointer file (`gitdir: <host_path>`).
 * When mounted directly into a Linux Docker container:
 * 1. Host paths (especially on Windows `C:\...`) are invalid in Linux containers.
 * 2. The parent repository `.git` directory is not mounted by default, causing git
 *    operations inside the container to fail with "fatal: not a git repository".
 *
 * This bridge detects worktree workspaces, creates a container-compatible `.git`
 * bridge file, and generates secondary Docker volume mounts for the parent `.git`
 * metadata directory, allowing git commands to operate seamlessly within the container.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface WorktreeMountConfig {
  readonly isWorktree: boolean;
  readonly primaryMount: { hostPath: string; containerPath: string };
  readonly additionalMounts: ReadonlyArray<{
    hostPath: string;
    containerPath: string;
    readonly?: boolean;
  }>;
  readonly extraDockerArgs: ReadonlyArray<string>;
  readonly cleanup?: () => void;
}

export interface WorktreeDockerBridgeOptions {
  readonly dockerWorkdir?: string;
  readonly baseWorkspacePath?: string;
}

export class WorktreeDockerBridge {
  /**
   * Inspects a workspace path and prepares container volume mounts and bridge files.
   */
  static prepareMounts(
    workspacePath: string,
    options?: WorktreeDockerBridgeOptions,
  ): WorktreeMountConfig {
    const resolvedWs = path.resolve(workspacePath);
    const dockerWorkdir = options?.dockerWorkdir ?? '/workspace';
    const primaryMount = {
      hostPath: resolvedWs.replace(/\\/g, '/'),
      containerPath: dockerWorkdir,
    };

    const gitFilePath = path.join(resolvedWs, '.git');

    // Check if .git exists and is a worktree pointer file (not a directory)
    if (!fs.existsSync(gitFilePath)) {
      return {
        isWorktree: false,
        primaryMount,
        additionalMounts: [],
        extraDockerArgs: [],
      };
    }

    let isFile = false;
    try {
      isFile = fs.statSync(gitFilePath).isFile();
    } catch {
      isFile = false;
    }

    if (!isFile) {
      // Standard git repository with full .git directory
      return {
        isWorktree: false,
        primaryMount,
        additionalMounts: [],
        extraDockerArgs: [],
      };
    }

    // Read gitdir pointer
    let gitFileContent = '';
    try {
      gitFileContent = fs.readFileSync(gitFilePath, 'utf-8').trim();
    } catch {
      return {
        isWorktree: false,
        primaryMount,
        additionalMounts: [],
        extraDockerArgs: [],
      };
    }

    const match = gitFileContent.match(/^gitdir:\s*(.+)$/i);
    if (!match || !match[1]) {
      return {
        isWorktree: false,
        primaryMount,
        additionalMounts: [],
        extraDockerArgs: [],
      };
    }

    const hostGitDir = match[1].trim();
    const worktreeName = path.basename(hostGitDir);

    // Locate the base repository's .git directory
    let baseGitDir: string | null = null;
    const candidateBase = path.resolve(hostGitDir, '../..');
    if (fs.existsSync(candidateBase) && fs.existsSync(path.join(candidateBase, 'HEAD'))) {
      baseGitDir = candidateBase;
    } else if (options?.baseWorkspacePath) {
      const explicitBase = path.join(path.resolve(options.baseWorkspacePath), '.git');
      if (fs.existsSync(explicitBase)) {
        baseGitDir = explicitBase;
      }
    }

    if (!baseGitDir) {
      // Could not locate parent gitdir, fallback to unbridged mount
      return {
        isWorktree: true,
        primaryMount,
        additionalMounts: [],
        extraDockerArgs: [],
      };
    }

    // Create an ephemeral container-compatible .git pointer file
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ephemeralGitFile = path.join(os.tmpdir(), `vih-bridge-git-${uniqueId}`);
    const containerGitDirRef = `/.vih-parent-git/worktrees/${worktreeName}`;

    fs.writeFileSync(ephemeralGitFile, `gitdir: ${containerGitDirRef}\n`, 'utf-8');

    const normalizedBaseGitDir = baseGitDir.replace(/\\/g, '/');
    const normalizedEphemeralGitFile = ephemeralGitFile.replace(/\\/g, '/');

    const additionalMounts = [
      {
        hostPath: normalizedBaseGitDir,
        containerPath: '/.vih-parent-git',
        readonly: false,
      },
      {
        hostPath: normalizedEphemeralGitFile,
        containerPath: `${dockerWorkdir}/.git`,
        readonly: true,
      },
    ];

    const extraDockerArgs = [
      `-v "${normalizedBaseGitDir}:/.vih-parent-git"`,
      `-v "${normalizedEphemeralGitFile}:${dockerWorkdir}/.git"`,
    ];

    const cleanup = () => {
      try {
        if (fs.existsSync(ephemeralGitFile)) {
          fs.unlinkSync(ephemeralGitFile);
        }
      } catch {
        // ignore cleanup errors
      }
    };

    return {
      isWorktree: true,
      primaryMount,
      additionalMounts,
      extraDockerArgs,
      cleanup,
    };
  }
}
