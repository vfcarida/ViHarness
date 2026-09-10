import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createWorkspaceTools,
  WorkspaceReadFileTool,
  WorkspaceWriteFileTool,
  WorkspaceEditFileTool,
  WorkspaceRevertFileTool,
  WorkspaceListDirectoryTool,
  WorkspaceRunCommandTool,
} from '../../../src/infra/tools/workspace-tools.js';

describe('Workspace Tools Suite', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vih-ws-tools-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore directory cleanup error on teardown
    }
  });

  it('createWorkspaceTools factory creates 6 standard workspace tools', () => {
    const tools = createWorkspaceTools(tempDir);
    expect(tools.length).toBe(6);
    const names = tools.map((t) => t.definition.name);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('edit_file');
    expect(names).toContain('revert_file');
    expect(names).toContain('list_directory');
    expect(names).toContain('run_command');
  });

  it('WorkspaceWriteFileTool writes content and creates parent directories', async () => {
    const writer = new WorkspaceWriteFileTool(tempDir);
    const result = await writer.execute(
      { path: 'src/components/button.tsx', content: 'export const Button = () => null;' },
      { correlationId: 'c1', workingDirectory: tempDir } as any,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('Successfully wrote');
    const diskContent = fs.readFileSync(path.join(tempDir, 'src/components/button.tsx'), 'utf-8');
    expect(diskContent).toBe('export const Button = () => null;');
  });

  it('WorkspaceReadFileTool reads real file and returns error on missing file', async () => {
    const reader = new WorkspaceReadFileTool(tempDir);
    fs.writeFileSync(path.join(tempDir, 'sample.txt'), 'Hello Vi-Harness', 'utf-8');

    const result = await reader.execute(
      { path: 'sample.txt' },
      { correlationId: 'c2', workingDirectory: tempDir } as any,
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('Hello Vi-Harness');

    const missingResult = await reader.execute(
      { path: 'nonexistent.txt' },
      { correlationId: 'c3', workingDirectory: tempDir } as any,
    );
    expect(missingResult.success).toBe(false);
    expect(missingResult.output).toContain('File not found');
  });

  it('WorkspaceReadFileTool and WorkspaceWriteFileTool reject path traversal outside workspace', async () => {
    const reader = new WorkspaceReadFileTool(tempDir);
    const result = await reader.execute(
      { path: '../../../../etc/passwd' },
      { correlationId: 'c4', workingDirectory: tempDir } as any,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Path traversal violation');
  });

  it('WorkspaceListDirectoryTool lists entries with directory slashes', async () => {
    fs.mkdirSync(path.join(tempDir, 'docs'));
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test', 'utf-8');

    const lister = new WorkspaceListDirectoryTool(tempDir);
    const result = await lister.execute({}, { correlationId: 'c5', workingDirectory: tempDir } as any);

    expect(result.success).toBe(true);
    expect(result.output).toContain('docs/');
    expect(result.output).toContain('README.md');
  });

  it('WorkspaceRunCommandTool executes shell commands and captures stdout/exit code', async () => {
    const runner = new WorkspaceRunCommandTool(tempDir, { commandTimeoutMs: 5000 });
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'cmd.exe /c echo HelloFromShell' : 'echo HelloFromShell';

    const result = await runner.execute({ command: cmd }, { correlationId: 'c6', workingDirectory: tempDir } as any);
    expect(result.success).toBe(true);
    expect(result.output).toContain('HelloFromShell');
    expect(result.metadata?.exitCode).toBe(0);
  });

  it('WorkspaceRunCommandTool blocks catastrophic deletion commands', async () => {
    const runner = new WorkspaceRunCommandTool(tempDir);
    const result = await runner.execute(
      { command: 'rm -rf /' },
      { correlationId: 'c7', workingDirectory: tempDir } as any,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('FORBIDDEN_CATASTROPHIC_COMMAND');
  });

  it('WorkspaceEditFileTool performs single exact replacement', async () => {
    const editor = new WorkspaceEditFileTool(tempDir);
    const filePath = path.join(tempDir, 'main.c');
    fs.writeFileSync(
      filePath,
      'int allocate(int size) {\n    return malloc(size);\n}\n',
      'utf-8',
    );

    const result = await editor.execute(
      {
        path: 'main.c',
        old_string: 'int allocate(int size)',
        new_string: 'void *allocate(size_t size)',
      },
      { correlationId: 'c-edit1', workingDirectory: tempDir } as any,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('Successfully replaced 1 occurrence');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('void *allocate(size_t size)');
    expect(content).not.toContain('int allocate(int size)');
  });

  it('WorkspaceEditFileTool replaces multi-line block', async () => {
    const editor = new WorkspaceEditFileTool(tempDir);
    const filePath = path.join(tempDir, 'algo.py');
    fs.writeFileSync(
      filePath,
      'def compute():\n    x = 10\n    y = 20\n    return x + y\n',
      'utf-8',
    );

    const result = await editor.execute(
      {
        path: 'algo.py',
        old_string: '    x = 10\n    y = 20\n    return x + y',
        new_string: '    val = 30\n    return val',
      },
      { correlationId: 'c-edit2', workingDirectory: tempDir } as any,
    );

    expect(result.success).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toBe('def compute():\n    val = 30\n    return val\n');
  });

  it('WorkspaceEditFileTool fails if old_string is ambiguous and replace_all is false', async () => {
    const editor = new WorkspaceEditFileTool(tempDir);
    const filePath = path.join(tempDir, 'repeated.txt');
    fs.writeFileSync(filePath, 'foo\nbar\nfoo\n', 'utf-8');

    const result = await editor.execute(
      {
        path: 'repeated.txt',
        old_string: 'foo',
        new_string: 'baz',
        replace_all: false,
      },
      { correlationId: 'c-edit3', workingDirectory: tempDir } as any,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('Found 2 occurrences');
    expect(result.error).toContain('Ambiguous match');
    // Ensure file was not modified
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('foo\nbar\nfoo\n');
  });

  it('WorkspaceEditFileTool replaces all occurrences when replace_all is true', async () => {
    const editor = new WorkspaceEditFileTool(tempDir);
    const filePath = path.join(tempDir, 'repeated.txt');
    fs.writeFileSync(filePath, 'foo\nbar\nfoo\n', 'utf-8');

    const result = await editor.execute(
      {
        path: 'repeated.txt',
        old_string: 'foo',
        new_string: 'baz',
        replace_all: true,
      },
      { correlationId: 'c-edit4', workingDirectory: tempDir } as any,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('Successfully replaced 2 occurrence(s)');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('baz\nbar\nbaz\n');
  });

  it('WorkspaceEditFileTool returns error when old_string does not match', async () => {
    const editor = new WorkspaceEditFileTool(tempDir);
    const filePath = path.join(tempDir, 'file.txt');
    fs.writeFileSync(filePath, 'hello world', 'utf-8');

    const result = await editor.execute(
      {
        path: 'file.txt',
        old_string: 'missing line',
        new_string: 'new line',
      },
      { correlationId: 'c-edit5', workingDirectory: tempDir } as any,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('Target text \'old_string\' not found');
  });

  it('WorkspaceEditFileTool rejects path traversal outside workspace', async () => {
    const editor = new WorkspaceEditFileTool(tempDir);
    const result = await editor.execute(
      {
        path: '../../etc/passwd',
        old_string: 'root',
        new_string: 'admin',
      },
      { correlationId: 'c-edit6', workingDirectory: tempDir } as any,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Path traversal violation');
  });

  it('WorkspaceRunCommandTool detects compiler warnings and appends warning notice', async () => {
    const runner = new WorkspaceRunCommandTool(tempDir, { commandTimeoutMs: 5000 });
    const isWindows = process.platform === 'win32';
    // Echo a compiler warning style message
    const cmd = isWindows
      ? 'cmd.exe /c echo main.c:12: warning: assignment to int from pointer'
      : 'echo "main.c:12: warning: assignment to int from pointer"';

    const result = await runner.execute(
      { command: cmd },
      { correlationId: 'c-warn', workingDirectory: tempDir } as any,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('warning: assignment to int from pointer');
    expect(result.output).toContain('[Vi-Harness Compiler Warning Notice]');
    expect(result.metadata?.hasWarnings).toBe(true);
  });

  it('WorkspaceRevertFileTool fails gracefully when workspace is not a git repository', async () => {
    const reverter = new WorkspaceRevertFileTool(tempDir);
    const result = await reverter.execute(
      { path: 'somefile.txt' },
      { correlationId: 'c-rev-nogit', workingDirectory: tempDir } as any,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('NOT_A_GIT_REPOSITORY');
  });

  it('WorkspaceRevertFileTool reverts modified file in a git repository', async () => {
    // Initialize git repository in tempDir
    const cp = await import('node:child_process');
    cp.execSync('git init', { cwd: tempDir });
    cp.execSync('git config user.email "test@example.com"', { cwd: tempDir });
    cp.execSync('git config user.name "Test"', { cwd: tempDir });

    const filePath = path.join(tempDir, 'solution.c');
    fs.writeFileSync(filePath, 'int original = 42;\n', 'utf-8');
    cp.execSync('git add solution.c && git commit -m "initial"', { cwd: tempDir });

    // Corrupt the file
    fs.writeFileSync(filePath, 'int corrupted = 999;\n', 'utf-8');
    expect(fs.readFileSync(filePath, 'utf-8')).toContain('corrupted');

    // Revert using tool
    const reverter = new WorkspaceRevertFileTool(tempDir);
    const result = await reverter.execute(
      { path: 'solution.c' },
      { correlationId: 'c-rev-ok', workingDirectory: tempDir } as any,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('Successfully rolled back changes to solution.c');
    expect(fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n')).toBe('int original = 42;\n');
  });

  it('WorkspaceWriteFileTool and WorkspaceEditFileTool report syntax alerts for malformed files', async () => {
    const writer = new WorkspaceWriteFileTool(tempDir);

    // 1. JSON syntax error
    const jsonResult = await writer.execute(
      { path: 'config.json', content: '{ "unclosed": 123 ' },
      { correlationId: 'c-syn-json', workingDirectory: tempDir } as any,
    );
    expect(jsonResult.success).toBe(true);
    expect(jsonResult.output).toContain('[Vi-Harness Syntax Alert]: JSON syntax error');
    expect(jsonResult.metadata?.syntaxAlert).toBeDefined();

    // 2. Unbalanced curly braces in C/TS code
    const codeResult = await writer.execute(
      { path: 'main.c', content: 'void foo() {\n  return;\n' },
      { correlationId: 'c-syn-code', workingDirectory: tempDir } as any,
    );
    expect(codeResult.success).toBe(true);
    expect(codeResult.output).toContain('[Vi-Harness Syntax Alert]: Unbalanced curly braces');
    expect(codeResult.metadata?.syntaxAlert).toBeDefined();

    // 3. Balanced code produces no alert
    const goodResult = await writer.execute(
      { path: 'clean.c', content: 'void foo() {\n  return;\n}\n' },
      { correlationId: 'c-syn-good', workingDirectory: tempDir } as any,
    );
    expect(goodResult.success).toBe(true);
    expect(goodResult.output).not.toContain('[Vi-Harness Syntax Alert]');
    expect(goodResult.metadata?.syntaxAlert).toBeUndefined();
  });

  it('WorkspaceRunCommandTool executes inside Docker sandbox with runner and captures warnings', async () => {
    let capturedCmd = '';
    const mockRunner = async (cmd: string) => {
      capturedCmd = cmd;
      return {
        stdout: 'main.c:12:3: warning: unused variable ‘x’ [-Wunused-variable]\nBuild success',
        stderr: '',
        exitCode: 0,
      };
    };

    const runner = new WorkspaceRunCommandTool(tempDir, {
      sandbox: 'docker',
      dockerImage: 'gcc:13',
      dockerRunner: mockRunner,
    });

    const result = await runner.execute(
      { command: 'gcc -Wall -o main main.c' },
      { correlationId: 'docker-call', workingDirectory: tempDir } as any,
    );

    expect(result.success).toBe(true);
    expect(capturedCmd).toBe('gcc -Wall -o main main.c');
    expect(result.output).toContain('[Vi-Harness Compiler Warning Notice]');
    expect(result.metadata?.hasWarnings).toBe(true);
    expect(result.metadata?.sandbox).toBe('docker');
    expect(result.metadata?.dockerImage).toBe('gcc:13');
  });

  it('WorkspaceRunCommandTool handles container error exit codes correctly', async () => {
    const mockRunner = async (_cmd: string) => ({
      stdout: '',
      stderr: 'gcc: error: main.c: No such file or directory',
      exitCode: 1,
    });

    const runner = new WorkspaceRunCommandTool(tempDir, {
      sandbox: 'docker',
      dockerImage: 'gcc:13',
      dockerRunner: mockRunner,
    });

    const result = await runner.execute(
      { command: 'gcc main.c' },
      { correlationId: 'docker-fail', workingDirectory: tempDir } as any,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Command exited with code 1');
    expect(result.output).toContain('No such file or directory');
    expect(result.metadata?.sandbox).toBe('docker');
  });
});
