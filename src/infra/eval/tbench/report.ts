/**
 * TBench Report Generator.
 *
 * Formats JSON and Markdown reports with official TBench / Harbor leaderboard standings.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TBenchResults } from './types.js';

export class TBenchReportGenerator {
  /**
   * Formats a rich Markdown report from TBenchResults.
   */
  static generateMarkdownReport(results: TBenchResults): string {
    const lines: string[] = [];

    lines.push('# Terminal-Bench (TBench 2.0 / Harbor) Benchmark Report\n');
    lines.push(`- **Model**: ${results.model}`);
    lines.push(`- **Timestamp**: ${results.timestamp}`);
    lines.push(`- **Overall Resolution Rate**: **${results.resolution_rate.toFixed(2)}%**`);
    lines.push(`- **Tasks Resolved**: ${results.passed} / ${results.total}`);
    lines.push(`- **Total Duration**: ${(results.duration_total / 1000).toFixed(1)}s\n`);

    lines.push('## 🏆 Official Terminal-Bench Leaderboard Standings\n');
    lines.push('| Rank | Agent / System | Reference Model | Resolution Rate | Status |');
    lines.push('| :--- | :--- | :--- | :--- | :--- |');

    results.leaderboard_comparison.forEach((entry, idx) => {
      const isViHarness = !entry.is_baseline;
      const rank = idx + 1;
      const agentLabel = isViHarness ? `**${entry.agent}**` : entry.agent;
      const modelLabel = entry.model;
      const scoreLabel = isViHarness
        ? `**${entry.resolution_rate.toFixed(2)}%**`
        : `${entry.resolution_rate.toFixed(2)}%`;
      const statusLabel = isViHarness ? '🎯 **Evaluated**' : 'Official Baseline';
      lines.push(`| ${rank} | ${agentLabel} | ${modelLabel} | ${scoreLabel} | ${statusLabel} |`);
    });

    lines.push('\n## 📊 Performance by Category\n');
    lines.push('| Category | Passed | Total | Resolution Rate |');
    lines.push('| :--- | :--- | :--- | :--- |');

    for (const [cat, data] of Object.entries(results.by_category)) {
      lines.push(
        `| ${cat} | ${data.passed} | ${data.total} | ${data.resolution_rate.toFixed(2)}% |`,
      );
    }

    lines.push('\n## 🎯 Performance by Difficulty\n');
    lines.push('| Difficulty | Passed | Total | Resolution Rate |');
    lines.push('| :--- | :--- | :--- | :--- |');

    for (const [diff, data] of Object.entries(results.by_difficulty)) {
      lines.push(
        `| ${diff.toUpperCase()} | ${data.passed} | ${data.total} | ${data.resolution_rate.toFixed(2)}% |`,
      );
    }

    lines.push('\n## 📋 Detailed Task Breakdown\n');
    lines.push(
      '| Task ID | Category | Difficulty | Result | Duration | Commands | Tokens | Cost |',
    );
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

    for (const task of results.tasks) {
      const statusBadge = task.passed ? '✅ PASSED' : '❌ FAILED';
      const durationSec = (task.duration / 1000).toFixed(1) + 's';
      const costStr = `$${task.cost_dollars.toFixed(4)}`;

      lines.push(
        `| ${task.task_id} | ${task.category} | ${task.difficulty} | ${statusBadge} | ${durationSec} | ${task.commands_executed} | ${task.tokens_used.toLocaleString()} | ${costStr} |`,
      );
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Writes both JSON and Markdown reports to an output directory.
   */
  static async writeReportFiles(
    results: TBenchResults,
    outputDir: string,
  ): Promise<{ jsonPath: string; mdPath: string }> {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestampSlug = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = path.join(outputDir, `tbench-report-${timestampSlug}.json`);
    const mdPath = path.join(outputDir, `tbench-report-${timestampSlug}.md`);

    await fs.promises.writeFile(jsonPath, JSON.stringify(results, null, 2), 'utf-8');
    await fs.promises.writeFile(mdPath, this.generateMarkdownReport(results), 'utf-8');

    // Also write standard unversioned default files
    const defaultJsonPath = path.join(outputDir, 'tbench-report.json');
    const defaultMdPath = path.join(outputDir, 'tbench-report.md');
    await fs.promises.writeFile(defaultJsonPath, JSON.stringify(results, null, 2), 'utf-8');
    await fs.promises.writeFile(defaultMdPath, this.generateMarkdownReport(results), 'utf-8');

    return { jsonPath, mdPath };
  }
}
