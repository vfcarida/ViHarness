import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  TestProtectionGate,
  DEFAULT_PROTECTED_TEST_PATTERNS,
} from '../../../src/infra/security/test-protection-gate.js';
import {
  createWorkspaceTools,
  WorkspaceWriteFileTool,
  WorkspaceEditFileTool,
} from '../../../src/infra/tools/workspace-tools.js';

describe('TestProtectionGate & Anti-Reward-Hacking Suite', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vih-test-protect-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('correctly identifies protected test directories and test files', () => {
    const gate = new TestProtectionGate();

    // Protected patterns
    expect(gate.isProtected('tests/unit/math.test.ts')).toBe(true);
    expect(gate.isProtected('test/foo_test.go')).toBe(true);
    expect(gate.isProtected('conftest.py')).toBe(true);
    expect(gate.isProtected('pytest.ini')).toBe(true);
    expect(gate.isProtected('vitest.config.ts')).toBe(true);
    expect(gate.isProtected('tests/repro.py')).toBe(true); // inside tests/ dir
    expect(gate.isProtected('test_calculator.py')).toBe(true);
    expect(gate.isProtected('specs/api.spec.js')).toBe(true);

    // Production source files should NOT be protected
    expect(gate.isProtected('src/calculator.ts')).toBe(false);
    expect(gate.isProtected('lib/engine.py')).toBe(false);
    expect(gate.isProtected('package.json')).toBe(false);
    expect(gate.isProtected('CMakeLists.txt')).toBe(false);
  });

  it('whitelists standalone reproducer scripts in root or non-test dirs', () => {
    const gate = new TestProtectionGate();

    expect(gate.isProtected('repro.py')).toBe(false);
    expect(gate.isProtected('test_repro.py')).toBe(false);
    expect(gate.isProtected('reproduce_bug.ts')).toBe(false);
    expect(gate.isProtected('reproducer.sh')).toBe(false);
  });

  it('supports explicit allowFile and protectFile overrides', () => {
    const gate = new TestProtectionGate();

    expect(gate.isProtected('tests/my_test.py')).toBe(true);
    gate.allowFile('tests/my_test.py');
    expect(gate.isProtected('tests/my_test.py')).toBe(false);

    expect(gate.isProtected('src/core.ts')).toBe(false);
    gate.protectFile('src/core.ts');
    expect(gate.isProtected('src/core.ts')).toBe(true);
  });

  it('does not block anything when gate is disabled', () => {
    const gate = new TestProtectionGate({ enabled: false });

    expect(gate.isProtected('tests/eval/judge.py')).toBe(false);
    expect(gate.isProtected('conftest.py')).toBe(false);
  });

  it('WorkspaceWriteFileTool blocks writing to protected test files', async () => {
    const gate = new TestProtectionGate();
    const writer = new WorkspaceWriteFileTool(tempDir, undefined, gate);

    // 1. Writing to production file succeeds
    const res1 = await writer.execute(
      { path: 'src/solution.ts', content: 'export const x = 1;' },
      { correlationId: 'c1', workingDirectory: tempDir } as any,
    );
    expect(res1.success).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'src/solution.ts'))).toBe(true);

    // 2. Writing to protected test suite is denied
    const res2 = await writer.execute(
      { path: 'tests/eval_test.ts', content: 'test("hacked", () => {});' },
      { correlationId: 'c2', workingDirectory: tempDir } as any,
    );
    expect(res2.success).toBe(false);
    expect(res2.error).toBe('PROTECTED_TEST_FILE_MUTATION_DENIED');
    expect(res2.output).toContain('[Test Protection Notice]');
    expect(res2.output).toContain('Anti-Reward-Hacking Policy is ACTIVE');
    expect(fs.existsSync(path.join(tempDir, 'tests/eval_test.ts'))).toBe(false);
  });

  it('WorkspaceEditFileTool blocks editing protected test files', async () => {
    const testFilePath = path.join(tempDir, 'test_sample.py');
    fs.writeFileSync(testFilePath, 'assert solve() == 42\n', 'utf-8');

    const gate = new TestProtectionGate();
    const editor = new WorkspaceEditFileTool(tempDir, undefined, gate);

    const res = await editor.execute(
      {
        path: 'test_sample.py',
        old_string: 'assert solve() == 42',
        new_string: 'assert True',
      },
      { correlationId: 'c3', workingDirectory: tempDir } as any,
    );

    expect(res.success).toBe(false);
    expect(res.error).toBe('PROTECTED_TEST_FILE_MUTATION_DENIED');
    expect(res.output).toContain('Anti-Reward-Hacking Policy is ACTIVE');
    // Content unchanged
    expect(fs.readFileSync(testFilePath, 'utf-8')).toBe('assert solve() == 42\n');
  });

  it('createWorkspaceTools configures test protection when protectTests is true', async () => {
    const tools = createWorkspaceTools(tempDir, { protectTests: true });
    const writer = tools.find((t) => t.definition.name === 'write_file');
    expect(writer).toBeDefined();

    const res = await writer!.execute(
      { path: 'tests/unit.test.ts', content: 'console.log(1);' },
      { correlationId: 'c4', workingDirectory: tempDir } as any,
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe('PROTECTED_TEST_FILE_MUTATION_DENIED');
  });
});
