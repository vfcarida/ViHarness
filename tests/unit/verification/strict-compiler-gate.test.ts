/**
 * Strict Compiler Gate Unit Tests.
 *
 * Verifies build command detection, multi-compiler warning extraction (GCC/Clang, Rust, CMake, TS),
 * and warning-as-error conversion in WorkspaceRunCommandTool.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { StrictCompilerGate } from '../../../src/infra/verification/strict-compiler-gate.js';
import { WorkspaceRunCommandTool } from '../../../src/infra/tools/workspace-tools.js';

describe('StrictCompilerGate Unit Tests', () => {
  describe('isBuildCommand', () => {
    it('correctly identifies build and compilation commands', () => {
      expect(StrictCompilerGate.isBuildCommand('gcc -Wall -O2 main.c -o code')).toBe(true);
      expect(StrictCompilerGate.isBuildCommand('g++ -std=c++17 solution.cpp -o code')).toBe(true);
      expect(StrictCompilerGate.isBuildCommand('clang -c test.c')).toBe(true);
      expect(StrictCompilerGate.isBuildCommand('cmake . && make')).toBe(true);
      expect(StrictCompilerGate.isBuildCommand('make all')).toBe(true);
      expect(StrictCompilerGate.isBuildCommand('cargo build --release')).toBe(true);
      expect(StrictCompilerGate.isBuildCommand('tsc --noEmit')).toBe(true);
      expect(StrictCompilerGate.isBuildCommand('javac Main.java')).toBe(true);
      expect(StrictCompilerGate.isBuildCommand('dotnet build')).toBe(true);
      expect(StrictCompilerGate.isBuildCommand('npm run build')).toBe(true);
    });

    it('returns false for inspection, testing, and general shell commands', () => {
      expect(StrictCompilerGate.isBuildCommand('ls -la')).toBe(false);
      expect(StrictCompilerGate.isBuildCommand('git status')).toBe(false);
      expect(StrictCompilerGate.isBuildCommand('cat CMakeLists.txt')).toBe(false);
      expect(StrictCompilerGate.isBuildCommand('./code < input.txt')).toBe(false);
      expect(StrictCompilerGate.isBuildCommand('python3 test.py')).toBe(false);
    });
  });

  describe('inspectOutput', () => {
    it('detects GCC and Clang type mismatch warnings', () => {
      const gccOutput = `
buddy.c: In function 'buddy_alloc':
buddy.h:12:5: warning: passing argument 1 of 'memcpy' makes pointer from integer without a cast [-Wint-conversion]
   12 |     memcpy(ptr, val, size);
      |     ^~~~~~
      |     int
      `;
      const diag = StrictCompilerGate.inspectOutput('gcc -c buddy.c', gccOutput);
      expect(diag).not.toBeNull();
      expect(diag?.compiler).toBe('gcc/clang');
      expect(diag?.warningCount).toBeGreaterThanOrEqual(1);
      expect(diag?.feedbackMessage).toContain('[Vi-Harness Strict Compiler Gate]');
      expect(diag?.feedbackMessage).toContain('buddy.h:12:5: warning:');
    });

    it('detects Rust compiler unused variable and dead code warnings', () => {
      const rustOutput = `
   Compiling solver v0.1.0 (/workspace)
warning: unused variable: \`count\`
  --> src/main.rs:42:9
   |
42 |     let count = 0;
   |         ^^^^^ help: if this is intentional, prefix it with an underscore: \`_count\`
   |
   = note: \`#[warn(unused_variables)]\` on by default

warning: \`solver\` (bin "solver") generated 1 warning
    Finished \`dev\` profile [unoptimized + debuginfo] target(s) in 0.45s
      `;
      const diag = StrictCompilerGate.inspectOutput('cargo build', rustOutput);
      expect(diag).not.toBeNull();
      expect(diag?.compiler).toBe('rustc');
      expect(diag?.warningCount).toBeGreaterThanOrEqual(1);
      expect(diag?.feedbackMessage).toContain('unused variable: `count`');
    });

    it('detects CMake configuration warnings', () => {
      const cmakeOutput = `
-- The C compiler identification is GNU 11.4.0
CMake Warning at CMakeLists.txt:14 (message):
  Policy CMP0077 is not set: option() honors normal variables.
-- Configuring done
-- Generating done
      `;
      const diag = StrictCompilerGate.inspectOutput('cmake .', cmakeOutput);
      expect(diag).not.toBeNull();
      expect(diag?.compiler).toBe('cmake');
      expect(diag?.warningCount).toBe(1);
      expect(diag?.feedbackMessage).toContain('CMake Warning at CMakeLists.txt:14');
    });

    it('detects TypeScript compiler warnings', () => {
      const tsOutput = `
src/index.ts(24,5): error TS2322: Type 'string' is not assignable to type 'number'.
      `;
      const diag = StrictCompilerGate.inspectOutput('tsc --noEmit', tsOutput);
      expect(diag).not.toBeNull();
      expect(diag?.compiler).toBe('typescript');
      expect(diag?.warningCount).toBe(1);
    });

    it('returns null when build command succeeds cleanly without warnings', () => {
      const cleanOutput = `
Scanning dependencies of target code
[ 50%] Building C object CMakeFiles/code.dir/solution.c.o
[100%] Linking C executable code
[100%] Built target code
      `;
      const diag = StrictCompilerGate.inspectOutput('make', cleanOutput);
      expect(diag).toBeNull();
    });
  });

  describe('WorkspaceRunCommandTool integration', () => {
    let tmpDir: string;

    it('fails command execution with COMPILER_WARNINGS_DETECTED when strictCompilerCheck is enabled', async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-strict-gate-'));
      try {
        const tool = new WorkspaceRunCommandTool(tmpDir, {
          strictCompilerCheck: true,
          sandbox: 'docker',
          dockerRunner: async () => ({
            stdout: `buddy.h:12: warning: passing argument 1 makes pointer from integer\n[100%] Built target code`,
            stderr: '',
            exitCode: 0,
          }),
        });

        const result = await tool.execute(
          { command: 'make' },
          { correlationId: 'call-test' } as any,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('COMPILER_WARNINGS_DETECTED');
        expect(result.output).toContain('[Vi-Harness Strict Compiler Gate]');
        expect(result.output).toContain('buddy.h:12: warning:');
        expect(result.metadata?.['strictCompilerCheck']).toBe(true);
        expect(result.metadata?.['warningCount']).toBeGreaterThanOrEqual(1);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('permits command execution with warning notice when strictCompilerCheck is disabled', async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-lenient-gate-'));
      try {
        const tool = new WorkspaceRunCommandTool(tmpDir, {
          strictCompilerCheck: false,
          sandbox: 'docker',
          dockerRunner: async () => ({
            stdout: `buddy.h:12: warning: passing argument 1 makes pointer from integer\n[100%] Built target code`,
            stderr: '',
            exitCode: 0,
          }),
        });

        const result = await tool.execute(
          { command: 'make' },
          { correlationId: 'call-test' } as any,
        );

        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
        expect(result.output).toContain('[Vi-Harness Compiler Warning Notice]');
        expect(result.metadata?.['hasWarnings']).toBe(true);
        expect(result.metadata?.['strictCompilerCheck']).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
