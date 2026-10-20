/**
 * Evolution Tree Renderer (TUI Observability).
 *
 * Renders the Propose–Probe–Compose–Admission DAG and performance/cost/security deltas:
 *   Base
 *     ├── candidate A -> probe result
 *     ├── candidate B -> probe result
 *     └── candidate C -> probe result
 *                |
 *                -> composition
 *                -> validation
 *                -> admission
 */
import type { CandidateSelectionResult } from '../../core/evolution/interfaces.js';
import type { EvolutionTelemetryEvent } from '../../core/model/telemetry-types.js';
import type { EvolutionCycleReport } from '../evolution/recursive-evolution-engine.js';

export class EvolutionTreeRenderer {
  /**
   * Renders a human-readable ASCII tree summarizing an EvolutionCycleReport.
   */
  renderReport(report: EvolutionCycleReport): string {
    const lines: string[] = [];
    const base = report.baseManifest;
    const contrasts = report.strategyResult.allContrasts;
    const compositions = report.strategyResult.compositions;
    const admission = report.admissionDecision;

    lines.push(`=== ViHarness Evolution Run: ${report.runId} (${report.strategyResult.strategyName.toUpperCase()}) ===`);
    lines.push(`Base [${base.id}] (hash: ${base.contentHash.slice(0, 8)})`);

    if (contrasts.length === 0) {
      lines.push('  └── (no approved candidates probed)');
    } else {
      for (let i = 0; i < contrasts.length; i++) {
        const c = contrasts[i]!;
        const isLast = i === contrasts.length - 1;
        const branch = isLast ? '  └──' : '  ├──';
        const passDeltaPct = `${c.passRateDelta >= 0 ? '+' : ''}${(c.passRateDelta * 100).toFixed(1)}%`;
        const costDeltaStr = `${c.meanCostDollarsDelta >= 0 ? '+' : ''}$${c.meanCostDollarsDelta.toFixed(4)}`;
        const safetyStr =
          c.policyViolationDelta === 0
            ? '0 violations'
            : `${c.policyViolationDelta} violations!`;
        lines.push(
          `${branch} Candidate [${c.candidateManifestId}] -> probe: passDelta=${passDeltaPct}, costDelta=${costDeltaStr}, safety=${safetyStr} (${c.hypothesisOutcome.verdict.toUpperCase()})`,
        );
      }
    }

    lines.push('             |');
    if (compositions.length > 0) {
      const lastComp = compositions[compositions.length - 1]!;
      lines.push(
        `             -> composition [${lastComp.composedManifest.id}] (${lastComp.componentDecisions.length} surfaces evaluated)`,
      );
    } else {
      lines.push(`             -> selection [${report.finalManifest.id}]`);
    }

    lines.push(
      `             -> validation: structural=${admission.structuralValidationPassed ? 'PASS' : 'FAIL'}, constitution=${admission.constitutionalCheckPassed ? 'PASS' : 'FAIL'}, evidence=${admission.evidenceLevelVerified}`,
    );
    lines.push(
      `             -> admission: ${admission.status.toUpperCase()} (${admission.reasons[0] ?? 'verified'})`,
    );

    const acc = report.strategyResult.accounting;
    lines.push(
      `Resources: probes=${acc.probesExecuted}, modelCalls=${acc.modelCalls}, totalCost=$${acc.totalCostDollars.toFixed(4)}, wallTime=${acc.wallTimeMs}ms`,
    );

    return lines.join('\n');
  }

  /**
   * Formats a real-time `EvolutionTelemetryEvent` line for streaming TUI display.
   */
  renderLiveEvent(event: EvolutionTelemetryEvent): string {
    const ts = event.timestamp.slice(11, 23);
    const candidateTag = event.candidateId ? ` cand=${event.candidateId}` : '';
    const manifestTag = event.manifestId ? ` manifest=${event.manifestId}` : '';
    return `[${ts}] [EVO:${event.eventType}] run=${event.evolutionRunId}${candidateTag}${manifestTag} ${JSON.stringify(event.attributes)}`;
  }


  /**
   * Renders the Multi-Objective Pareto Frontier table across Quality, Cost, Latency, Safety, and Utility.
   */
  renderParetoFrontierTable(selectionResult: CandidateSelectionResult): string {
    const lines: string[] = [];
    lines.push(
      `=== Multi-Objective Pareto Frontier (Profile: ${selectionResult.activeProfile}) ===`,
    );
    lines.push(
      'Manifest ID                | Pareto | Quality | CostPen | SafetyPen | Utility',
    );
    lines.push(
      '---------------------------+--------+---------+---------+-----------+--------',
    );

    for (const ev of selectionResult.allEvaluated) {
      const idCol = ev.manifest.id.padEnd(26, ' ').slice(0, 26);
      const paretoCol = (ev.isParetoOptimal ? 'YES' : 'no').padEnd(6, ' ');
      const qualCol = ev.objectives.qualityScore.toFixed(3).padEnd(7, ' ');
      const costCol = ev.objectives.costScore.toFixed(3).padEnd(7, ' ');
      const safeCol = ev.objectives.safetyRiskPenalty.toFixed(3).padEnd(9, ' ');
      const util =
        ev.utilityByProfile[selectionResult.activeProfile]?.toFixed(4) ?? '0.0000';
      lines.push(
        `${idCol} | ${paretoCol} | ${qualCol} | ${costCol} | ${safeCol} | ${util}`,
      );
    }

    lines.push(`Selected: ${selectionResult.selectedCandidate?.manifest.id ?? 'baseline (preserved)'}`);
    lines.push(`Rationale: ${selectionResult.rationale}`);
    return lines.join('\n');
  }
}

