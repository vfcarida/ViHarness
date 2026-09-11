import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { WorktreeDockerBridge } from '../../../src/infra/git/worktree-docker-bridge.js';
import { createWorkspaceTools } from '../../../src/infra/tools/workspace-tools.js';

describe('WorktreeDockerBridge', () => {
  let tmpDir: string;
  let baseRepoDir: string;
  let worktreeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vih-wt-docker-'));
    baseRepoDir = path.join(tmpDir, 'base-repo');
    worktreeDir = path.join(tmpDir, 'rollout-1');

    fs.mkdirSync(baseRepoDir, { recursive: true });
    fs.mkdirSync(worktreeDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('detects a non-worktree workspace and produces standard primary mount', () => {
    const config = WorktreeDockerBridge.prepareMounts(worktreeDir);

    expect(config.isWorktree).toBe(false);
    expect(config.primaryMount.containerPath).toBe('/workspace');
    expect(config.additionalMounts).toHaveLength(0);
    expect(config.extraDockerArgs).toHaveLength(0);
  });

  it('detects a standard git repo where .git is a directory', () => {
    fs.mkdirSync(path.join(worktreeDir, '.git'), { recursive: true });

    const config = WorktreeDockerBridge.prepareMounts(worktreeDir);
    expect(config.isWorktree).toBe(false);
    expect(config.additionalMounts).toHaveLength(0);
  });

  it('bridges a git worktree pointer file to container-compatible mounts', () => {
    // Setup simulated git worktree structure
    const baseGitDir = path.join(baseRepoDir, '.git');
    const worktreeMetaDir = path.join(baseGitDir, 'worktrees', 'rollout-1');
    fs.mkdirSync(worktreeMetaDir, { recursive: true });
    fs.writeFileSync(path.join(baseGitDir, 'HEAD'), 'ref: refs/heads/main\n');

    // Create .git pointer file in worktree
    fs.writeFileSync(
      path.join(worktreeDir, '.git'),
      `gitdir: ${worktreeMetaDir}\n`,
      'utf-8',
    );

    const config = WorktreeDockerBridge.prepareMounts(worktreeDir);

    expect(config.isWorktree).toBe(true);
    expect(config.primaryMount.containerPath).toBe('/workspace');
    expect(config.additionalMounts.length).toBe(2);

    // Mount 1: Parent .git mapped to /.vih-parent-git
    const parentMount = config.additionalMounts.find(
      (m) => m.containerPath === '/.vih-parent-git',
    );
    expect(parentMount).toBeDefined();
    expect(parentMount?.readonly).toBe(false);

    // Mount 2: Ephemeral container .git file mapped to /workspace/.git
    const gitFileMount = config.additionalMounts.find(
      (m) => m.containerPath === '/workspace/.git',
    );
    expect(gitFileMount).toBeDefined();
    expect(gitFileMount?.readonly).toBe(true);

    // Verify ephemeral file content uses Linux container paths
    const ephemeralContent = fs.readFileSync(gitFileMount!.hostPath, 'utf-8');
    expect(ephemeralContent).toBe('gitdir: /.vih-parent-git/worktrees/rollout-1\n');

    // Verify extraDockerArgs contains volume flags
    expect(config.extraDockerArgs.some((arg) => arg.includes('/.vih-parent-git'))).toBe(true);
    expect(config.extraDockerArgs.some((arg) => arg.includes('/workspace/.git'))).toBe(true);

    // Test cleanup
    expect(fs.existsSync(gitFileMount!.hostPath)).toBe(true);
    config.cleanup?.();
    expect(fs.existsSync(gitFileMount!.hostPath)).toBe(false);
  });

  it('respects custom dockerWorkdir option', () => {
    const baseGitDir = path.join(baseRepoDir, '.git');
    const worktreeMetaDir = path.join(baseGitDir, 'worktrees', 'rollout-custom');
    fs.mkdirSync(worktreeMetaDir, { recursive: true });
    fs.writeFileSync(path.join(baseGitDir, 'HEAD'), 'ref: refs/heads/main\n');

    fs.writeFileSync(
      path.join(worktreeDir, '.git'),
      `gitdir: ${worktreeMetaDir}\n`,
      'utf-8',
    );

    const config = WorktreeDockerBridge.prepareMounts(worktreeDir, {
      dockerWorkdir: '/custom/workdir',
    });

    expect(config.primaryMount.containerPath).toBe('/custom/workdir');
    const gitFileMount = config.additionalMounts.find(
      (m) => m.containerPath === '/custom/workdir/.git',
    );
    expect(gitFileMount).toBeDefined();

    config.cleanup?.();
  });

  it('falls back gracefully when baseWorkspacePath is explicitly provided', () => {
    const baseGitDir = path.join(baseRepoDir, '.git');
    fs.mkdirSync(baseGitDir, { recursive: true });
    fs.writeFileSync(path.join(baseGitDir, 'HEAD'), 'ref: refs/heads/main\n');

    // Arbitrary external worktree meta dir not strictly under ../..
    const externalMetaDir = path.join(tmpDir, 'external-meta', 'rollout-x');
    fs.mkdirSync(externalMetaDir, { recursive: true });

    fs.writeFileSync(
      path.join(worktreeDir, '.git'),
      `gitdir: ${externalMetaDir}\n`,
      'utf-8',
    );

    const config = WorktreeDockerBridge.prepareMounts(worktreeDir, {
      baseWorkspacePath: baseRepoDir,
    });

    expect(config.isWorktree).toBe(true);
    expect(config.additionalMounts.length).toBe(2);

    config.cleanup?.();
  });

  it('integrates seamlessly with createWorkspaceTools when sandbox is docker', async () => {
    let capturedCmd = '';
    const tools = createWorkspaceTools(worktreeDir, {
      sandbox: 'docker',
      dockerImage: 'python:3.11-slim',
      dockerRunner: async (cmd: string) => {
        capturedCmd = cmd;
        return { stdout: 'pytest passed', stderr: '', exitCode: 0 };
      },
      additionalMounts: [
        { hostPath: '/host/extra', containerPath: '/container/extra', readonly: true },
      ],
    });

    const runCommandTool = tools.find((t) => t.definition.name === 'run_command');
    expect(runCommandTool).toBeDefined();

    const result = await runCommandTool!.execute(
      { command: 'pytest' },
      { correlationId: 'test-call' } as any,
    );

    expect(result.success).toBe(true);
    expect(capturedCmd).toBe('pytest');
    expect(result.metadata?.sandbox).toBe('docker');
    expect(result.metadata?.dockerImage).toBe('python:3.11-slim');
  });
});
