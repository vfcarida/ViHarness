/**
 * Autonomous Judge-in-the-Loop Orchestrator.
 *
 * Closes the evaluation loop by automatically executing an external Online Judge (OJ)
 * or test harness command (e.g. ACMOJ, SWE-bench evaluation container, pytest, cargo test),
 * parsing verdicts (AC, WA, TLE, MLE, RE, CE), and driving iterative, targeted repair
 * cycles with diagnostic feedback injection.
 */
import { exec } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OjFeedbackIngester, type OjFeedbackPayload } from './oj-feedback-ingester.js';
import type { TestVerdict } from './projdevbench/types.js';

export interface JudgeExecutionResult {
  readonly verdict: TestVerdict;
  readonly isSuccess: boolean;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly feedback: OjFeedbackPayload;
}

export interface JudgeLoopOptions {
  readonly judgeCommand: string;
  readonly maxRetries?: number;
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly feedbackFile?: string;
  readonly logger?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  readonly runIteration: (
    attempt: number,
    feedbackPrompt?: string,
  ) => Promise<{ success: boolean; patch?: string }>;
}

export interface JudgeAttemptRecord {
  readonly attempt: number;
  readonly verdict: TestVerdict;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly score?: number;
  readonly failedTestCase?: string;
}

export interface JudgeLoopOutcome {
  readonly success: boolean;
  readonly totalAttempts: number;
  readonly finalVerdict: TestVerdict;
  readonly history: readonly JudgeAttemptRecord[];
  readonly lastFeedback?: OjFeedbackPayload;
}

export class JudgeInTheLoopOrchestrator {
  /**
   * Executes an external judge command and returns normalized verdict and feedback.
   */
  static async executeJudgeCommand(
    command: string,
    cwd: string,
    timeoutMs = 180000,
    feedbackFile?: string,
  ): Promise<JudgeExecutionResult> {
    const startTime = Date.now();

    return new Promise<JudgeExecutionResult>((resolve) => {
      let timedOut = false;
      const child = exec(
        command,
        {
          cwd,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          env: {
            ...process.env,
            CI: '1',
            NON_INTERACTIVE: '1',
          },
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - startTime;
          const exitCode = error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
          timedOut = error?.killed === true || timedOut;

          let feedback: OjFeedbackPayload = JudgeInTheLoopOrchestrator.inferFeedbackFromOutput(
            exitCode,
            stdout,
            stderr,
            timedOut,
          );

          // 1. Check if an explicit feedback file was specified or standard files exist
          const candidateFiles = [
            feedbackFile,
            path.join(cwd, 'verdict.json'),
            path.join(cwd, 'result.json'),
            path.join(cwd, 'oj_report.json'),
          ].filter((f): f is string => typeof f === 'string' && fs.existsSync(f));

          if (candidateFiles.length > 0 && candidateFiles[0]) {
            try {
              feedback = OjFeedbackIngester.parseFeedback(candidateFiles[0], cwd);
            } catch {
              feedback = JudgeInTheLoopOrchestrator.inferFeedbackFromOutput(
                exitCode,
                stdout,
                stderr,
                timedOut,
              );
            }
          } else {
            // 2. Attempt parsing stdout as inline JSON (exact match or embedded JSON block)
            const trimmedStdout = stdout.trim();
            let parsedFromJson = false;

            if (trimmedStdout.startsWith('{') && trimmedStdout.endsWith('}')) {
              try {
                feedback = OjFeedbackIngester.parseFeedback(trimmedStdout, cwd);
                parsedFromJson = true;
              } catch {
                // fallback to block search
              }
            }

            if (!parsedFromJson) {
              const jsonMatch = trimmedStdout.match(/\{[\s\S]*"verdict"[\s\S]*\}/);
              if (jsonMatch) {
                try {
                  feedback = OjFeedbackIngester.parseFeedback(jsonMatch[0], cwd);
                  parsedFromJson = true;
                } catch {
                  // fallback to heuristic inference
                }
              }
            }

            if (!parsedFromJson) {
              feedback = JudgeInTheLoopOrchestrator.inferFeedbackFromOutput(
                exitCode,
                stdout,
                stderr,
                timedOut,
              );
            }
          }

          const isSuccess = feedback.verdict === 'AC';

          resolve({
            verdict: feedback.verdict,
            isSuccess,
            exitCode,
            durationMs,
            stdout,
            stderr,
            feedback,
          });
        },
      );

      child.on('error', (err) => {
        const durationMs = Date.now() - startTime;
        const feedback = JudgeInTheLoopOrchestrator.inferFeedbackFromOutput(
          1,
          '',
          err.message,
          false,
        );
        resolve({
          verdict: feedback.verdict,
          isSuccess: false,
          exitCode: 1,
          durationMs,
          stdout: '',
          stderr: err.message,
          feedback,
        });
      });
    });
  }

  /**
   * Infers structured feedback and normalized verdict from command output and exit code.
   */
  static inferFeedbackFromOutput(
    exitCode: number,
    stdout: string,
    stderr: string,
    timedOut = false,
  ): OjFeedbackPayload {
    const combined = `${stdout}\n${stderr}`;

    if (timedOut || combined.includes('timed out') || combined.includes('TimeLimitExceeded')) {
      return {
        verdict: 'TLE',
        feedbackSummary: 'Execution exceeded the allotted time limit.',
        rawLog: combined,
      };
    }

    if (
      combined.includes('out of memory') ||
      combined.includes('JavaScript heap out of memory') ||
      combined.includes('MemoryLimitExceeded')
    ) {
      return {
        verdict: 'MLE',
        feedbackSummary: 'Execution exceeded maximum virtual memory constraints.',
        rawLog: combined,
      };
    }

    const isCompilationFailure =
      combined.includes('error: ') ||
      combined.includes('fatal error:') ||
      combined.includes('compilation terminated') ||
      combined.includes('syntax error') ||
      combined.includes('failed to compile') ||
      combined.includes('TypeScript error TS') ||
      combined.includes('make: *** [') ||
      combined.includes('ninja: build stopped');

    if (isCompilationFailure && exitCode !== 0) {
      return {
        verdict: 'CE',
        compilerErrorOutput: combined.slice(-4000),
        feedbackSummary: 'Compilation/build failed with compiler errors.',
        rawLog: combined,
      };
    }

    const isRuntimeCrash =
      combined.includes('Segmentation fault') ||
      combined.includes('core dumped') ||
      combined.includes('SIGSEGV') ||
      combined.includes('SIGABRT') ||
      combined.includes('panic: ') ||
      combined.includes('Uncaught exception');

    if (isRuntimeCrash) {
      return {
        verdict: 'RE',
        runtimeErrorOutput: combined.slice(-4000),
        feedbackSummary: 'Application terminated abnormally with a runtime exception or crash.',
        rawLog: combined,
      };
    }

    if (exitCode === 0) {
      // Check for test runners that return exit code 0 even on test failures or output warning strings
      const hasFailedTests =
        /failed/i.test(combined) && !combined.includes('0 failed') && !combined.includes('0 failures');

      if (hasFailedTests && (combined.includes('FAIL') || combined.includes('FAILED'))) {
        return {
          verdict: 'WA',
          feedbackSummary: 'Judge completed with exit code 0 but reported test assertion failures.',
          rawLog: combined,
        };
      }

      return {
        verdict: 'AC',
        score: 100,
        feedbackSummary: 'All judge tests and acceptance criteria passed successfully.',
        rawLog: combined,
      };
    }

    return {
      verdict: 'WA',
      feedbackSummary: `Judge returned non-zero exit code (${exitCode}) with test failures.`,
      rawLog: combined,
    };
  }

  /**
   * Runs the full closed-loop iterative repair workflow.
   */
  static async runInteractiveLoop(options: JudgeLoopOptions): Promise<JudgeLoopOutcome> {
    const maxRetries = Math.max(1, options.maxRetries ?? 3);
    const history: JudgeAttemptRecord[] = [];
    let currentFeedbackPrompt: string | undefined;
    let lastFeedback: OjFeedbackPayload | undefined;

    const log = options.logger ?? {
      info: (msg: string): void => console.log(`[JudgeLoop] ${msg}`),
      warn: (msg: string): void => console.warn(`[JudgeLoop] ${msg}`),
      error: (msg: string): void => console.error(`[JudgeLoop] ${msg}`),
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      log.info(`--- Judge-in-the-Loop: Attempt ${attempt}/${maxRetries} ---`);

      // 1. Run agent solve iteration
      const iterationResult = await options.runIteration(attempt, currentFeedbackPrompt);
      if (!iterationResult.success && attempt === maxRetries) {
        log.warn(`Agent solve iteration failed on attempt ${attempt}.`);
      }

      // 2. Evaluate solution against external judge command
      log.info(`Executing judge command: "${options.judgeCommand}"...`);
      const judgeRes = await JudgeInTheLoopOrchestrator.executeJudgeCommand(
        options.judgeCommand,
        options.cwd,
        options.timeoutMs,
        options.feedbackFile,
      );

      lastFeedback = judgeRes.feedback;

      history.push({
        attempt,
        verdict: judgeRes.verdict,
        exitCode: judgeRes.exitCode,
        durationMs: judgeRes.durationMs,
        score: judgeRes.feedback.score,
        failedTestCase: judgeRes.feedback.failedTestCase,
      });

      log.info(
        `Attempt ${attempt} Verdict: [${judgeRes.verdict}] (exitCode: ${judgeRes.exitCode}, duration: ${judgeRes.durationMs}ms)`,
      );

      // 3. Check for victory condition
      if (judgeRes.isSuccess) {
        log.info(`🎉 Judge verdict ACCEPTED on attempt ${attempt}/${maxRetries}!`);
        return {
          success: true,
          totalAttempts: attempt,
          finalVerdict: 'AC',
          history,
          lastFeedback,
        };
      }

      // 4. Prepare diagnostic feedback for next repair attempt
      if (attempt < maxRetries) {
        currentFeedbackPrompt = OjFeedbackIngester.formatFeedbackPrompt(judgeRes.feedback);
        log.warn(
          `Targeted repair needed for verdict [${judgeRes.verdict}]. Feeding diagnostic to attempt ${attempt + 1}...`,
        );
      }
    }

    const finalVerdict = history[history.length - 1]?.verdict ?? 'WA';
    log.error(`Judge-in-the-Loop exhausted ${maxRetries} attempts. Final verdict: [${finalVerdict}].`);

    return {
      success: false,
      totalAttempts: maxRetries,
      finalVerdict,
      history,
      lastFeedback,
    };
  }
}
