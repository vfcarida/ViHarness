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

import { PolyglotTestRunner } from './polyglot-test-runner.js';

export enum TddPhase {
  INITIAL = 'INITIAL',                         // No reproduction attempt yet
  REPRODUCER_CONFIRMED = 'REPRODUCER_CONFIRMED', // Reproducer ran and failed (Red phase verified)
  FIX_VERIFIED = 'FIX_VERIFIED',               // Reproducer ran and passed after code edit (Green phase verified)
}

export interface TddEnforcerOptions {
  readonly initialPhase?: TddPhase;
  readonly kPassRepeats?: number;
}

export interface TddEvaluationResult {
  readonly allowedToComplete: boolean;
  readonly phase: TddPhase;
  readonly feedbackMessage?: string;
  readonly reproCommand?: string;
  readonly consecutivePasses?: number;
  readonly requiredPasses?: number;
  readonly flakinessDetected?: boolean;
}

export class TddEnforcer {
  private phase: TddPhase = TddPhase.INITIAL;
  private reproCommand?: string;
  private modifiedFilesCount: number = 0;
  private hasRanReproducerBeforeEdit: boolean = false;
  private readonly kPassRepeats: number;
  private consecutivePasses: number = 0;
  private flakinessDetected: boolean = false;
  private totalPasses: number = 0;
  private totalFailuresAfterRepro: number = 0;

  constructor(initialPhaseOrOptions?: TddPhase | TddEnforcerOptions) {
    if (typeof initialPhaseOrOptions === 'object' && initialPhaseOrOptions !== null) {
      this.phase = initialPhaseOrOptions.initialPhase ?? TddPhase.INITIAL;
      this.kPassRepeats = Math.max(1, Math.min(10, Math.floor(initialPhaseOrOptions.kPassRepeats ?? 1)));
    } else if (typeof initialPhaseOrOptions === 'string') {
      this.phase = initialPhaseOrOptions;
      this.kPassRepeats = 1;
    } else {
      this.phase = TddPhase.INITIAL;
      this.kPassRepeats = 1;
    }
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

  get kPass(): number {
    return this.kPassRepeats;
  }

  get currentConsecutivePasses(): number {
    return this.consecutivePasses;
  }

  get isFlaky(): boolean {
    return this.flakinessDetected;
  }

  get totalVerificationPasses(): number {
    return this.totalPasses;
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
        // Did it fail?
        const verdict = PolyglotTestRunner.parseVerdict(output ?? '', exitCode ?? 0);
        const failed = !verdict.success;

        if (this.phase === TddPhase.INITIAL) {
          if (failed) {
            // Excellent! The test reproduced the bug (Red phase confirmed)
            this.phase = TddPhase.REPRODUCER_CONFIRMED;
            this.reproCommand = command;
            this.consecutivePasses = 0;
            if (this.modifiedFilesCount === 0) {
              this.hasRanReproducerBeforeEdit = true;
            }
          }
        } else if (this.phase === TddPhase.REPRODUCER_CONFIRMED) {
          if (!failed && exitCode === 0) {
            this.consecutivePasses++;
            this.totalPasses++;
            this.reproCommand = command;
            if (this.consecutivePasses >= this.kPassRepeats) {
              // Reached required consecutive passes!
              this.phase = TddPhase.FIX_VERIFIED;
            }
          } else if (failed) {
            if (this.consecutivePasses > 0) {
              // Was passing, now failed: test is flaky!
              this.flakinessDetected = true;
            }
            this.consecutivePasses = 0;
            this.totalFailuresAfterRepro++;
          }
        } else if (this.phase === TddPhase.FIX_VERIFIED) {
          if (failed) {
            // Regression or flakiness detected after reaching FIX_VERIFIED
            this.flakinessDetected = true;
            this.phase = TddPhase.REPRODUCER_CONFIRMED;
            this.consecutivePasses = 0;
            this.totalFailuresAfterRepro++;
          } else if (!failed && exitCode === 0) {
            this.consecutivePasses++;
            this.totalPasses++;
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
        consecutivePasses: this.consecutivePasses,
        requiredPasses: this.kPassRepeats,
        flakinessDetected: this.flakinessDetected,
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
        consecutivePasses: 0,
        requiredPasses: this.kPassRepeats,
        flakinessDetected: false,
      };
    }

    // Phase is REPRODUCER_CONFIRMED
    if (this.consecutivePasses > 0 && this.consecutivePasses < this.kPassRepeats) {
      const remaining = this.kPassRepeats - this.consecutivePasses;
      return {
        allowedToComplete: false,
        phase: this.phase,
        reproCommand: this.reproCommand,
        consecutivePasses: this.consecutivePasses,
        requiredPasses: this.kPassRepeats,
        flakinessDetected: this.flakinessDetected,
        feedbackMessage:
          `[TDD-Agent Enforcer Determinism Notice]: Reproduction test passed ${this.consecutivePasses}/${this.kPassRepeats} required consecutive run(s).\n` +
          `K-Pass verification gate requires ${this.kPassRepeats} consecutive clean passes to ensure non-flakiness and test determinism.\n` +
          `Please re-run your reproduction command '${this.reproCommand}' ${remaining} more time(s) to verify stability.`,
      };
    }

    if (this.flakinessDetected && this.consecutivePasses === 0) {
      return {
        allowedToComplete: false,
        phase: this.phase,
        reproCommand: this.reproCommand,
        consecutivePasses: 0,
        requiredPasses: this.kPassRepeats,
        flakinessDetected: true,
        feedbackMessage:
          `[TDD-Agent Enforcer Flakiness Alert]: Test flakiness or intermittent failure detected for '${this.reproCommand}'!\n` +
          `The test passed previously but failed on subsequent verification. Consecutive pass count reset to 0/${this.kPassRepeats}.\n` +
          `Please investigate race conditions, unseeded randomness, or unhandled edge cases, and achieve ${this.kPassRepeats} consecutive passes before completing.`,
      };
    }

    // Standard Red phase confirmed, waiting for Green phase
    return {
      allowedToComplete: false,
      phase: this.phase,
      reproCommand: this.reproCommand,
      consecutivePasses: 0,
      requiredPasses: this.kPassRepeats,
      flakinessDetected: this.flakinessDetected,
      feedbackMessage:
        `[TDD-Agent Enforcer Notice]: Task cannot finish yet! Reproduction test was confirmed failing (${this.reproCommand}), ` +
        'but it has not yet been verified to PASS after your code edits.\n' +
        'Please re-run your reproduction command with `run_command` to verify that all assertions now succeed.',
    };
  }

  /**
   * Formats contract guidelines for the task prompt.
   */
  static getGuidanceContract(kPassRepeats: number = 1): string {
    const kPassClause =
      kPassRepeats > 1
        ? ` It MUST pass cleanly ${kPassRepeats} consecutive times with exit code 0 to eliminate flakiness and satisfy the K-Pass determinism gate.`
        : ' It MUST now PASS with exit code 0.';

    return (
      '\n[AUTONOMOUS TEST-DRIVEN DEVELOPMENT (TDD) CONTRACT]:\n' +
      'This workspace enforces a strict Red-Green TDD verification protocol:\n' +
      '1. Step 1 (Reproduce / RED): Before modifying production code, write a minimal reproduction script or test (e.g. repro.py, test_repro.ts, or a small test binary) that isolates the problem. Run it with `run_command` and ensure it FAILS.\n' +
      '2. Step 2 (Fix / GREEN): Apply targeted modifications to the production source code using `edit_file`.\n' +
      `3. Step 3 (Verify): Re-run your reproduction test with \`run_command\`.${kPassClause}\n` +
      '4. Step 4 (Regression): Run the repository\'s existing test suite to ensure no collateral breakage.\n' +
      'The agent loop will reject premature conclusions if the reproduction test has not been proven to transition from FAIL to PASS.'
    );
  }

  private isTestCommand(command: string): boolean {
    return PolyglotTestRunner.isRecognizedTestCommand(command);
  }
}
