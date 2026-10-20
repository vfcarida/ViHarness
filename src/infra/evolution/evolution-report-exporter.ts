/**
 * Wave 6.6 — Scientific Audit, Lineage & Pareto Report Exporter (`EvolutionReportExporter`).
 *
 * Exports any `EvolutionCycleReport` into publication- and governance-ready formats:
 * 1. **Markdown (`md`)**: GitHub-Flavored Markdown with Mermaid Propose–Probe–Compose–Admission
 *    lineage DAG, Pareto Frontier table, Holm-Bonferroni step-down FWER table, and
 *    Shapley surface attribution table.
 * 2. **Interactive HTML (`html`)**: Self-contained dark-mode report with Mermaid JS diagram,
 *    KPI summary cards, and structured audit tables.
 * 3. **LaTeX (`latex`)**: Publication-ready `booktabs` tabular environments for scientific papers.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { EvolutionCycleReport } from './recursive-evolution-engine.js';

export type EvolutionReportFormat = 'md' | 'html' | 'latex';

export class EvolutionReportExporter {
  /**
   * Renders an `EvolutionCycleReport` into the requested format (`md`, `html`, or `latex`).
   */
  render(report: EvolutionCycleReport, format: EvolutionReportFormat = 'md'): string {
    switch (format) {
      case 'html':
        return this.renderHtml(report);
      case 'latex':
        return this.renderLatex(report);
      case 'md':
      default:
        return this.renderMarkdown(report);
    }
  }

  /**
   * Renders and writes an `EvolutionCycleReport` to disk.
   */
  async exportToFile(params: {
    readonly report: EvolutionCycleReport;
    readonly format: EvolutionReportFormat;
    readonly outputPath: string;
  }): Promise<string> {
    const content = this.render(params.report, params.format);
    await fs.mkdir(path.dirname(params.outputPath), { recursive: true });
    await fs.writeFile(params.outputPath, content, 'utf8');
    return params.outputPath;
  }

  renderMarkdown(report: EvolutionCycleReport): string {
    const lines: string[] = [];
    lines.push(`# Vi-Harness Evolution Cycle Audit Report — \`${report.runId}\``);
    lines.push('');
    lines.push('## 1. Executive Summary');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('| :--- | :--- |');
    lines.push(`| **Evolution Run ID** | \`${report.runId}\` |`);
    lines.push(`| **Baseline Manifest** | \`${report.baseManifest.id}\` (\`${report.baseManifest.contentHash.slice(0, 12)}\`) |`);
    lines.push(`| **Final Selected Manifest** | \`${report.finalManifest.id}\` (\`${report.finalManifest.contentHash.slice(0, 12)}\`) |`);
    lines.push(`| **Recursion Strategy** | \`${report.strategyResult.strategyName}\` (stop: \`${report.strategyResult.stopReason}\`) |`);
    lines.push(`| **Admission Decision** | \`${report.admissionDecision.status.toUpperCase()}\` (evidence: \`${report.admissionDecision.evidenceLevelVerified}\`) |`);
    lines.push(`| **Total Probe Cost ($)** | \`$${report.strategyResult.accounting.totalCostDollars.toFixed(4)}\` |`);
    lines.push(`| **Reproducibility Signature** | \`${(report.reproducibilityManifest.signature ?? 'unsigned').slice(0, 16)}...\` |`);
    lines.push('');

    // Mermaid Lineage DAG
    lines.push('## 2. Candidate Lineage DAG (Mermaid)');
    lines.push('');
    lines.push('```mermaid');
    lines.push('graph TD');
    const baseNodeId = this.sanitizeMermaidId(String(report.baseManifest.id));
    lines.push(`  ${baseNodeId}["Baseline: ${report.baseManifest.id}"]`);
    for (const node of report.strategyResult.candidateDag) {
      const childId = this.sanitizeMermaidId(String(node.manifestId));
      const label = `${node.manifestId} (step ${node.stepIndex})`;
      for (const parent of node.parentManifestIds) {
        const parentId = this.sanitizeMermaidId(String(parent));
        lines.push(`  ${parentId} --> ${childId}["${label}"]`);
      }
    }
    const finalNodeId = this.sanitizeMermaidId(String(report.finalManifest.id));
    lines.push(`  style ${finalNodeId} stroke:#10b981,stroke-width:3px`);
    lines.push('```');
    lines.push('');

    // Pareto Frontier Table
    lines.push('## 3. Multi-Objective Pareto Frontier');
    lines.push('');
    lines.push('| Candidate ID | Pareto Optimal | Quality | Cost Penalty | Latency Penalty | Safety Risk | Balanced Utility |');
    lines.push('| :--- | :---: | :---: | :---: | :---: | :---: | :---: |');
    for (const ev of report.strategyResult.selectionResult.allEvaluated) {
      lines.push(
        `| \`${ev.manifest.id}\` | ${ev.isParetoOptimal ? 'YES' : 'NO'} | ${ev.objectives.qualityScore.toFixed(3)} | ${ev.objectives.costScore.toFixed(3)} | ${ev.objectives.latencyScore.toFixed(3)} | ${ev.objectives.safetyRiskPenalty.toFixed(3)} | ${(ev.utilityByProfile.balanced ?? 0).toFixed(4)} |`,
      );
    }
    lines.push('');

    // Shapley Attribution Table (if present)
    if (report.shapleyAttribution && report.shapleyAttribution.surfaceCredits.length > 0) {
      lines.push('## 4. Causal Surface Credit Attribution (Shapley & LOO Ablation)');
      lines.push('');
      lines.push('| Surface ID | Shapley Value ($\\phi_j$) | LOO Delta | Appearances | Role |');
      lines.push('| :--- | :---: | :---: | :---: | :--- |');
      for (const credit of report.shapleyAttribution.surfaceCredits) {
        lines.push(
          `| \`${credit.surfaceId}\` | ${credit.shapleyValue.toFixed(4)} | ${credit.leaveOneOutDelta.toFixed(4)} | ${credit.appearancesCount} | \`${credit.role}\` |`,
        );
      }
      lines.push('');
    }

    // Holm-Bonferroni Table (if present)
    if (report.multipleTestingSummary && report.multipleTestingSummary.verdicts.length > 0) {
      lines.push('## 5. Holm-Bonferroni Multiple-Hypothesis Control (FWER)');
      lines.push('');
      lines.push('| Rank | Candidate ID | Z-Statistic | p-Value | Adjusted $\\alpha_k$ | Significant Under FWER |');
      lines.push('| :---: | :--- | :---: | :---: | :---: | :---: |');
      for (const v of report.multipleTestingSummary.verdicts) {
        lines.push(
          `| ${v.rank} | \`${v.candidateManifestId}\` | ${v.zStatistic.toFixed(3)} | ${v.pValue.toFixed(5)} | ${v.adjustedAlpha.toFixed(5)} | ${v.significantUnderFwer ? 'PASS' : 'REJECT'} |`,
        );
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  renderHtml(report: EvolutionCycleReport): string {
    const md = this.renderMarkdown(report);
    const mermaidLines: string[] = [];
    const baseNodeId = this.sanitizeMermaidId(String(report.baseManifest.id));
    mermaidLines.push('graph TD');
    mermaidLines.push(`  ${baseNodeId}["Baseline: ${report.baseManifest.id}"]`);
    for (const node of report.strategyResult.candidateDag) {
      const childId = this.sanitizeMermaidId(String(node.manifestId));
      for (const parent of node.parentManifestIds) {
        const parentId = this.sanitizeMermaidId(String(parent));
        mermaidLines.push(`  ${parentId} --> ${childId}["${node.manifestId}"]`);
      }
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Vi-Harness Evolution Audit Report — ${report.runId}</title>
  <style>
    body { background: #0f172a; color: #f8fafc; font-family: system-ui, -apple-system, sans-serif; margin: 2rem; line-height: 1.6; }
    h1, h2 { color: #38bdf8; }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .kpi-card { background: #1e293b; border: 1px solid #334155; border-radius: 0.75rem; padding: 1rem; }
    .kpi-label { font-size: 0.8rem; color: #94a3b8; text-transform: uppercase; }
    .kpi-value { font-size: 1.25rem; font-weight: 700; color: #10b981; margin-top: 0.25rem; }
    pre { background: #1e293b; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; border: 1px solid #334155; }
  </style>
</head>
<body>
  <h1>Vi-Harness Evolution Audit Report — <code>${report.runId}</code></h1>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-label">Admission Status</div><div class="kpi-value">${report.admissionDecision.status.toUpperCase()}</div></div>
    <div class="kpi-card"><div class="kpi-label">Final Manifest</div><div class="kpi-value">${report.finalManifest.id}</div></div>
    <div class="kpi-card"><div class="kpi-label">Strategy</div><div class="kpi-value">${report.strategyResult.strategyName}</div></div>
    <div class="kpi-card"><div class="kpi-label">Total Probe Cost</div><div class="kpi-value">$${report.strategyResult.accounting.totalCostDollars.toFixed(4)}</div></div>
  </div>
  <h2>Candidate Lineage DAG</h2>
  <pre class="mermaid">
${mermaidLines.join('\n')}
  </pre>
  <h2>Full Markdown Audit Log</h2>
  <pre>${md.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
</body>
</html>`;
  }

  renderLatex(report: EvolutionCycleReport): string {
    const lines: string[] = [];
    lines.push('% Vi-Harness Evolution Cycle Scientific Benchmark Table');
    lines.push('\\begin{table}[htbp]');
    lines.push('\\centering');
    lines.push(`\\caption{Multi-Objective Pareto Evaluation for Evolution Run \\texttt{${this.escapeLatex(String(report.runId))}}}`);
    lines.push('\\begin{tabular}{lcccccc}');
    lines.push('\\toprule');
    lines.push('Candidate ID & Pareto & Quality ($Q$) & Cost ($C$) & Latency ($L$) & Safety ($R_s$) & Utility ($U$) \\\\');
    lines.push('\\midrule');
    for (const ev of report.strategyResult.selectionResult.allEvaluated) {
      lines.push(
        `\\texttt{${this.escapeLatex(String(ev.manifest.id))}} & ${ev.isParetoOptimal ? '\\checkmark' : '--'} & ${ev.objectives.qualityScore.toFixed(3)} & ${ev.objectives.costScore.toFixed(3)} & ${ev.objectives.latencyScore.toFixed(3)} & ${ev.objectives.safetyRiskPenalty.toFixed(3)} & ${(ev.utilityByProfile.balanced ?? 0).toFixed(4)} \\\\`,
      );
    }
    lines.push('\\bottomrule');
    lines.push('\\end{tabular}');
    lines.push('\\end{table}');
    return lines.join('\n');
  }

  private sanitizeMermaidId(id: string): string {
    return `node_${id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  }

  private escapeLatex(text: string): string {
    return text.replace(/_/g, '\\_').replace(/%/g, '\\%').replace(/#/g, '\\#');
  }
}
