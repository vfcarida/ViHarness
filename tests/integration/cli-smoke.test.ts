import { describe, it, expect } from 'vitest';
import { runCli } from '../../src/cli/index.js';
import { createRuntime } from '../../src/index.js';

describe('CLI Integration & Package Smoke Test', () => {
  it('prints version information on --version', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      const exitCode = await runCli(['--version']);
      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes('vi-harness v0.2.0'))).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });

  it('prints help menu on --help', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      const exitCode = await runCli(['--help']);
      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes('USAGE:'))).toBe(true);
      expect(logs.some((l) => l.includes('PROFILES:'))).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });

  it('activates distribution profile on --profile flag', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      const exitCode = await runCli(['--profile', 'headless']);
      expect(exitCode).toBe(0);
      expect(logs.some((l) => l.includes('Activated profile: headless'))).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });

  it('instantiates runtime via createRuntime helper', () => {
    const runtime = createRuntime({ profile: 'headless' });
    expect(runtime).toBeDefined();
    expect(typeof runtime.execute).toBe('function');
  });
});
