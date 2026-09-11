/**
 * Rollout Trajectory Distiller.
 *
 * Distills raw agent trajectories into structured findings, error roots,
 * and avoided pitfalls for subsequent speculative rollouts.
 */
import type { RolloutFinding } from './types.js';

export interface DistillParams {
  readonly rolloutIndex: number;
  readonly workspacePath: string;
  readonly success: boolean;
  readonly toolResults?: ReadonlyArray<{
    readonly toolName?: string;
    readonly command?: string;
    readonly filePath?: string;
    readonly exitCode?: number;
    readonly output?: string;
  }>;
  readonly patch?: string;
}

export class RolloutDistiller {
  /**
   * Distills an execution attempt into a structured RolloutFinding.
   */
  static distill(params: DistillParams): RolloutFinding {
    const { rolloutIndex, workspacePath, success, toolResults = [], patch } = params;

    const failedCommands: string[] = [];
    const errorSnippets: string[] = [];
    const modifiedFilesSet = new Set<string>();
    let compilerWarnings = 0;
    let testPasses = 0;
    let testAttempts = 0;

    // Extract modified files from patch if present
    if (patch) {
      const fileMatches = patch.match(/diff --git a\/(.*?) b\//g);
      if (fileMatches) {
        for (const fm of fileMatches) {
          const m = fm.match(/diff --git a\/(.*?) b\//);
          if (m?.[1]) {
            modifiedFilesSet.add(m[1]);
          }
        }
      }
    }

    for (const r of toolResults) {
      // 1. Track modified files
      if (r.toolName === 'write_file' || r.toolName === 'edit_file') {
        if (r.filePath) {
          modifiedFilesSet.add(r.filePath);
        }
      }

      // 2. Track command execution outcomes
      if (r.command) {
        const out = r.output ?? '';
        const failed = (r.exitCode !== undefined && r.exitCode !== 0) ||
          /\b(?:FAIL|FAILED|AssertionError|assert|error TS\d+|fatal error|compile_error)\b/i.test(out);

        const isTest = /\b(?:test|pytest|vitest|jest|npm\s+test|ctest|cargo\s+test)\b/i.test(r.command);
        if (isTest) {
          testAttempts++;
          if (!failed && r.exitCode === 0) {
            testPasses++;
          }
        }

        if (failed) {
          failedCommands.push(r.command);

          // Extract meaningful error lines
          const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
          for (const line of lines) {
            if (
              /\b(?:AssertionError|Error:|TypeError|ValueError|ReferenceError|NullPointerException|FAILED|SyntaxError)\b/i.test(
                line,
              )
            ) {
              if (errorSnippets.length < 5 && !errorSnippets.includes(line)) {
                errorSnippets.push(line.slice(0, 120));
              }
            }
          }
        }

        // Count compiler warnings
        const warningMatches = out.match(/\b(?:warning|warn)(?::|\s+TS\d+)/gi);
        if (warningMatches) {
          compilerWarnings += warningMatches.length;
        }
      }
    }

    const modifiedFiles = Array.from(modifiedFilesSet);
    const testPassRate = testAttempts > 0 ? testPasses / testAttempts : success ? 1.0 : 0.0;

    // Synthesize concise summary
    const summaryLines: string[] = [];
    if (success) {
      summaryLines.push(`Rollout #${rolloutIndex} succeeded (100% test pass rate).`);
    } else {
      summaryLines.push(
        `Rollout #${rolloutIndex} encountered failures in ${failedCommands.length} command(s).`,
      );
      if (errorSnippets.length > 0) {
        summaryLines.push(`Primary errors encountered: ${errorSnippets.slice(0, 2).join(' | ')}`);
      }
      if (modifiedFiles.length > 0) {
        summaryLines.push(`Modified files: ${modifiedFiles.slice(0, 3).join(', ')}`);
      }
    }

    return {
      rolloutIndex,
      workspacePath,
      success,
      failedCommands,
      errorSnippets,
      modifiedFiles,
      compilerWarnings,
      testPassRate,
      distilledSummary: summaryLines.join(' '),
    };
  }
}
