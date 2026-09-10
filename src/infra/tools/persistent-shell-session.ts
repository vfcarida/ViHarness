/**
 * Persistent Interactive Shell Session.
 *
 * Maintains a persistent shell process (bash / sh on Unix, cmd.exe on Windows)
 * across multiple `run_command` invocations.
 *
 * Benefits:
 * - Retains working directory changes (`cd subdir`).
 * - Preserves environment variable exports (`export KEY=val` / `set KEY=val`).
 * - Retains virtual environment activations (`source venv/bin/activate`).
 * - Avoids per-command shell startup latency.
 * - Automatic crash recovery and timeout termination.
 */
import * as child_process from 'node:child_process';
import * as crypto from 'node:crypto';

export interface ShellExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface PersistentShellSessionOptions {
  readonly shellExecutable?: string;
  readonly defaultTimeoutMs?: number;
}

export class PersistentShellSession {
  private child?: child_process.ChildProcess;
  private isWindows: boolean;
  private shellExecutable: string;
  private defaultTimeoutMs: number;
  private isExecuting: boolean = false;

  constructor(
    private readonly workspacePath: string,
    options: PersistentShellSessionOptions = {},
  ) {
    this.isWindows = process.platform === 'win32';
    this.shellExecutable =
      options.shellExecutable ??
      (this.isWindows
        ? (process.env['COMSPEC'] ?? 'cmd.exe')
        : (process.env['SHELL'] ?? '/bin/bash'));
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 60000;
  }

  /**
   * Initializes or gets the active child process.
   */
  private ensureProcess(): child_process.ChildProcess {
    if (this.child && !this.child.killed && this.child.exitCode === null) {
      return this.child;
    }

    const args = this.isWindows ? [] : ['-s'];
    const proc = child_process.spawn(this.shellExecutable, args, {
      cwd: this.workspacePath,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.on('error', () => {
      this.child = undefined;
    });

    proc.on('exit', () => {
      this.child = undefined;
    });

    this.child = proc;
    return proc;
  }

  /**
   * Executes a command inside the persistent shell session.
   */
  async execute(command: string, timeoutMs: number = this.defaultTimeoutMs): Promise<ShellExecutionResult> {
    if (this.isExecuting) {
      throw new Error('A command is already currently executing in this persistent shell session.');
    }

    const proc = this.ensureProcess();
    this.isExecuting = true;

    const id = crypto.randomBytes(4).toString('hex');
    const sentinel = `__VI_HARNESS_CMD_EOF_${id}__`;
    const statusPrefix = `__VI_HARNESS_STATUS_${id}:`;

    return new Promise<ShellExecutionResult>((resolve) => {
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let timer: NodeJS.Timeout | null = null;

      const cleanup = (): void => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        this.isExecuting = false;
        proc.stdout?.off('data', onStdout);
        proc.stderr?.off('data', onStderr);
      };

      const finish = (exitCode: number): void => {
        cleanup();

        // Extract and strip sentinel + status lines
        let cleanStdout = stdoutBuffer;
        const statusRegex = new RegExp(`${statusPrefix}(\\d+)`, 'g');
        const match = statusRegex.exec(cleanStdout);
        const resolvedExitCode = match && match[1] ? parseInt(match[1], 10) : exitCode;

        cleanStdout = cleanStdout
          .replace(new RegExp(`${statusPrefix}\\d+`, 'g'), '')
          .replace(new RegExp(sentinel, 'g'), '')
          .trim();

        const cleanStderr = stderrBuffer.trim();

        resolve({
          stdout: cleanStdout,
          stderr: cleanStderr,
          exitCode: resolvedExitCode,
        });
      };

      const onStdout = (chunk: Buffer): void => {
        stdoutBuffer += chunk.toString('utf-8');
        if (stdoutBuffer.includes(sentinel)) {
          finish(0);
        }
      };

      const onStderr = (chunk: Buffer): void => {
        stderrBuffer += chunk.toString('utf-8');
      };

      proc.stdout?.on('data', onStdout);
      proc.stderr?.on('data', onStderr);

      timer = setTimeout(() => {
        cleanup();
        this.terminate();
        resolve({
          stdout: stdoutBuffer.replace(new RegExp(sentinel, 'g'), '').trim(),
          stderr: `${stderrBuffer}\n[Persistent shell command timed out after ${timeoutMs}ms]`.trim(),
          exitCode: 124,
        });
      }, timeoutMs);

      // Write command with sentinel injection
      try {
        if (this.isWindows) {
          proc.stdin?.write(
            `${command}\r\necho ${statusPrefix}%ERRORLEVEL%\r\necho ${sentinel}\r\n`,
          );
        } else {
          proc.stdin?.write(
            `${command}\necho "${statusPrefix}$?"\necho "${sentinel}"\n`,
          );
        }
      } catch (err: unknown) {
        cleanup();
        const errMsg = err instanceof Error ? err.message : String(err);
        resolve({
          stdout: '',
          stderr: `Failed to write to persistent shell: ${errMsg}`,
          exitCode: 1,
        });
      }
    });
  }

  /**
   * Gracefully closes or terminates the shell session.
   */
  terminate(): void {
    if (this.child) {
      try {
        if (!this.child.killed) {
          this.child.kill('SIGKILL');
        }
      } catch {
        // Ignore kill error
      }
      this.child = undefined;
    }
    this.isExecuting = false;
  }
}
