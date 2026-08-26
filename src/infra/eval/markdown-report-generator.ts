/**
 * Markdown Summary Report Generator for Benchmark Evaluations.
 *
 * Formats rich human-readable GitHub Flavored Markdown comparison tables
 * showing statistical distributions (mean, median, p95, min, max, stdDev)
 * across Pi vs Vi-Harness experimental trials.
 */
import type {
  BenchmarkSuiteResult,
  BenchmarkReport,
  StatisticalDistribution,
} from '../../core/model/benchmark-types.js';

export class MarkdownReportGenerator {
  /**
   * Generate human-readable markdown comparison report.
   */
  static generateSummary(result: BenchmarkSuiteResult | BenchmarkReport): string {
    if ('taskComparisons' in result) {
      return MarkdownReportGenerator.generateSuiteComparisonSummary(result);
    }
    return MarkdownReportGenerator.generateLegacyReportSummary(result);
  }

  private static generateSuiteComparisonSummary(result: BenchmarkSuiteResult): string {
    const lines: string[] = [];

    lines.push('# Vi-Harness Official Benchmark Evaluation Report');
    lines.push('');
    lines.push(
      '> **Experimental Design**: Isolates the agent harness as the primary independent variable',
    );
    lines.push(
      '> holding model, task, tools, timeout, budget, and workspace environment constant.',
    );
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## 1. Experiment Control Parameters');
    lines.push('');
    lines.push(`- **Suite**: \`${result.suiteName}\` (\`${result.suiteId}\`)`);
    lines.push(
      `- **Model**: \`${result.modelConfig.providerId}/${result.modelConfig.modelId}\` (Temperature: \`${result.modelConfig.temperature}\`)`,
    );
    lines.push(`- **Trials Per Task**: \`${result.runsPerTask}\` repeated runs per harness`);
    lines.push(`- **Reproducibility Seed**: \`${result.seed}\``);
    lines.push(
      `- **Environment**: OS \`${result.environment.os}\` | Node \`${result.environment.nodeVersion}\` | Isolated Workspaces: \`${result.environment.isolatedWorkspace}\``,
    );
    lines.push(`- **Generated At**: \`${result.generatedAt.toISOString()}\``);
    lines.push('');
    lines.push('---');
    lines.push('');

    lines.push('## 2. Executive Comparison: Pi vs Vi-Harness');
    lines.push('');
    lines.push(
      '| Harness | Version | Runs | Success Rate | Mean Cost | Median Cost | P95 Cost | Mean Iter | Median Iter | P95 Iter | Mean Latency | Median Latency | P95 Latency |',
    );
    lines.push(
      '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
    );

    for (const [harnessName, summary] of Object.entries(result.harnessSummaries)) {
      const sRate = `${(summary.overallSuccessRate * 100).toFixed(1)}%`;
      const mCost = `$${summary.costDistribution.mean.toFixed(4)}`;
      const medCost = `$${summary.costDistribution.median.toFixed(4)}`;
      const p95Cost = `$${summary.costDistribution.p95.toFixed(4)}`;

      const mIter = summary.iterationDistribution.mean.toFixed(1);
      const medIter = summary.iterationDistribution.median.toFixed(1);
      const p95Iter = summary.iterationDistribution.p95.toFixed(1);

      const mLat = `${summary.latencyDistribution.mean.toFixed(0)}ms`;
      const medLat = `${summary.latencyDistribution.median.toFixed(0)}ms`;
      const p95Lat = `${summary.latencyDistribution.p95.toFixed(0)}ms`;

      lines.push(
        `| **${harnessName}** | \`${summary.harnessVersion}\` | ${summary.totalRuns} | ${sRate} | ${mCost} | ${medCost} | ${p95Cost} | ${mIter} | ${medIter} | ${p95Iter} | ${mLat} | ${medLat} | ${p95Lat} |`,
      );
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    lines.push('## 3. Token Consumption Distributions');
    lines.push('');
    lines.push(
      '| Harness | Prompt Tokens (Mean / Med / P95) | Completion Tokens (Mean / Med / P95) | Total Tokens (Mean / Med / P95) | StdDev Total Tokens |',
    );
    lines.push('| :--- | :--- | :--- | :--- | :--- |');

    for (const [harnessName, summary] of Object.entries(result.harnessSummaries)) {
      const pTokens = `${summary.tokenDistribution.inputTokens.mean.toFixed(0)} / ${summary.tokenDistribution.inputTokens.median.toFixed(0)} / ${summary.tokenDistribution.inputTokens.p95.toFixed(0)}`;
      const cTokens = `${summary.tokenDistribution.outputTokens.mean.toFixed(0)} / ${summary.tokenDistribution.outputTokens.median.toFixed(0)} / ${summary.tokenDistribution.outputTokens.p95.toFixed(0)}`;
      const tTokens = `${summary.tokenDistribution.totalTokens.mean.toFixed(0)} / ${summary.tokenDistribution.totalTokens.median.toFixed(0)} / ${summary.tokenDistribution.totalTokens.p95.toFixed(0)}`;
      const sdTokens = summary.tokenDistribution.totalTokens.stdDev.toFixed(1);

      lines.push(`| **${harnessName}** | ${pTokens} | ${cTokens} | ${tTokens} | ${sdTokens} |`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    lines.push('## 4. Task-by-Task Comparison Breakdown');
    lines.push('');
    lines.push(
      '| Task ID | Name | Category | Harness | Success | Mean Cost | Median Cost | P95 Cost | Mean Iter | P95 Iter | Mean Latency |',
    );
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

    for (const comp of result.taskComparisons) {
      for (const [harnessName, benchResult] of Object.entries(comp.harnessResults)) {
        const sRate = `${(benchResult.successRate * 100).toFixed(0)}%`;
        const costMean = `$${benchResult.costDistribution.mean.toFixed(4)}`;
        const costMed = `$${benchResult.costDistribution.median.toFixed(4)}`;
        const costP95 = `$${benchResult.costDistribution.p95.toFixed(4)}`;
        const iterMean = benchResult.iterationDistribution.mean.toFixed(1);
        const iterP95 = benchResult.iterationDistribution.p95.toFixed(1);
        const latMean = `${benchResult.latencyDistribution.mean.toFixed(0)}ms`;

        lines.push(
          `| \`${comp.taskId}\` | ${comp.taskName} | \`${comp.category}\` | **${harnessName}** | ${sRate} | ${costMean} | ${costMed} | ${costP95} | ${iterMean} | ${iterP95} | ${latMean} |`,
        );
      }
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    lines.push('## 5. Statistical Distribution Details');
    lines.push('');
    for (const [harnessName, summary] of Object.entries(result.harnessSummaries)) {
      lines.push(`### Harness: ${harnessName}`);
      lines.push('');
      lines.push(
        MarkdownReportGenerator.formatDistributionTable('Cost ($)', summary.costDistribution),
      );
      lines.push('');
      lines.push(
        MarkdownReportGenerator.formatDistributionTable(
          'Iterations',
          summary.iterationDistribution,
        ),
      );
      lines.push('');
      lines.push(
        MarkdownReportGenerator.formatDistributionTable(
          'Total Tokens',
          summary.tokenDistribution.totalTokens,
        ),
      );
      lines.push('');
      lines.push(
        MarkdownReportGenerator.formatDistributionTable(
          'Latency (ms)',
          summary.latencyDistribution,
        ),
      );
      lines.push('');
    }

    return lines.join('\n');
  }

  private static formatDistributionTable(
    metricName: string,
    dist: StatisticalDistribution,
  ): string {
    return [
      `| Metric: ${metricName} | Mean | Median | P95 | Min | Max | StdDev | Samples |`,
      '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
      `| Value | ${dist.mean} | ${dist.median} | ${dist.p95} | ${dist.min} | ${dist.max} | ${dist.stdDev} | ${dist.samples.length} |`,
    ].join('\n');
  }

  private static generateLegacyReportSummary(report: BenchmarkReport): string {
    const lines: string[] = [];
    lines.push('# Benchmark Evaluation Report');
    lines.push('');
    lines.push(`- **Report ID**: \`${report.reportId}\``);
    lines.push(`- **Suite ID**: \`${report.suiteId}\``);
    lines.push(
      `- **Overall Success Rate**: ${(report.aggregatedMetrics.overallSuccessRate * 100).toFixed(1)}%`,
    );
    lines.push(`- **Total Tokens**: ${report.aggregatedMetrics.totalTokens}`);
    lines.push(`- **Total Cost**: $${report.aggregatedMetrics.totalCostUSD.toFixed(4)}`);
    lines.push(`- **Average Iterations**: ${report.aggregatedMetrics.avgIterations.toFixed(1)}`);
    lines.push('');
    lines.push('| Task ID | Success | Total Tokens | Cost ($) | Iterations | Latency (ms) |');
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');

    for (const r of report.results) {
      const taskId = r.metadata?.taskId ?? r.taskId;
      const success = r.correctness?.taskSuccess ?? r.successRate >= 1.0;
      const totalTokens = r.efficiency?.totalTokens ?? r.tokenDistribution.totalTokens.mean;
      const totalCostUSD = r.efficiency?.totalCostUSD ?? r.costDistribution.mean;
      const iterations = r.efficiency?.iterations ?? r.iterationDistribution.mean;
      const latency = r.executionTimeMs ?? r.latencyDistribution.mean;

      lines.push(
        `| \`${taskId}\` | ${success ? '✅' : '❌'} | ${totalTokens} | $${totalCostUSD.toFixed(4)} | ${iterations} | ${latency} |`,
      );
    }
    return lines.join('\n');
  }
}
