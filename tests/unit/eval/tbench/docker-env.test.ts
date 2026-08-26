/**
 * TBench Docker Environment Unit Tests (P011).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import {
  MockDockerEnvironment,
  DefaultDockerEnvironment,
  type TBenchTask,
} from '../../../../src/infra/eval/tbench/index.js';

describe('TBench Docker Environment — P011', { timeout: 20000 }, () => {
  const sampleTask: TBenchTask = {
    id: 'test-env-task',
    instruction: 'Create output.txt with content hello',
    category: 'software-engineering',
    difficulty: 'easy',
    tags: ['test'],
    timeout: 5,
    testScript:
      "node -e \"const fs = require('fs'); if (!fs.existsSync('output.txt')) process.exit(1);\"",
    environment: { TEST_VAR: 'ViHarnessEnv' },
  };

  it('1. should create isolated container with environment variables', async () => {
    const env = new MockDockerEnvironment();
    const container = await env.create(sampleTask);

    expect(container.id).toBeDefined();
    expect(container.status).toBe('running');
    expect(fs.existsSync(container.workdir)).toBe(true);

    // Verify .env file written
    const envFile = `${container.workdir}/.env`;
    expect(fs.existsSync(envFile)).toBe(true);
    expect(fs.readFileSync(envFile, 'utf-8')).toContain('TEST_VAR=ViHarnessEnv');

    await env.destroy(container);
  });

  it('2. should execute command and capture stdout & exitCode 0', async () => {
    const env = new MockDockerEnvironment();
    const container = await env.create(sampleTask);

    const execRes = await env.exec(container, 'node -e "console.log(\'CONTAINER_OUTPUT_OK\');"');

    expect(execRes.exitCode).toBe(0);
    expect(execRes.stdout).toContain('CONTAINER_OUTPUT_OK');
    expect(execRes.duration).toBeGreaterThanOrEqual(0);

    await env.destroy(container);
  });

  it('3. should execute command and capture stderr & non-zero exitCode', async () => {
    const env = new MockDockerEnvironment();
    const container = await env.create(sampleTask);

    const execRes = await env.exec(
      container,
      'node -e "console.error(\'CONTAINER_ERROR_MSG\'); process.exit(42);"',
    );

    expect(execRes.exitCode).not.toBe(0);
    expect(execRes.stderr).toContain('CONTAINER_ERROR_MSG');

    await env.destroy(container);
  });

  it('4. should verify passing test script', async () => {
    const env = new MockDockerEnvironment();
    const container = await env.create(sampleTask);

    // Agent writes output.txt
    await env.exec(
      container,
      "node -e \"const fs = require('fs'); fs.writeFileSync('output.txt', 'hello');\"",
    );

    // Run verification
    const passed = await env.verify(container, sampleTask.testScript);
    expect(passed).toBe(true);

    await env.destroy(container);
  });

  it('5. should verify failing test script when requirement not met', async () => {
    const env = new MockDockerEnvironment();
    const container = await env.create(sampleTask);

    // Don't create output.txt -> verification must return false
    const passed = await env.verify(container, sampleTask.testScript);
    expect(passed).toBe(false);

    await env.destroy(container);
  });

  it('6. should clean up container workspace on destroy without leaking files', async () => {
    const env = new MockDockerEnvironment();
    const container = await env.create(sampleTask);
    const workdir = container.workdir;

    expect(fs.existsSync(workdir)).toBe(true);

    await env.destroy(container);

    expect(container.status).toBe('destroyed');
    expect(fs.existsSync(workdir)).toBe(false);
  });

  it('7. should reject command execution on destroyed container', async () => {
    const env = new MockDockerEnvironment();
    const container = await env.create(sampleTask);
    await env.destroy(container);

    await expect(env.exec(container, 'node -v')).rejects.toThrow(/not running/i);
  });

  it('8. should initialize DefaultDockerEnvironment with mock driver fallback', async () => {
    const env = new DefaultDockerEnvironment({ driver: 'mock' });
    const container = await env.create(sampleTask);

    expect(container.status).toBe('running');
    const res = await env.exec(container, 'node -e "console.log(\'DEFAULT_FALLBACK\')"');
    expect(res.stdout).toContain('DEFAULT_FALLBACK');

    await env.destroy(container);
  });
});
