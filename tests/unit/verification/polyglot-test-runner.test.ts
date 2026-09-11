import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  PolyglotTestRunner,
  ProjectEcosystem,
} from '../../../src/infra/verification/polyglot-test-runner.js';
import { TddEnforcer, TddPhase } from '../../../src/infra/verification/tdd-enforcer.js';

describe('PolyglotTestRunner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polyglot-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('detectEcosystem', () => {
    it('detects RUST via Cargo.toml', () => {
      fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "test"');
      expect(PolyglotTestRunner.detectEcosystem(tmpDir)).toBe(ProjectEcosystem.RUST);
    });

    it('detects GO via go.mod', () => {
      fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module test\n');
      expect(PolyglotTestRunner.detectEcosystem(tmpDir)).toBe(ProjectEcosystem.GO);
    });

    it('detects JAVA_MAVEN via pom.xml', () => {
      fs.writeFileSync(path.join(tmpDir, 'pom.xml'), '<project></project>');
      expect(PolyglotTestRunner.detectEcosystem(tmpDir)).toBe(ProjectEcosystem.JAVA_MAVEN);
    });

    it('detects JAVA_GRADLE via build.gradle', () => {
      fs.writeFileSync(path.join(tmpDir, 'build.gradle'), 'plugins {}');
      expect(PolyglotTestRunner.detectEcosystem(tmpDir)).toBe(ProjectEcosystem.JAVA_GRADLE);
    });

    it('detects CPP_CMAKE via CMakeLists.txt', () => {
      fs.writeFileSync(path.join(tmpDir, 'CMakeLists.txt'), 'cmake_minimum_required()');
      expect(PolyglotTestRunner.detectEcosystem(tmpDir)).toBe(ProjectEcosystem.CPP_CMAKE);
    });

    it('detects NODE via package.json', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name": "test"}');
      expect(PolyglotTestRunner.detectEcosystem(tmpDir)).toBe(ProjectEcosystem.NODE);
    });

    it('detects PYTHON via pytest.ini or pyproject.toml', () => {
      fs.writeFileSync(path.join(tmpDir, 'pytest.ini'), '[pytest]');
      expect(PolyglotTestRunner.detectEcosystem(tmpDir)).toBe(ProjectEcosystem.PYTHON);
    });

    it('returns UNKNOWN for non-existent or empty directories', () => {
      expect(PolyglotTestRunner.detectEcosystem(path.join(tmpDir, 'non_existent'))).toBe(
        ProjectEcosystem.UNKNOWN,
      );
      expect(PolyglotTestRunner.detectEcosystem(tmpDir)).toBe(ProjectEcosystem.UNKNOWN);
    });
  });

  describe('getDefaultTestCommand', () => {
    it('provides correct default commands per ecosystem', () => {
      expect(PolyglotTestRunner.getDefaultTestCommand(ProjectEcosystem.RUST)).toBe('cargo test');
      expect(PolyglotTestRunner.getDefaultTestCommand(ProjectEcosystem.GO)).toBe('go test -v ./...');
      expect(PolyglotTestRunner.getDefaultTestCommand(ProjectEcosystem.JAVA_MAVEN)).toBe('mvn test');
      expect(PolyglotTestRunner.getDefaultTestCommand(ProjectEcosystem.JAVA_GRADLE)).toBe('gradle test');
      expect(PolyglotTestRunner.getDefaultTestCommand(ProjectEcosystem.CPP_CMAKE)).toBe(
        'ctest --output-on-failure',
      );
      expect(PolyglotTestRunner.getDefaultTestCommand(ProjectEcosystem.NODE)).toBe('npm test');
      expect(PolyglotTestRunner.getDefaultTestCommand(ProjectEcosystem.PYTHON)).toBe('pytest');
      expect(PolyglotTestRunner.getDefaultTestCommand(ProjectEcosystem.UNKNOWN)).toBe('npm test');
    });
  });

  describe('isRecognizedTestCommand', () => {
    it('recognizes diverse multi-language test invocations', () => {
      expect(PolyglotTestRunner.isRecognizedTestCommand('cargo test --release')).toBe(true);
      expect(PolyglotTestRunner.isRecognizedTestCommand('go test ./...')).toBe(true);
      expect(PolyglotTestRunner.isRecognizedTestCommand('mvn test -Dtest=MyTest')).toBe(true);
      expect(PolyglotTestRunner.isRecognizedTestCommand('./gradlew test')).toBe(true);
      expect(PolyglotTestRunner.isRecognizedTestCommand('ctest --output-on-failure')).toBe(true);
      expect(PolyglotTestRunner.isRecognizedTestCommand('pytest tests/test_bug.py')).toBe(true);
      expect(PolyglotTestRunner.isRecognizedTestCommand('python repro.py')).toBe(true);
      expect(PolyglotTestRunner.isRecognizedTestCommand('node test_repro.js')).toBe(true);
      expect(PolyglotTestRunner.isRecognizedTestCommand('npm test')).toBe(true);
      expect(PolyglotTestRunner.isRecognizedTestCommand('vitest run')).toBe(true);
    });

    it('rejects general non-test shell commands', () => {
      expect(PolyglotTestRunner.isRecognizedTestCommand('ls -la')).toBe(false);
      expect(PolyglotTestRunner.isRecognizedTestCommand('git commit -m "fix"')).toBe(false);
      expect(PolyglotTestRunner.isRecognizedTestCommand('cat index.ts')).toBe(false);
    });
  });

  describe('parseVerdict', () => {
    it('correctly parses Rust (cargo test) failed output', () => {
      const output = `
running 7 tests
test tests::test_add ... ok
test tests::test_sub ... ok
test tests::test_mul ... ok
test tests::test_div ... ok
test tests::test_panic ... FAILED
test tests::test_overflow ... FAILED

failures:
---- tests::test_panic stdout ----
thread 'tests::test_panic' panicked at 'assertion failed'
---- tests::test_overflow stdout ----
thread 'tests::test_overflow' panicked at 'overflow detected'

test result: FAILED. 4 passed; 2 failed; 1 ignored; 0 measured; 0 filtered out
      `;

      const verdict = PolyglotTestRunner.parseVerdict(output, 101, ProjectEcosystem.RUST);
      expect(verdict.success).toBe(false);
      expect(verdict.passedCount).toBe(4);
      expect(verdict.failedCount).toBe(2);
      expect(verdict.skippedCount).toBe(1);
      expect(verdict.passRate).toBeCloseTo(4 / 6, 2);
      expect(verdict.failedTestNames).toEqual(['tests::test_panic', 'tests::test_overflow']);
    });

    it('correctly parses Rust (cargo test) successful output', () => {
      const output = `
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
      `;
      const verdict = PolyglotTestRunner.parseVerdict(output, 0, ProjectEcosystem.RUST);
      expect(verdict.success).toBe(true);
      expect(verdict.passedCount).toBe(10);
      expect(verdict.failedCount).toBe(0);
      expect(verdict.passRate).toBe(1.0);
    });

    it('correctly parses Go (go test -v) output', () => {
      const output = `
=== RUN   TestAdd
--- PASS: TestAdd (0.00s)
=== RUN   TestSub
--- PASS: TestSub (0.00s)
=== RUN   TestDiv
--- FAIL: TestDiv (0.00s)
FAIL
exit status 1
      `;
      const verdict = PolyglotTestRunner.parseVerdict(output, 1, ProjectEcosystem.GO);
      expect(verdict.success).toBe(false);
      expect(verdict.passedCount).toBe(2);
      expect(verdict.failedCount).toBe(1);
      expect(verdict.passedTestNames).toContain('TestAdd');
      expect(verdict.passedTestNames).toContain('TestSub');
      expect(verdict.failedTestNames).toContain('TestDiv');
    });

    it('correctly parses Python (pytest) output', () => {
      const output = `
============================= test session starts ==============================
FAILED tests/test_math.py::test_zero_div - ZeroDivisionError
=================== 2 failed, 8 passed, 1 skipped in 0.42s ===================
      `;
      const verdict = PolyglotTestRunner.parseVerdict(output, 1, ProjectEcosystem.PYTHON);
      expect(verdict.success).toBe(false);
      expect(verdict.passedCount).toBe(8);
      expect(verdict.failedCount).toBe(2);
      expect(verdict.skippedCount).toBe(1);
      expect(verdict.failedTestNames).toContain('tests/test_math.py::test_zero_div');
    });

    it('correctly parses Java Maven output', () => {
      const output = `
[INFO] Results:
[INFO]
[ERROR] Failures: 
[ERROR]   TestCalculation.testCompute:42 expected:<10> but was:<12>
[INFO]
[INFO] Tests run: 10, Failures: 1, Errors: 1, Skipped: 2
      `;
      const verdict = PolyglotTestRunner.parseVerdict(output, 1, ProjectEcosystem.JAVA_MAVEN);
      expect(verdict.success).toBe(false);
      expect(verdict.failedCount).toBe(2); // Failures + Errors
      expect(verdict.skippedCount).toBe(2);
      expect(verdict.passedCount).toBe(6); // 10 - 2 - 2
    });

    it('correctly parses CTest output', () => {
      const output = `
80% tests passed, 2 tests failed out of 10
      `;
      const verdict = PolyglotTestRunner.parseVerdict(output, 8, ProjectEcosystem.CPP_CMAKE);
      expect(verdict.success).toBe(false);
      expect(verdict.failedCount).toBe(2);
      expect(verdict.passedCount).toBe(8);
      expect(verdict.passRate).toBe(0.8);
    });

    it('provides accurate fallback verdicts based on exit code and error patterns', () => {
      const cleanOutput = 'Custom test script complete. All OK.';
      const cleanVerdict = PolyglotTestRunner.parseVerdict(cleanOutput, 0);
      expect(cleanVerdict.success).toBe(true);
      expect(cleanVerdict.passRate).toBe(1.0);

      const failedOutput = 'Uncaught AssertionError: expected true to be false';
      const failedVerdict = PolyglotTestRunner.parseVerdict(failedOutput, 1);
      expect(failedVerdict.success).toBe(false);
      expect(failedVerdict.passRate).toBe(0.0);
    });
  });

  describe('Integration with TddEnforcer', () => {
    it('recognizes polyglot test commands in TddEnforcer lifecycle', () => {
      const enforcer = new TddEnforcer();
      expect(enforcer.currentPhase).toBe(TddPhase.INITIAL);

      // Red phase: cargo test fails
      enforcer.recordAction({
        toolName: 'run_command',
        command: 'cargo test',
        exitCode: 101,
        output: 'test result: FAILED. 0 passed; 1 failed; 0 ignored',
      });
      expect(enforcer.currentPhase).toBe(TddPhase.REPRODUCER_CONFIRMED);

      // Edit file
      enforcer.recordAction({
        toolName: 'edit_file',
        filePath: 'src/lib.rs',
      });

      // Green phase: cargo test passes
      enforcer.recordAction({
        toolName: 'run_command',
        command: 'cargo test',
        exitCode: 0,
        output: 'test result: ok. 1 passed; 0 failed; 0 ignored',
      });
      expect(enforcer.currentPhase).toBe(TddPhase.FIX_VERIFIED);
      expect(enforcer.evaluateCompletion().allowedToComplete).toBe(true);
    });
  });
});
