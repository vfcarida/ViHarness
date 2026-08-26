/**
 * ProjDevBench Report Generator.
 *
 * Formats JSON and Markdown reports matching the official ProjDevBench leaderboard.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProjDevBenchmarkReport } from './types.js';

export class ProjDevReportGenerator {
  /**
   * Generates a rich Markdown summary report.
   */
  static generateMarkdownReport(report: ProjDevBenchmarkReport): string {
    const lines: string[] = [];

    lines.push('# ProjDevBench (Project Development Benchmark) Report\n');
    lines.push(`- **Harness**: ${report.harnessName}`);
    lines.push(`- **Model**: ${report.modelId}`);
    lines.push(`- **Date**: ${report.timestamp}`);
    lines.push(`- **Overall Score**: **${report.overallScore.toFixed(2)}%**`);
    lines.push(`- **Execution Score (80% weight)**: ${report.executionScoreAverage.toFixed(2)}%`);
    lines.push(
      `- **Code Review Score (20% weight)**: ${report.codeReviewScoreAverage.toFixed(2)}%`,
    );
    lines.push(
      `- **Total Problems**: ${report.totalProblems} (${report.completedProblems} passed)`,
    );
    lines.push(`- **Total Tokens**: ${report.totalTokens.toLocaleString()}`);
    lines.push(`- **Total Cost**: $${report.totalCostDollars.toFixed(4)}`);
    lines.push(`- **Total Duration**: ${(report.totalDurationMs / 1000).toFixed(1)}s\n`);

    lines.push('## 🏆 Official ProjDevBench Leaderboard Comparison\n');
    lines.push('| Rank | Agent | Reference Model | Score | Status |');
    lines.push('| :--- | :--- | :--- | :--- | :--- |');

    report.leaderboardComparison.forEach((entry, idx) => {
      const isViHarness = entry.agent === report.harnessName;
      const rank = idx + 1;
      const agentLabel = isViHarness ? `**${entry.agent}**` : entry.agent;
      const modelLabel = entry.referenceModel ?? 'N/A';
      const scoreLabel = isViHarness
        ? `**${entry.score.toFixed(2)}%**`
        : `${entry.score.toFixed(2)}%`;
      const statusLabel = isViHarness ? '🎯 **Evaluated**' : 'Official Baseline';
      lines.push(`| ${rank} | ${agentLabel} | ${modelLabel} | ${scoreLabel} | ${statusLabel} |`);
    });

    lines.push('\n## 📊 Performance by Category\n');
    lines.push('| Category | Problems | Score |');
    lines.push('| :--- | :--- | :--- |');

    for (const [cat, data] of Object.entries(report.categoryScores)) {
      lines.push(`| ${cat} | ${data.count} | ${data.score.toFixed(2)}% |`);
    }

    lines.push('\n## 📋 Detailed Problem Results\n');
    lines.push(
      '| Problem ID | Category | Difficulty | Mode | Exec Score | Review Score | Final Score | Verdicts | Status |',
    );
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

    for (const ps of report.problemScores) {
      const execPct = (ps.executionScore * 100).toFixed(1) + '%';
      const revPct = (ps.codeReviewScore * 100).toFixed(1) + '%';
      const finalPct = (ps.finalScore * 100).toFixed(1) + '%';
      const verdictsSummary = ps.testVerdicts.map((v) => v.verdict).join(', ') || 'N/A';
      const statusBadge = ps.success ? '✅ PASSED' : '❌ FAILED';

      lines.push(
        `| ${ps.problemId} | ${ps.category} | ${ps.difficulty} | ${ps.mode} | ${execPct} | ${revPct} | **${finalPct}** | \`${verdictsSummary}\` | ${statusBadge} |`,
      );
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Writes both JSON and Markdown report files to an output directory.
   */
  static async writeReportFiles(
    report: ProjDevBenchmarkReport,
    outputDir: string,
  ): Promise<{ jsonPath: string; mdPath: string }> {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestampSlug = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = path.join(outputDir, `projdevbench-report-${timestampSlug}.json`);
    const mdPath = path.join(outputDir, `projdevbench-report-${timestampSlug}.md`);

    await fs.promises.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
    await fs.promises.writeFile(mdPath, this.generateMarkdownReport(report), 'utf-8');

    // Also write standard unversioned files
    const defaultJsonPath = path.join(outputDir, 'projdevbench-report.json');
    const defaultMdPath = path.join(outputDir, 'projdevbench-report.md');
    await fs.promises.writeFile(defaultJsonPath, JSON.stringify(report, null, 2), 'utf-8');
    await fs.promises.writeFile(defaultMdPath, this.generateMarkdownReport(report), 'utf-8');

    return { jsonPath, mdPath };
  }
}
