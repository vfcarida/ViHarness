import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseSolveArgs, runSolveCli, scanWorkspaceFiles } from '../../../src/cli/commands/solve.js';

describe('Vi-Harness Solve CLI Suite', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vih-solve-cli-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore directory cleanup error on teardown
    }
  });

  it('1. parseSolveArgs: Parses all options, flags, and environment defaults', () => {
    const args = [
      '-p',
      'Solve problem 001',
      '--cwd',
      tempDir,
      '-m',
      'openrouter/tencent/hy3',
      '--base-url',
      'https://openrouter.ai/api/v1',
      '--api-key',
      'sk-test-key',
      '--provider-id',
      'openrouter',
      '--mode',
      'jsonl',
      '--reasoning-effort',
      'high',
      '--request-timeout-ms',
      '240000',
      '--max-retries',
      '1',
      '--max-iterations',
      '15',
      '--git',
      '--architect',
      '--auto-lint',
      '--no-auto-rollback',
      '--sandbox',
      'docker',
      '--docker-image',
      'gcc:13',
    ];

    const parsed = parseSolveArgs(args);

    expect(parsed.prompt).toBe('Solve problem 001');
    expect(parsed.cwd).toBe(path.resolve(tempDir));
    expect(parsed.modelId).toBe('openrouter/tencent/hy3');
    expect(parsed.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(parsed.apiKey).toBe('sk-test-key');
    expect(parsed.providerId).toBe('openrouter');
    expect(parsed.mode).toBe('jsonl');
    expect(parsed.reasoningEffort).toBe('high');
    expect(parsed.requestTimeoutMs).toBe(240000);
    expect(parsed.maxRetries).toBe(1);
    expect(parsed.maxIterations).toBe(15);
    expect(parsed.git).toBe(true);
    expect(parsed.architect).toBe(true);
    expect(parsed.autoLint).toBe(true);
    expect(parsed.autoRollback).toBe(false);
    expect(parsed.sandbox).toBe('docker');
    expect(parsed.dockerImage).toBe('gcc:13');
  });

  it('1b. parseSolveArgs: Default values for autoLint, autoRollback, and sandbox', () => {
    const parsed = parseSolveArgs(['-p', 'Simple task']);
    expect(parsed.autoLint).toBe(false);
    expect(parsed.autoRollback).toBe(true);
    expect(parsed.sandbox).toBe('local');
    expect(parsed.dockerImage).toBe('ubuntu:22.04');
  });

  it('2. Validation: Fails gracefully when prompt is missing', async () => {
    const exitCode = await runSolveCli(['--cwd', tempDir]);
    expect(exitCode).toBe(1);
  });

  it('3. Help Flag: Prints help and exits with 0', async () => {
    const exitCode = await runSolveCli(['--help']);
    expect(exitCode).toBe(0);
  });

  it('4. Headless Execution: Executes mock provider task and exits 0', async () => {
    const exitCode = await runSolveCli([
      '-p',
      'Implement calculateSum function in calc.ts',
      '--cwd',
      tempDir,
      '--provider-id',
      'mock',
      '--max-iterations',
      '5',
    ]);

    expect(exitCode).toBe(0);
  });

  it('5. JSONL Streaming: Emits valid JSON lines on stdout during execution', async () => {
    const stdoutChunks: string[] = [];
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutChunks.push(String(chunk));
      return true;
    });

    try {
      const exitCode = await runSolveCli([
        '-p',
        'Create a greeting in greeting.txt',
        '--cwd',
        tempDir,
        '--provider-id',
        'mock',
        '--mode',
        'jsonl',
        '--max-iterations',
        '3',
      ]);

      expect(exitCode).toBe(0);

      // Verify JSONL output
      const rawOutput = stdoutChunks.join('');
      const lines = rawOutput.split('\n').filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThan(0);

      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed.event).toBeDefined();
        expect(parsed.timestamp).toBeDefined();
        expect(parsed.executionId).toBeDefined();
        expect(parsed.taskId).toBeDefined();
      }

      // Check key events are in the stream
      const events = lines.map((l) => JSON.parse(l).event);
      expect(events).toContain('AgentStarted');
      expect(events).toContain('AgentCompleted');
    } finally {
      process.stdout.write = originalStdoutWrite;
    }
  });

  it('6. scanWorkspaceFiles: Recursively scans source files and ignores node_modules and .git', () => {
    fs.mkdirSync(path.join(tempDir, 'src'));
    fs.mkdirSync(path.join(tempDir, 'node_modules', 'foo'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), 'export const x = 1;', 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'node_modules', 'foo', 'index.js'), 'module.exports = 1;', 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Ignore markdown in scan', 'utf-8');

    const files = scanWorkspaceFiles(tempDir);
    expect(files.has('src/index.ts')).toBe(true);
    expect(files.has('node_modules/foo/index.js')).toBe(false);
    expect(files.has('README.md')).toBe(false);
  });

  it('7. parseSolveArgs: Parses --output-patch option', () => {
    const parsed = parseSolveArgs(['-p', 'task', '--output-patch', 'results/test.patch']);
    expect(parsed.outputPatch).toBe('results/test.patch');
  });

  it('8. Output Patch Export: Creates patch file when --output-patch is specified', async () => {
    const patchFile = path.join(tempDir, 'output.patch');
    const exitCode = await runSolveCli([
      '-p',
      'Generate code',
      '--cwd',
      tempDir,
      '--provider-id',
      'mock',
      '--output-patch',
      patchFile,
      '--mode',
      'jsonl',
    ]);

    expect(exitCode).toBe(0);
    expect(fs.existsSync(patchFile)).toBe(true);
  });

  it('9. parseSolveArgs: Parses --prompt-caching and --no-prompt-caching options', () => {
    const defaultParsed = parseSolveArgs(['-p', 'task']);
    expect(defaultParsed.promptCaching).toBe(true);

    const disabledParsed = parseSolveArgs(['-p', 'task', '--no-prompt-caching']);
    expect(disabledParsed.promptCaching).toBe(false);

    const enabledParsed = parseSolveArgs(['-p', 'task', '--prompt-caching']);
    expect(enabledParsed.promptCaching).toBe(true);
  });

  it('10. Headless Execution with Prompt Caching: Runs solve with --no-prompt-caching and succeeds', async () => {
    const exitCode = await runSolveCli([
      '-p',
      'Prompt cache test',
      '--cwd',
      tempDir,
      '--provider-id',
      'mock',
      '--no-prompt-caching',
      '--mode',
      'jsonl',
      '--max-iterations',
      '2',
    ]);

    expect(exitCode).toBe(0);
  });

  it('11. Strict Compiler CLI Flags: Parses --strict-compiler and --no-strict-compiler correctly', () => {
    const strictParsed = parseSolveArgs(['-p', 'task', '--strict-compiler']);
    expect(strictParsed.strictCompiler).toBe(true);

    const lenientParsed = parseSolveArgs(['-p', 'task', '--no-strict-compiler']);
    expect(lenientParsed.strictCompiler).toBe(false);
  });

  it('12. parseSolveArgs: Parses resource limits and feedback ingestion options', () => {
    const parsed = parseSolveArgs([
      '-p',
      'task',
      '--max-cpu-time-sec',
      '5',
      '--max-memory-mb',
      '256',
      '--ingest-feedback',
      'feedback.json',
    ]);

    expect(parsed.maxCpuTimeSec).toBe(5);
    expect(parsed.maxMemoryMb).toBe(256);
    expect(parsed.ingestFeedback).toBe('feedback.json');
  });

  it('13. Headless Execution with Ingested OJ Feedback: Ingests feedback and executes mock run', async () => {
    const feedbackFile = path.join(tempDir, 'oj_verdict.json');
    fs.writeFileSync(
      feedbackFile,
      JSON.stringify({
        verdict: 'WA',
        failedTestCase: 'case01.txt',
        expected: '100',
        actual: '0',
      }),
    );

    const exitCode = await runSolveCli([
      '-p',
      'Fix calculation bug based on judge feedback',
      '--cwd',
      tempDir,
      '--provider-id',
      'mock',
      '--ingest-feedback',
      feedbackFile,
      '--max-cpu-time-sec',
      '30',
      '--max-memory-mb',
      '512',
      '--mode',
      'jsonl',
      '--max-iterations',
      '2',
    ]);

    expect(exitCode).toBe(0);
  });

  it('14. parseSolveArgs: Parses --provider-id bedrock', () => {
    const parsed = parseSolveArgs([
      '-p',
      'task',
      '--provider-id',
      'bedrock',
      '-m',
      'anthropic.claude-3-5-sonnet-20241022-v2:0',
    ]);

    expect(parsed.providerId).toBe('bedrock');
    expect(parsed.modelId).toBe('anthropic.claude-3-5-sonnet-20241022-v2:0');
  });
});
