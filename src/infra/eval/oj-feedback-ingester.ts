/**
 * Online Judge (OJ) & Benchmark Feedback Ingester.
 *
 * Facilitates native iterative repair loops across ACMOJ, SWE-bench, and ProjDevBench:
 * Parses external judge verdicts (AC, WA, TLE, MLE, RE, CE) and execution logs,
 * converting them into structured diagnostic instructions that guide the agent
 * through targeted repair without requiring external bash runner workarounds.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TestVerdict } from './projdevbench/types.js';

export interface OjFeedbackPayload {
  readonly verdict: TestVerdict;
  readonly score?: number;
  readonly failedTestCase?: string;
  readonly compilerErrorOutput?: string;
  readonly runtimeErrorOutput?: string;
  readonly expectedOutput?: string;
  readonly actualOutput?: string;
  readonly timeUsedMs?: number;
  readonly memoryUsedKb?: number;
  readonly feedbackSummary?: string;
  readonly rawLog?: string;
  readonly source?: string;
}

export class OjFeedbackIngester {
  /**
   * Parses OJ feedback from raw string (file path or inline JSON) or an existing object.
   * Resolves relative file paths against cwd if provided.
   */
  static parseFeedback(input: string | Record<string, unknown>, cwd?: string): OjFeedbackPayload {
    let data: Record<string, unknown>;
    let source: string | undefined;

    if (typeof input === 'string') {
      const trimmed = input.trim();
      let resolvedPath = trimmed;
      if (cwd && !path.isAbsolute(trimmed)) {
        const candidate = path.resolve(cwd, trimmed);
        if (fs.existsSync(candidate)) {
          resolvedPath = candidate;
        }
      }

      if (fs.existsSync(resolvedPath)) {
        source = resolvedPath;
        const fileContent = fs.readFileSync(resolvedPath, 'utf-8');
        try {
          data = JSON.parse(fileContent);
        } catch {
          data = { feedbackSummary: fileContent, rawLog: fileContent };
        }
      } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        source = 'inline-json';
        try {
          data = JSON.parse(trimmed);
        } catch {
          data = { feedbackSummary: trimmed, rawLog: trimmed };
        }
      } else {
        source = 'raw-string';
        data = { feedbackSummary: trimmed, rawLog: trimmed };
      }
    } else {
      source = 'object';
      data = input;
    }

    // Extract verdict with normalization
    let verdict: TestVerdict = 'WA';
    const rawVerdict = String(
      data['verdict'] ?? data['status'] ?? data['result'] ?? '',
    ).toUpperCase();

    if (rawVerdict.includes('AC') || rawVerdict.includes('ACCEPTED')) {
      verdict = 'AC';
    } else if (rawVerdict.includes('TLE') || rawVerdict.includes('TIME_LIMIT')) {
      verdict = 'TLE';
    } else if (rawVerdict.includes('MLE') || rawVerdict.includes('MEMORY_LIMIT')) {
      verdict = 'MLE';
    } else if (rawVerdict.includes('CE') || rawVerdict.includes('COMPILE_ERROR') || rawVerdict.includes('COMPILATION')) {
      verdict = 'CE';
    } else if (rawVerdict.includes('RE') || rawVerdict.includes('RUNTIME_ERROR')) {
      verdict = 'RE';
    } else {
      verdict = 'WA';
    }

    return {
      verdict,
      score: typeof data['score'] === 'number' ? data['score'] : undefined,
      failedTestCase: data['failedTestCase'] ? String(data['failedTestCase']) : data['test_case'] ? String(data['test_case']) : undefined,
      compilerErrorOutput: data['compilerErrorOutput'] ? String(data['compilerErrorOutput']) : data['compile_error'] ? String(data['compile_error']) : undefined,
      runtimeErrorOutput: data['runtimeErrorOutput'] ? String(data['runtimeErrorOutput']) : data['runtime_error'] ? String(data['runtime_error']) : undefined,
      expectedOutput: data['expectedOutput'] ? String(data['expectedOutput']) : undefined,
      actualOutput: data['actualOutput'] ? String(data['actualOutput']) : undefined,
      timeUsedMs: typeof data['timeUsedMs'] === 'number' ? data['timeUsedMs'] : typeof data['time_ms'] === 'number' ? data['time_ms'] : undefined,
      memoryUsedKb: typeof data['memoryUsedKb'] === 'number' ? data['memoryUsedKb'] : typeof data['memory_kb'] === 'number' ? data['memory_kb'] : undefined,
      feedbackSummary: data['feedbackSummary'] ? String(data['feedbackSummary']) : data['summary'] ? String(data['summary']) : undefined,
      rawLog: data['rawLog'] ? String(data['rawLog']) : undefined,
      source,
    };
  }

  /**
   * Formats structured feedback into a prompt extension for the agent runtime.
   */
  static formatFeedbackPrompt(feedback: OjFeedbackPayload): string {
    const lines: string[] = [
      `\n============================================================`,
      `[ONLINE JUDGE / BENCHMARK FEEDBACK INGESTION]`,
      `The previous attempt was evaluated by the automated testing judge and returned verdict: [${feedback.verdict}]`,
    ];

    if (feedback.score !== undefined) {
      lines.push(`Score: ${feedback.score} / 100`);
    }
    if (feedback.failedTestCase) {
      lines.push(`Failed Test Case: ${feedback.failedTestCase}`);
    }
    if (feedback.timeUsedMs !== undefined) {
      lines.push(`Time Elapsed: ${feedback.timeUsedMs}ms`);
    }
    if (feedback.memoryUsedKb !== undefined) {
      lines.push(`Memory Consumed: ${(feedback.memoryUsedKb / 1024).toFixed(2)} MB`);
    }

    lines.push(`\nActionable Repair Guidance:`);
    switch (feedback.verdict) {
      case 'CE':
        lines.push(`- Verdict is COMPILATION ERROR (CE). The project failed to build on the judge.`);
        lines.push(`- Check CMakeLists.txt, Makefiles, compiler warnings treated as errors, and missing header imports.`);
        if (feedback.compilerErrorOutput) {
          lines.push(`- Compiler Diagnostic Output:\n${feedback.compilerErrorOutput}`);
        }
        break;

      case 'TLE':
        lines.push(`- Verdict is TIME LIMIT EXCEEDED (TLE). The program did not terminate in time.`);
        lines.push(`- Inspect loops, recursion, and worst-case algorithmic complexity. Avoid O(N^2) or unbounded polling.`);
        break;

      case 'MLE':
        lines.push(`- Verdict is MEMORY LIMIT EXCEEDED (MLE). The program consumed excessive RAM.`);
        lines.push(`- Check dynamic allocations, unbounded caches, recursion depth, and free all unused data structures.`);
        break;

      case 'RE':
        lines.push(`- Verdict is RUNTIME ERROR (RE). The program crashed with SIGSEGV, SIGABRT, unhandled exception, or non-zero exit code.`);
        lines.push(`- Inspect bounds checks, null pointer dereferences, array indices, and division by zero.`);
        if (feedback.runtimeErrorOutput) {
          lines.push(`- Crash Details:\n${feedback.runtimeErrorOutput}`);
        }
        break;

      case 'WA':
        lines.push(`- Verdict is WRONG ANSWER (WA). Output does not match expected reference.`);
        if (feedback.expectedOutput && feedback.actualOutput) {
          lines.push(`- Expected: ${feedback.expectedOutput}`);
          lines.push(`- Actual:   ${feedback.actualOutput}`);
        }
        lines.push(`- Verify edge cases, off-by-one errors, formatting (trailing newlines, spaces), and specification constraints.`);
        break;

      case 'AC':
        lines.push(`- Verdict is ACCEPTED (AC). Solution passed all tests!`);
        break;
    }

    if (feedback.feedbackSummary) {
      lines.push(`\nSummary: ${feedback.feedbackSummary}`);
    }
    if (feedback.rawLog) {
      lines.push(`\nRaw Judge Log:\n${feedback.rawLog}`);
    }

    lines.push(`============================================================\n`);
    return lines.join('\n');
  }
}
