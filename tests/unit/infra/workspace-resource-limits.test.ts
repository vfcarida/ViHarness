import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { WorkspaceRunCommandTool } from '../../../src/infra/tools/workspace-tools.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';

describe('WorkspaceRunCommandTool Resource Limits', () => {
  let tempDir: string;
  const idFactory = new UuidV7IdFactory();

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-resource-limits-'));
  });

  afterEach(async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Ignore cleanup error if OS briefly holds folder lock
    }
  });

  it('runs normal commands successfully when within resource limits', async () => {
    const tool = new WorkspaceRunCommandTool(tempDir, {
      idFactory,
      maxCpuTimeSec: 10,
      maxMemoryMb: 512,
    });

    const result = await tool.execute({
      command: 'node -e "console.log(\'hello world\')"',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('hello world');
    expect(result.error).toBeUndefined();
    expect(result.metadata?.maxCpuTimeSec).toBe(10);
    expect(result.metadata?.maxMemoryMb).toBe(512);
  });

  it('detects Time Limit Exceeded (TLE) when a process exceeds maxCpuTimeSec', async () => {
    const tool = new WorkspaceRunCommandTool(tempDir, {
      idFactory,
      maxCpuTimeSec: 1, // 1 second limit
      timeoutMs: 30000,
    });

    // Run an infinite loop in node
    const result = await tool.execute({
      command: 'node -e "while(true){}"',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('TIME_LIMIT_EXCEEDED');
    expect(result.output).toContain('[Vi-Harness Resource Limit Notice]');
    expect(result.output).toContain('Command exceeded CPU time limit (1 seconds)');
    expect(result.output).toContain('Time Limit Exceeded (TLE)');
  }, 10000);

  it('detects Memory Limit Exceeded (MLE) when output contains out of memory indicators', async () => {
    const tool = new WorkspaceRunCommandTool(tempDir, {
      idFactory,
      maxMemoryMb: 256,
    });

    // Simulate an out of memory error
    const result = await tool.execute({
      command: 'node -e "console.error(\'fatal error: out of memory allocating 536870912 bytes\'); process.exit(1)"',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('MEMORY_LIMIT_EXCEEDED');
    expect(result.output).toContain('[Vi-Harness Resource Limit Notice]');
    expect(result.output).toContain('Command exceeded virtual memory limit (256 MB)');
    expect(result.output).toContain('Memory Limit Exceeded (MLE)');
  });

  it('detects Memory Limit Exceeded on std::bad_alloc pattern', async () => {
    const tool = new WorkspaceRunCommandTool(tempDir, {
      idFactory,
      maxMemoryMb: 128,
    });

    const result = await tool.execute({
      command: 'node -e "console.error(\'terminate called after throwing an instance of std::bad_alloc\'); process.exit(1)"',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('MEMORY_LIMIT_EXCEEDED');
    expect(result.output).toContain('Memory Limit Exceeded (MLE)');
  });
});
