import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PersistentShellSession } from '../../../src/infra/tools/persistent-shell-session.js';
import { WorkspaceRunCommandTool } from '../../../src/infra/tools/workspace-tools.js';

describe('PersistentShellSession Suite', () => {
  let tempDir: string;
  let session: PersistentShellSession | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vih-shell-test-'));
  });

  afterEach(() => {
    if (session) {
      session.terminate();
      session = undefined;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('executes basic echo command and returns exit code 0', async () => {
    session = new PersistentShellSession(tempDir);
    const res = await session.execute('echo hello_persistent_shell');
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('hello_persistent_shell');
  });

  it('maintains working directory changes across sequential commands', async () => {
    const subDirName = 'nested_dir';
    const subDirPath = path.join(tempDir, subDirName);
    fs.mkdirSync(subDirPath);

    session = new PersistentShellSession(tempDir);

    // Command 1: change directory into subDir
    const cdCmd = process.platform === 'win32' ? `cd /d "${subDirPath}"` : `cd "${subDirPath}"`;
    const res1 = await session.execute(cdCmd);
    expect(res1.exitCode).toBe(0);

    // Command 2: verify current directory in same session
    const pwdCmd = process.platform === 'win32' ? 'cd' : 'pwd';
    const res2 = await session.execute(pwdCmd);
    expect(res2.exitCode).toBe(0);

    // Path check (case-insensitive on Windows)
    const normalizedOut = res2.stdout.toLowerCase().replace(/\\/g, '/');
    const normalizedExpected = subDirPath.toLowerCase().replace(/\\/g, '/');
    expect(normalizedOut).toContain(normalizedExpected);
  });

  it('maintains environment variables across sequential commands', async () => {
    session = new PersistentShellSession(tempDir);

    // Command 1: set variable
    const setCmd = process.platform === 'win32' ? 'set VI_TEST_VAR=persistent_value' : 'export VI_TEST_VAR=persistent_value';
    const res1 = await session.execute(setCmd);
    expect(res1.exitCode).toBe(0);

    // Command 2: read variable
    const getCmd = process.platform === 'win32' ? 'echo %VI_TEST_VAR%' : 'echo $VI_TEST_VAR';
    const res2 = await session.execute(getCmd);
    expect(res2.exitCode).toBe(0);
    expect(res2.stdout).toContain('persistent_value');
  });

  it('detects non-zero exit code on command failure', async () => {
    session = new PersistentShellSession(tempDir);
    const failCmd = process.platform === 'win32' ? 'dir nonexistent_file_that_does_not_exist_12345' : 'ls nonexistent_file_that_does_not_exist_12345';
    const res = await session.execute(failCmd);
    expect(res.exitCode).not.toBe(0);
  });

  it('times out long-running commands gracefully without crashing the session manager', async () => {
    session = new PersistentShellSession(tempDir);
    // Timeout of 200ms with a command that takes longer
    const sleepCmd = process.platform === 'win32' ? 'ping -n 3 127.0.0.1 > nul' : 'sleep 2';
    const res = await session.execute(sleepCmd, 200);

    expect(res.exitCode).toBe(124);
    expect(res.stderr).toContain('timed out');
  });

  it('integrates seamlessly with WorkspaceRunCommandTool when persistentShell is enabled', async () => {
    const runner = new WorkspaceRunCommandTool(tempDir, {
      persistentShell: true,
      commandTimeoutMs: 5000,
    });

    try {
      const setCmd = process.platform === 'win32' ? 'set MY_HARNESS_KEY=active_123' : 'export MY_HARNESS_KEY=active_123';
      const res1 = await runner.execute(
        { command: setCmd },
        { correlationId: 'cmd1', workingDirectory: tempDir } as any,
      );
      expect(res1.success).toBe(true);
      expect(res1.metadata?.persistentShell).toBe(true);

      const getCmd = process.platform === 'win32' ? 'echo %MY_HARNESS_KEY%' : 'echo $MY_HARNESS_KEY';
      const res2 = await runner.execute(
        { command: getCmd },
        { correlationId: 'cmd2', workingDirectory: tempDir } as any,
      );
      expect(res2.success).toBe(true);
      expect(res2.output).toContain('active_123');
      expect(res2.metadata?.persistentShell).toBe(true);
    } finally {
      runner.dispose();
    }
  });
});
