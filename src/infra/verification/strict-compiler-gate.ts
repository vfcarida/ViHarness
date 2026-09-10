/**
 * Strict Compiler & Warning-as-Error Gate.
 *
 * In strict evaluation harnesses (e.g. ACMOJ, SWE-bench judges, competitive programming judges),
 * code is compiled with `-Wall -Wextra -Werror` or strict typing. Compiler warnings that might pass
 * locally become fatal `compile_error` verdicts on remote evaluation runners.
 *
 * This gate inspects command execution output for compiler warnings across GCC, Clang, Rustc,
 * CMake, MSVC, and TypeScript, converting warnings into actionable tool failures so the agent
 * is forced to eliminate all warnings before concluding.
 */

export interface CompilerWarningDiagnostic {
  readonly compiler: 'gcc/clang' | 'rustc' | 'cmake' | 'msvc' | 'typescript' | 'generic';
  readonly warningCount: number;
  readonly warningLines: ReadonlyArray<string>;
  readonly feedbackMessage: string;
}

const BUILD_COMMAND_PATTERNS = [
  /(?:^|\s|[;&|])(?:g\+\+|gcc|clang\+\+|clang|make|cmake|javac|tsc)(?:\s|$|[;&|])/i,
  /\bcargo\s+(?:build|check|test)\b/i,
  /\bdotnet\s+build\b/i,
  /\bnpm\s+run\s+build\b/i,
];

const COMPILER_WARNING_REGEXES: Array<{
  compiler: CompilerWarningDiagnostic['compiler'];
  regex: RegExp;
}> = [
  {
    compiler: 'gcc/clang',
    regex: /(?:^|\n)(?:[a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9_]+:\d+:\d+:\s+warning:\s+[^\n]+|warning:\s+[^\n]+)/g,
  },
  {
    compiler: 'rustc',
    regex: /(?:^|\n)warning:\s+[^\n]+(?:\n\s*-->\s+[^\n]+)?/g,
  },
  {
    compiler: 'cmake',
    regex: /(?:^|\n)CMake Warning(?:\s+\(dev\))? at [^\n]+:[^\n]+/g,
  },
  {
    compiler: 'msvc',
    regex: /(?:^|\n)[a-zA-Z0-9_./\\-]+\(\d+,\d+\):\s+warning\s+[A-Z0-9]+:\s+[^\n]+/g,
  },
  {
    compiler: 'typescript',
    regex: /(?:^|\n)[a-zA-Z0-9_./\\-]+\(\d+,\d+\):\s+error\s+TS\d+:[^\n]+|(?:^|\n)warning\s+TS\d+:[^\n]+/g,
  },
];

export class StrictCompilerGate {
  /**
   * Determines if a shell command is a build or compilation command.
   */
  static isBuildCommand(command: string): boolean {
    const trimmed = command.trim();
    return BUILD_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed));
  }

  /**
   * Inspects command output for compiler warnings.
   */
  static inspectOutput(command: string, output: string): CompilerWarningDiagnostic | null {
    if (!output || !this.isBuildCommand(command)) {
      return null;
    }

    const matchedLines: string[] = [];
    let detectedCompiler: CompilerWarningDiagnostic['compiler'] = 'generic';

    for (const { compiler, regex } of COMPILER_WARNING_REGEXES) {
      const matches = output.match(regex);
      if (matches && matches.length > 0) {
        detectedCompiler = compiler;
        for (const m of matches) {
          const cleanLine = m.trim();
          if (cleanLine && !matchedLines.includes(cleanLine)) {
            matchedLines.push(cleanLine);
          }
        }
      }
    }

    // Generic fallback for any other "warning:" lines
    if (matchedLines.length === 0) {
      const genericMatches = output.match(/(?:^|\n)[^\n]*\bwarning\s*:[^\n]*/gi);
      if (genericMatches) {
        for (const m of genericMatches) {
          const clean = m.trim();
          // Exclude benign npm or harmless warning banners
          if (clean && !clean.includes('npm WARN') && !clean.includes('Browserslist:')) {
            matchedLines.push(clean);
          }
        }
      }
    }

    if (matchedLines.length === 0) {
      return null;
    }

    const preview = matchedLines.slice(0, 10).join('\n');
    const extraCount = matchedLines.length > 10 ? `\n... and ${matchedLines.length - 10} more warnings` : '';

    const feedbackMessage = [
      `[Vi-Harness Strict Compiler Gate]: Compilation produced ${matchedLines.length} warning(s).`,
      `Strict evaluation environments (such as ACMOJ, SWE-bench, and competitive programming judges) compile with '-Wall -Wextra -Werror' and reject solutions with compiler warnings as fatal compile_error.`,
      `You MUST resolve all warnings below before concluding the task:`,
      `--- Compiler Warnings ---`,
      preview + extraCount,
      `-------------------------`,
    ].join('\n');

    return {
      compiler: detectedCompiler,
      warningCount: matchedLines.length,
      warningLines: matchedLines,
      feedbackMessage,
    };
  }
}
