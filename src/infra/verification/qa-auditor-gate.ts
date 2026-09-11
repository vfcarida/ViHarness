/**
 * Adversarial Verification Subagent / Dual-Pass QA Auditor Gate.
 *
 * Implements generator-evaluator separation (inspired by GAN and dual-pass QA architectures):
 * Evaluates candidate diffs and proposed solutions against edge cases, boundary conditions,
 * resource leaks, and defensive invariants before declaring task completion.
 */
import * as path from 'node:path';
import * as fs from 'node:fs';

export type QaFindingCategory =
  | 'edge_case'
  | 'security'
  | 'resource_leak'
  | 'contract_violation'
  | 'type_safety';

export type QaFindingSeverity = 'critical' | 'major' | 'minor';

export interface QaAuditFinding {
  readonly category: QaFindingCategory;
  readonly severity: QaFindingSeverity;
  readonly description: string;
  readonly file?: string;
  readonly line?: number;
  readonly recommendation?: string;
}

export interface QaAuditOptions {
  readonly workspacePath: string;
  readonly taskDescription?: string;
  readonly patch?: string;
  readonly minPassingScore?: number; // default: 75
}

export interface QaAuditResult {
  readonly approved: boolean;
  readonly score: number;
  readonly findings: readonly QaAuditFinding[];
  readonly summary: string;
}

export class QaAuditorGate {
  private readonly minPassingScore: number;

  constructor(options: { minPassingScore?: number } = {}) {
    this.minPassingScore = options.minPassingScore ?? 75;
  }

  /**
   * Audits candidate modifications against defensive software engineering principles.
   */
  async audit(options: QaAuditOptions): Promise<QaAuditResult> {
    const findings: QaAuditFinding[] = [];
    const patch = options.patch ?? '';
    const workspacePath = options.workspacePath;

    // 1. Analyze Git Diff / Patch for Pitfalls
    if (patch.length > 0) {
      this.analyzePatchText(patch, findings);
    }

    // 2. Analyze Modified Files on Disk
    const modifiedFiles = this.extractModifiedFilesFromPatch(patch, workspacePath);
    for (const filePath of modifiedFiles) {
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const rel = path.relative(workspacePath, filePath).replace(/\\/g, '/');
          this.analyzeFileContent(rel, content, findings);
        } catch {
          // Ignore unreadable files
        }
      }
    }

    // 3. Compute Composite QA Score
    let deduction = 0;
    for (const f of findings) {
      if (f.severity === 'critical') deduction += 25;
      else if (f.severity === 'major') deduction += 12;
      else if (f.severity === 'minor') deduction += 5;
    }

    const score = Math.max(0, 100 - deduction);
    const hasCritical = findings.some((f) => f.severity === 'critical');
    const approved = score >= this.minPassingScore && !hasCritical;

    const summary = approved
      ? `QA Auditor approved solution with score ${score}/100 (${findings.length} non-blocking findings).`
      : `QA Auditor rejected solution with score ${score}/100 (${findings.length} findings, min required: ${this.minPassingScore}).`;

    return {
      approved,
      score,
      findings,
      summary,
    };
  }

  /**
   * Inspects patch text for unsafe patterns.
   */
  private analyzePatchText(patch: string, findings: QaAuditFinding[]): void {
    const lines = patch.split('\n');

    let currentFile = 'unknown';
    let lineNum = 0;
    const addedPerFile = new Map<string, string[]>();

    for (const line of lines) {
      lineNum++;
      if (line.startsWith('+++ b/')) {
        currentFile = line.slice(6).trim();
        continue;
      }

      // Check added lines only
      if (!line.startsWith('+') || line.startsWith('+++')) {
        continue;
      }

      const addedText = line.slice(1);
      if (!addedPerFile.has(currentFile)) {
        addedPerFile.set(currentFile, []);
      }
      addedPerFile.get(currentFile)?.push(addedText);

      // 1. Unsafe type casting bypass
      if (/\bas\s+any\b/.test(addedText) && !currentFile.includes('test')) {
        findings.push({
          category: 'type_safety',
          severity: 'minor',
          description: 'Unsafe type assertion `as any` detected in production code.',
          file: currentFile,
          line: lineNum,
          recommendation: 'Replace `as any` with strict interfaces, unknown, or type guards.',
        });
      }

      // 2. Hardcoded potential secrets / credentials
      if (
        /(?:api[_-]?key|secret|password|bearer|auth)\s*[:=]\s*['"][a-zA-Z0-9_-]{16,}['"]/i.test(
          addedText,
        ) &&
        !currentFile.includes('test')
      ) {
        findings.push({
          category: 'security',
          severity: 'critical',
          description: 'Potential hardcoded API token or credential detected in source code.',
          file: currentFile,
          line: lineNum,
          recommendation: 'Read credentials dynamically from environment variables.',
        });
      }
    }

    // 3. Multi-line command injection analysis across added chunks per file
    for (const [file, addedLines] of addedPerFile.entries()) {
      if (file.includes('test')) continue;
      const joined = addedLines.join('\n');

      const isInterpolatedExec =
        /(?:exec|execSync|spawn|system)\s*\(\s*`[^`]*\$\{/i.test(joined) ||
        (/\$\{[^}]+\}/.test(joined) && /(?:exec|execSync|spawn)\s*\(/.test(joined));

      if (isInterpolatedExec) {
        findings.push({
          category: 'security',
          severity: 'critical',
          description: 'Interpolated command execution detected; susceptible to command injection.',
          file,
          recommendation: 'Use parameterized spawn argument arrays rather than string interpolation.',
        });
      }
    }
  }

  /**
   * Inspects file contents for edge-case handling and resource management.
   */
  private analyzeFileContent(relPath: string, content: string, findings: QaAuditFinding[]): void {
    const isTestFile = relPath.includes('test') || relPath.includes('spec');

    // 1. Resource leak: opened file stream or temp file without close / dispose
    if (
      !isTestFile &&
      (content.includes('fs.createReadStream') || content.includes('fs.createWriteStream')) &&
      !content.includes('.close()') &&
      !content.includes('.destroy()') &&
      !content.includes('pipeline(')
    ) {
      findings.push({
        category: 'resource_leak',
        severity: 'major',
        description: `Stream opened in '${relPath}' without explicit close, destroy, or pipeline management.`,
        file: relPath,
        recommendation: 'Ensure streams are piped via stream.pipeline or cleaned up in finally blocks.',
      });
    }

    // 2. Unchecked array direct access on boundary
    if (!isTestFile && /const\s+\w+\s*=\s*\w+\[0\];/.test(content) && !content.includes('.length')) {
      findings.push({
        category: 'edge_case',
        severity: 'minor',
        description: `Unchecked index access '[0]' in '${relPath}' without verifying array length.`,
        file: relPath,
        recommendation: 'Guard with `if (arr.length > 0)` or use optional chaining / null coalescing.',
      });
    }

    // 3. Unhandled promise rejections / catch without logging or rethrow
    if (!isTestFile && /catch\s*\([^)]*\)\s*\{\s*\}/.test(content)) {
      findings.push({
        category: 'contract_violation',
        severity: 'major',
        description: `Silent empty catch block in '${relPath}' suppressing runtime exceptions.`,
        file: relPath,
        recommendation: 'Log, propagate, or return a structured Result error rather than silently swallowing.',
      });
    }
  }

  /**
   * Extracts list of files altered in patch.
   */
  private extractModifiedFilesFromPatch(patch: string, workspacePath: string): string[] {
    const files = new Set<string>();
    const lines = patch.split('\n');

    for (const line of lines) {
      if (line.startsWith('+++ b/')) {
        const rel = line.slice(6).trim();
        if (rel && rel !== '/dev/null') {
          files.add(path.resolve(workspacePath, rel));
        }
      }
    }

    return Array.from(files);
  }

  /**
   * Formats structured findings into an actionable prompt for targeted remediation.
   */
  static formatAuditorPrompt(result: QaAuditResult): string {
    const lines: string[] = [
      '\n============================================================',
      '[ADVERSARIAL QA AUDITOR VERDICT: REJECTED]',
      `The independent QA Auditor inspected the candidate solution and identified ${result.findings.length} defect(s) (Score: ${result.score}/100):`,
    ];

    for (const f of result.findings) {
      const location = f.file ? ` at ${f.file}${f.line ? `:${f.line}` : ''}` : '';
      lines.push(`\n- [${f.severity.toUpperCase()}] ${f.category}${location}:`);
      lines.push(`  Description: ${f.description}`);
      if (f.recommendation) {
        lines.push(`  Recommendation: ${f.recommendation}`);
      }
    }

    lines.push('\nActionable Instructions:');
    lines.push('1. Review each finding above and modify the code to address the specific defect.');
    lines.push('2. Ensure no hardcoded secrets, no unhandled exceptions, and strict edge-case bounds.');
    lines.push('3. Verify that unit tests cover these boundary conditions before concluding.');
    lines.push('============================================================\n');

    return lines.join('\n');
  }
}
