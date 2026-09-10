/**
 * Autonomous Test-Driven Development (TDD) Enforcer & Reproducer Watchdog.
 *
 * Implements SOTA SWE-bench / ProjDevBench TDD-Agent Scaffolding:
 * - Demands a standalone reproduction test case before modifying existing source code.
 * - Enforces the Red -> Green lifecycle:
 *   1. Red: Reproduction script MUST fail first (confirming the defect or missing functionality).
 *   2. Green: After code modifications, the reproduction script MUST pass.
 *   3. Regression Check: Existing project tests must pass without breakage.
 * - Prevents false-positive completions where an agent hallucinates a fix without testing it.
 */

export enum TddPhase {
  INITIAL = 'INITIAL',                         // No reproduction attempt yet
  REPRODUCER_CONFIRMED = 'REPRODUCER_CONFIRMED', // Reproducer ran and failed (Red phase verified)
  FIX_VERIFIED = 'FIX_VERIFIED',               // Reproducer ran and passed after code edit (Green phase verified)
}

export interface TddEvaluationResult {
  readonly allowedToComplete: boolean;
  readonly phase: TddPhase;
  readonly feedbackMessage?: string;
  readonly reproCommand?: string;
}

export class TddEnforcer {
  private phase: TddPhase = TddPhase.INITIAL;
  private reproCommand?: string;
  private modifiedFilesCount: number = 0;
  private hasRanReproducerBeforeEdit: boolean = false;

  constructor(initialPhase: TddPhase = TddPhase.INITIAL) {
    this.phase = initialPhase;
  }

  get currentPhase(): TddPhase {
    return this.phase;
  }

  get lastReproCommand(): string | undefined {
    return this.reproCommand;
  }

  get ranReproducerBeforeEdit(): boolean {
    return this.hasRanReproducerBeforeEdit;
  }

  /**
   * Evaluates a tool execution event to track TDD progression.
   */
  recordAction(params: {
    toolName: string;
    command?: string;
    filePath?: string;
    exitCode?: number;
    output?: string;
  }): void {
    const { toolName, command, filePath, exitCode, output } = params;

    // 1. Detect file modifications (write_file, edit_file)
    if (toolName === 'write_file' || toolName === 'edit_file') {
      const isReproFile = Boolean(
        filePath &&
          /\b(?:repro|reproduce|reproducer|test_repro|issue_\w+)\b/i.test(filePath),
      );

      if (!isReproFile) {
        this.modifiedFilesCount++;
      }
      return;
    }

    // 2. Detect test / command executions
    if (toolName === 'run_command' && command) {
      const isTestCmd = this.isTestCommand(command);

      if (isTestCmd) {
        // Did it fail initially?
        const failed = exitCode !== 0 || (output && /\b(?:FAIL|FAILED|AssertionError|assert)\b/i.test(output));

        if (this.phase === TddPhase.INITIAL) {
          if (failed) {
            // Excellent! The test reproduced the bug (Red phase confirmed)
            this.phase = TddPhase.REPRODUCER_CONFIRMED;
            this.reproCommand = command;
            if (this.modifiedFilesCount === 0) {
              this.hasRanReproducerBeforeEdit = true;
            }
          }
        } else if (this.phase === TddPhase.REPRODUCER_CONFIRMED) {
          if (!failed && exitCode === 0) {
            // Excellent! The test now passes (Green phase confirmed)
            this.phase = TddPhase.FIX_VERIFIED;
            this.reproCommand = command;
          }
        }
      }
    }
  }

  /**
   * Checks whether the agent is allowed to conclude the task.
   */
  evaluateCompletion(): TddEvaluationResult {
    if (this.phase === TddPhase.FIX_VERIFIED) {
      return {
        allowedToComplete: true,
        phase: this.phase,
        reproCommand: this.reproCommand,
      };
    }

    if (this.phase === TddPhase.INITIAL) {
      return {
        allowedToComplete: false,
        phase: this.phase,
        feedbackMessage:
          '[TDD-Agent Enforcer Notice]: Task cannot finish yet! Autonomous TDD mode is active.\n' +
          '1. You MUST first create or run a reproduction script that demonstrates the bug or missing requirement.\n' +
          '2. The reproduction test MUST fail initially (verifying the defect exists).\n' +
          '3. Only then apply your fix with edit_file and verify that the reproduction test passes.\n' +
          'Please execute your reproduction test with `run_command`.',
      };
    }

    // Phase is REPRODUCER_CONFIRMED (Red phase confirmed, but Green phase not yet achieved)
    return {
      allowedToComplete: false,
      phase: this.phase,
      reproCommand: this.reproCommand,
      feedbackMessage:
        `[TDD-Agent Enforcer Notice]: Task cannot finish yet! Reproduction test was confirmed failing (${this.reproCommand}), ` +
        'but it has not yet been verified to PASS after your code edits.\n' +
        'Please re-run your reproduction command with `run_command` to verify that all assertions now succeed.',
    };
  }

  /**
   * Formats contract guidelines for the task prompt.
   */
  static getGuidanceContract(): string {
    return (
      '\n[AUTONOMOUS TEST-DRIVEN DEVELOPMENT (TDD) CONTRACT]:\n' +
      'This workspace enforces a strict Red-Green TDD verification protocol:\n' +
      '1. Step 1 (Reproduce / RED): Before modifying production code, write a minimal reproduction script or test (e.g. repro.py, test_repro.ts, or a small test binary) that isolates the problem. Run it with `run_command` and ensure it FAILS.\n' +
      '2. Step 2 (Fix / GREEN): Apply targeted modifications to the production source code using `edit_file`.\n' +
      '3. Step 3 (Verify): Re-run your reproduction test with `run_command`. It MUST now PASS with exit code 0.\n' +
      '4. Step 4 (Regression): Run the repository\'s existing test suite to ensure no collateral breakage.\n' +
      'The agent loop will reject premature conclusions if the reproduction test has not been proven to transition from FAIL to PASS.'
    );
  }

  private isTestCommand(command: string): boolean {
    return /\b(?:pytest|vitest|jest|ctest|npm\s+test|python(?:3)?\s+[\w./\\-]*repro[\w./\\-]*|node\s+[\w./\\-]*repro[\w./\\-]*|cargo\s+test|make\s+test|mvn\s+test|go\s+test)\b/i.test(
      command,
    );
  }
}
