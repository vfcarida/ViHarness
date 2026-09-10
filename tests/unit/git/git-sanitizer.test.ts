/**
 * Git Sanitizer & Hygiene Unit Tests.
 *
 * Verifies that RealGitManager automatically sanitizes .gitignore against
 * build artifacts (CMakeFiles, CMakeCache.txt, binaries) and keeps patch exports clean.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as child_process from 'node:child_process';
import { RealGitManager } from '../../../src/infra/git/real-git-manager.js';

describe('RealGitManager Sanitizer & Hygiene', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-git-sanitizer-'));
    child_process.execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    child_process.execSync('git config user.name "Vi Test"', { cwd: tmpDir, stdio: 'ignore' });
    child_process.execSync('git config user.email "test@example.com"', { cwd: tmpDir, stdio: 'ignore' });

    // Initial commit
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Initial Project\n');
    child_process.execSync('git add README.md', { cwd: tmpDir, stdio: 'ignore' });
    child_process.execSync('git commit -m "initial commit"', { cwd: tmpDir, stdio: 'ignore' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .gitignore with default build patterns if missing', async () => {
    const gitManager = new RealGitManager({ workingDir: tmpDir });
    const added = await gitManager.ensureSanitizedGitignore();

    expect(added.length).toBeGreaterThan(0);
    expect(added).toContain('CMakeFiles/');
    expect(added).toContain('CMakeCache.txt');
    expect(added).toContain('/code');

    const gitignoreContent = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    expect(gitignoreContent).toContain('CMakeFiles/');
    expect(gitignoreContent).toContain('CMakeCache.txt');
  });

  it('is idempotent and does not duplicate existing patterns in .gitignore', async () => {
    const gitignorePath = path.join(tmpDir, '.gitignore');
    fs.writeFileSync(gitignorePath, 'CMakeFiles/\nCMakeCache.txt\n*.log\n');

    const gitManager = new RealGitManager({ workingDir: tmpDir });
    const added = await gitManager.ensureSanitizedGitignore();

    expect(added).not.toContain('CMakeFiles/');
    expect(added).not.toContain('CMakeCache.txt');
    expect(added).toContain('/code');

    // Run again, should add 0 new patterns
    const addedSecond = await gitManager.ensureSanitizedGitignore();
    expect(addedSecond.length).toBe(0);
  });

  it('excludes build artifacts from git diff patch generation', async () => {
    const gitManager = new RealGitManager({ workingDir: tmpDir });

    // Agent adds a legitimate source file and a build artifact
    fs.writeFileSync(path.join(tmpDir, 'main.c'), '#include <stdio.h>\nint main() { return 0; }\n');
    fs.mkdirSync(path.join(tmpDir, 'CMakeFiles'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'CMakeFiles', 'internal.make'), '# auto-generated makefile\n');
    fs.writeFileSync(path.join(tmpDir, 'CMakeCache.txt'), '# auto-generated cache with absolute paths\n');

    const diff = await gitManager.getDiff();

    // Source file must be in diff
    expect(diff).toContain('diff --git a/main.c b/main.c');
    expect(diff).toContain('int main()');

    // Build artifact files must NOT be in diff as modified files
    expect(diff).not.toContain('diff --git a/CMakeFiles');
    expect(diff).not.toContain('diff --git a/CMakeCache.txt');
  });
});
