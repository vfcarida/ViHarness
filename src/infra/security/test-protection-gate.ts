/**
 * Test Protection & Anti-Reward-Hacking Gate.
 *
 * Prevents autonomous coding agents from mutating evaluation test suites,
 * test configurations (e.g. pytest.ini, conftest.py, vitest.config.ts),
 * or baseline test files to artificially pass benchmarks ("reward hacking").
 *
 * Provides whitelisting for user/agent-created standalone reproducer scripts
 * (e.g. repro.py, test_repro.py) so legitimate TDD workflows are fully supported.
 */
import * as path from 'node:path';

export const DEFAULT_PROTECTED_TEST_PATTERNS: ReadonlyArray<RegExp> = [
  // Test directories
  /(?:^|[\\/])(?:tests?|testing|specs?|__tests?__)(?:[\\/]|$)/i,
  // Python test files and test runners
  /(?:^|[\\/])(?:test_.*|.*_test)\.py$/i,
  /(?:^|[\\/])(?:conftest\.py|pytest\.ini|tox\.ini|\.coveragerc)$/i,
  // JavaScript / TypeScript test files and test runners
  /(?:^|[\\/]).*\.(?:test|spec)\.[jt]sx?$/i,
  /(?:^|[\\/])(?:vitest|jest|karma|mocha|cypress|playwright)\.config\.[a-z0-9]+$/i,
  // Go test files
  /(?:^|[\\/]).*_test\.go$/i,
  // Rust test files
  /(?:^|[\\/])tests(?:[\\/].*)?\.rs$/i,
  // C / C++ test files
  /(?:^|[\\/])(?:test_.*|.*_test|.*_unittest)\.(?:cc|cpp|cxx|c)$/i,
  // Java test files
  /(?:^|[\\/]).*Test\.java$/i,
];

export const DEFAULT_ALLOWED_REPRODUCER_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:^|[\\/])(?:repro|reproduce|test_repro|reproducer|bug_repro).*\.(?:py|js|ts|sh|go|c|cpp|rs)$/i,
];

export interface TestProtectionGateOptions {
  readonly enabled?: boolean;
  readonly protectedPatterns?: ReadonlyArray<RegExp | string>;
  readonly allowedPatterns?: ReadonlyArray<RegExp | string>;
}

export class TestProtectionGate {
  private readonly enabled: boolean;
  private readonly protectedPatterns: ReadonlyArray<RegExp>;
  private readonly allowedPatterns: ReadonlyArray<RegExp>;
  private readonly explicitlyAllowedFiles: Set<string> = new Set();
  private readonly explicitlyProtectedFiles: Set<string> = new Set();

  constructor(options: TestProtectionGateOptions = {}) {
    this.enabled = options.enabled ?? true;

    this.protectedPatterns = options.protectedPatterns
      ? options.protectedPatterns.map((p) => (typeof p === 'string' ? new RegExp(p, 'i') : p))
      : DEFAULT_PROTECTED_TEST_PATTERNS;

    this.allowedPatterns = options.allowedPatterns
      ? options.allowedPatterns.map((p) => (typeof p === 'string' ? new RegExp(p, 'i') : p))
      : DEFAULT_ALLOWED_REPRODUCER_PATTERNS;
  }

  /**
   * Check whether test protection is actively enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Whitelist an individual file path (e.g. newly created standalone reproducer).
   */
  allowFile(filePath: string): void {
    const normalized = this.normalize(filePath);
    this.explicitlyAllowedFiles.add(normalized);
    this.explicitlyProtectedFiles.delete(normalized);
  }

  /**
   * Explicitly designate a file path as protected.
   */
  protectFile(filePath: string): void {
    const normalized = this.normalize(filePath);
    this.explicitlyProtectedFiles.add(normalized);
    this.explicitlyAllowedFiles.delete(normalized);
  }

  /**
   * Check if a target file path is protected against modification.
   */
  isProtected(filePath: string, workspaceRoot?: string): boolean {
    if (!this.enabled) {
      return false;
    }

    const relPath = workspaceRoot
      ? path.relative(workspaceRoot, path.resolve(workspaceRoot, filePath))
      : filePath;
    const normalized = this.normalize(relPath);

    // 1. Explicit overrides
    if (this.explicitlyAllowedFiles.has(normalized)) {
      return false;
    }
    if (this.explicitlyProtectedFiles.has(normalized)) {
      return true;
    }

    const isInsideTestDir = /(?:^|[\\/])(?:tests?|testing|specs?|__tests?__)(?:[\\/]|$)/i.test(normalized);

    // 2. Pattern-based whitelisting (standalone reproducer scripts OUTSIDE test suites)
    if (!isInsideTestDir) {
      for (const pattern of this.allowedPatterns) {
        if (pattern.test(normalized)) {
          return false;
        }
      }
    }

    // 3. Pattern-based protection
    for (const pattern of this.protectedPatterns) {
      if (pattern.test(normalized)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generates a helpful, structured feedback message when a test file mutation is blocked.
   */
  getRejectionFeedback(filePath: string): string {
    return `[Test Protection Notice]: Modification to protected test/evaluation file "${filePath}" is denied.

Reason: Anti-Reward-Hacking Policy is ACTIVE.
The evaluation harness requires existing test suites, test configurations, and verification assertions to remain pristine.
Altering test assertions or modifying configuration files (e.g. conftest.py, pytest.ini) to pass tests artificially is strictly forbidden.

Directive:
Please apply your fix exclusively to the production codebase in src/ or lib/. If you need to write a reproduction script, save it as a standalone script (e.g. repro.py or test_repro.py).`;
  }

  private normalize(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  }
}
