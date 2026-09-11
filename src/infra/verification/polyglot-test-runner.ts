/**
 * Polyglot Test Runner & Verdict Extractor for SWE-bench Pro.
 *
 * Provides universal project ecosystem detection, test command synthesis,
 * and unified test verdict extraction across major software ecosystems:
 * - Rust (cargo test)
 * - Go (go test)
 * - Java (mvn test, gradle test)
 * - C/C++ (cmake / ctest, make test)
 * - Node / TypeScript (npm test, vitest, jest)
 * - Python (pytest, unittest)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export enum ProjectEcosystem {
  RUST = 'RUST',
  GO = 'GO',
  JAVA_MAVEN = 'JAVA_MAVEN',
  JAVA_GRADLE = 'JAVA_GRADLE',
  CPP_CMAKE = 'CPP_CMAKE',
  NODE = 'NODE',
  PYTHON = 'PYTHON',
  UNKNOWN = 'UNKNOWN',
}

export interface TestExecutionVerdict {
  readonly success: boolean;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly passRate: number; // 0.0 - 1.0
  readonly failedTestNames: ReadonlyArray<string>;
  readonly passedTestNames: ReadonlyArray<string>;
  readonly rawSummary?: string;
}

export class PolyglotTestRunner {
  /**
   * Detects the dominant programming language ecosystem from repository manifests.
   */
  static detectEcosystem(dirPath: string): ProjectEcosystem {
    if (!fs.existsSync(dirPath)) {
      return ProjectEcosystem.UNKNOWN;
    }

    if (fs.existsSync(path.join(dirPath, 'Cargo.toml'))) {
      return ProjectEcosystem.RUST;
    }
    if (fs.existsSync(path.join(dirPath, 'go.mod'))) {
      return ProjectEcosystem.GO;
    }
    if (fs.existsSync(path.join(dirPath, 'pom.xml'))) {
      return ProjectEcosystem.JAVA_MAVEN;
    }
    if (
      fs.existsSync(path.join(dirPath, 'build.gradle')) ||
      fs.existsSync(path.join(dirPath, 'build.gradle.kts'))
    ) {
      return ProjectEcosystem.JAVA_GRADLE;
    }
    if (fs.existsSync(path.join(dirPath, 'CMakeLists.txt'))) {
      return ProjectEcosystem.CPP_CMAKE;
    }
    if (fs.existsSync(path.join(dirPath, 'package.json'))) {
      return ProjectEcosystem.NODE;
    }
    if (
      fs.existsSync(path.join(dirPath, 'pytest.ini')) ||
      fs.existsSync(path.join(dirPath, 'pyproject.toml')) ||
      fs.existsSync(path.join(dirPath, 'setup.py')) ||
      fs.existsSync(path.join(dirPath, 'requirements.txt'))
    ) {
      return ProjectEcosystem.PYTHON;
    }

    return ProjectEcosystem.UNKNOWN;
  }

  /**
   * Returns the standard idiomatic test command for an ecosystem.
   */
  static getDefaultTestCommand(ecosystem: ProjectEcosystem): string {
    switch (ecosystem) {
      case ProjectEcosystem.RUST:
        return 'cargo test';
      case ProjectEcosystem.GO:
        return 'go test -v ./...';
      case ProjectEcosystem.JAVA_MAVEN:
        return 'mvn test';
      case ProjectEcosystem.JAVA_GRADLE:
        return 'gradle test';
      case ProjectEcosystem.CPP_CMAKE:
        return 'ctest --output-on-failure';
      case ProjectEcosystem.NODE:
        return 'npm test';
      case ProjectEcosystem.PYTHON:
        return 'pytest';
      default:
        return 'npm test';
    }
  }

  /**
   * Checks whether a given shell command is a recognizable test execution.
   */
  static isRecognizedTestCommand(command: string): boolean {
    return /(?:^|[\s;`"'])(\.\/gradlew\s+test|gradlew\s+test|gradle\s+test|cargo\s+test|go\s+test|mvn\s+(?:test|verify)|pytest|vitest|jest|ctest|npm\s+test|python(?:3)?\s+[\w./\\-]*repro[\w./\\-]*|node\s+[\w./\\-]*repro[\w./\\-]*|make\s+test)\b/i.test(
      command,
    );
  }

  /**
   * Parses raw tool execution stdout/stderr into a structured test verdict.
   */
  static parseVerdict(
    output: string,
    exitCode: number,
    _ecosystem: ProjectEcosystem = ProjectEcosystem.UNKNOWN,
  ): TestExecutionVerdict {
    const text = output ?? '';
    const failedTests: string[] = [];
    const passedTests: string[] = [];
    let passedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    // 1. Rust (cargo test)
    // Example: test result: FAILED. 4 passed; 2 failed; 1 ignored; 0 measured; 0 filtered out
    const rustSummaryMatch = text.match(
      /test result:\s*(?:ok|FAILED)\.\s*(\d+)\s*passed;\s*(\d+)\s*failed;\s*(\d+)\s*ignored/i,
    );
    if (rustSummaryMatch) {
      passedCount = parseInt(rustSummaryMatch[1]!, 10);
      failedCount = parseInt(rustSummaryMatch[2]!, 10);
      skippedCount = parseInt(rustSummaryMatch[3]!, 10);

      const rustFailMatches = text.matchAll(/----\s+([\w::]+)\s+stdout\s+----/g);
      for (const m of rustFailMatches) {
        if (m[1]) failedTests.push(m[1]);
      }
    }

    // 2. Go (go test -v)
    // Example: --- PASS: TestAdd (0.00s) | --- FAIL: TestDiv (0.00s)
    const goPassMatches = text.matchAll(/---\s+PASS:\s+(\w+)/g);
    for (const m of goPassMatches) {
      if (m[1]) {
        passedCount++;
        passedTests.push(m[1]);
      }
    }
    const goFailMatches = text.matchAll(/---\s+FAIL:\s+(\w+)/g);
    for (const m of goFailMatches) {
      if (m[1]) {
        failedCount++;
        failedTests.push(m[1]);
      }
    }

    // 3. Python (pytest)
    // Handles orders like "2 failed, 8 passed, 1 skipped in 0.42s" or "5 passed, 2 failed" or "1 passed in 0.05s"
    const passedMatch = text.match(/(\d+)\s+passed\b/i);
    const failedMatch = text.match(/(\d+)\s+failed\b/i);
    const skippedMatch = text.match(/(\d+)\s+skipped\b/i);
    const hasPytestSummary = Boolean(
      (passedMatch || failedMatch) &&
        (text.includes('test session starts') ||
          /===.*(?:passed|failed).*===/.test(text) ||
          /\bin\s+\d+(?:\.\d+)?s\b/i.test(text) ||
          text.includes('FAILED tests/')),
    );

    if (hasPytestSummary && !rustSummaryMatch && passedCount === 0) {
      if (passedMatch) passedCount = parseInt(passedMatch[1]!, 10);
      if (failedMatch) failedCount = parseInt(failedMatch[1]!, 10);
      if (skippedMatch) skippedCount = parseInt(skippedMatch[1]!, 10);

      const pytestFailMatches = text.matchAll(/FAILED\s+([\w./\\:-]+)/g);
      for (const m of pytestFailMatches) {
        if (m[1] && !failedTests.includes(m[1])) {
          failedTests.push(m[1]);
        }
      }
    }

    // 4. Java Maven / Gradle
    // Example: Tests run: 5, Failures: 1, Errors: 0, Skipped: 0
    const mavenSummaryMatch = text.match(
      /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/i,
    );
    if (mavenSummaryMatch && passedCount === 0) {
      const total = parseInt(mavenSummaryMatch[1]!, 10);
      const failures = parseInt(mavenSummaryMatch[2]!, 10) + parseInt(mavenSummaryMatch[3]!, 10);
      skippedCount = parseInt(mavenSummaryMatch[4]!, 10);
      failedCount = failures;
      passedCount = Math.max(0, total - failures - skippedCount);
    }

    // 5. CTest (CMake)
    // Example: 100% tests passed, 0 tests failed out of 10
    const ctestMatch = text.match(/(\d+)%\s+tests passed,\s*(\d+)\s+tests failed out of\s*(\d+)/i);
    if (ctestMatch && passedCount === 0) {
      failedCount = parseInt(ctestMatch[2]!, 10);
      const total = parseInt(ctestMatch[3]!, 10);
      passedCount = Math.max(0, total - failedCount);
    }

    // Fallback: If no structured summary matched, determine by exit code & explicit error markers
    if (passedCount === 0 && failedCount === 0) {
      const hasErrorPattern =
        /\b(?:FAIL|AssertionError|error TS\d+)\b/i.test(text) ||
        (/\bFAILED\b/i.test(text) && !/\b0\s+failed\b/i.test(text));

      if (exitCode === 0 && !hasErrorPattern) {
        passedCount = 1;
      } else {
        failedCount = 1;
      }
    }

    const totalTests = passedCount + failedCount;
    const passRate = totalTests > 0 ? passedCount / totalTests : exitCode === 0 ? 1.0 : 0.0;
    const success = exitCode === 0 && failedCount === 0;

    return {
      success,
      passedCount,
      failedCount,
      skippedCount,
      passRate,
      failedTestNames: failedTests,
      passedTestNames: passedTests,
      rawSummary: `${passedCount} passed, ${failedCount} failed (${(passRate * 100).toFixed(1)}%)`,
    };
  }
}
