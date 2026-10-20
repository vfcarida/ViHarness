/**
 * Default Harness Diagnoser (Milestone B).
 *
 * Maps single-run and cross-run execution traces into the 30+ typed FailureSignal
 * taxonomy so the proposer receives distilled, structured failure evidence rather
 * than raw transcripts.
 */
import type { IterationTraceRecord } from '../../core/model/trace-types.js';
import type { ExecutionResult } from '../../core/model/runtime-types.js';
import {
  FailureTaxonomyRegistry,
  type FailureSignal,
  type FailureSignalType,
} from '../../core/evolution/failure-taxonomy.js';
import type { HarnessDiagnoser } from '../../core/evolution/interfaces.js';
import { TraceDistiller } from '../telemetry/trace-distiller.js';

export class DefaultHarnessDiagnoser implements HarnessDiagnoser {
  private readonly taxonomy: FailureTaxonomyRegistry;

  constructor(taxonomy?: FailureTaxonomyRegistry) {
    this.taxonomy = taxonomy ?? new FailureTaxonomyRegistry();
  }

  diagnoseRun(params: {
    readonly runId: string;
    readonly traces: ReadonlyArray<IterationTraceRecord>;
    readonly executionResult?: ExecutionResult;
  }): ReadonlyArray<FailureSignal> {
    return this.diagnoseAcrossRuns([params]);
  }

  diagnoseAcrossRuns(
    runs: ReadonlyArray<{
      readonly runId: string;
      readonly traces: ReadonlyArray<IterationTraceRecord>;
      readonly executionResult?: ExecutionResult;
    }>,
  ): ReadonlyArray<FailureSignal> {
    const signals = new Map<
      FailureSignalType,
      {
        confidence: number;
        iterationNumbers: Set<number>;
        runIds: Set<string>;
        excerpts: string[];
      }
    >();

    const recordSignal = (
      type: FailureSignalType,
      runId: string,
      iterNum: number,
      excerpt: string,
      confidence: number = 0.85,
    ) => {
      const existing = signals.get(type) ?? {
        confidence,
        iterationNumbers: new Set<number>(),
        runIds: new Set<string>(),
        excerpts: [],
      };
      existing.confidence = Math.max(existing.confidence, confidence);
      if (iterNum > 0) existing.iterationNumbers.add(iterNum);
      existing.runIds.add(runId);
      if (existing.excerpts.length < 6) {
        existing.excerpts.push(excerpt);
      }
      signals.set(type, existing);
    };

    for (const run of runs) {
      const analysis = TraceDistiller.distill(run.traces);

      // 1. Cache instability
      if (analysis.cacheHitRatio < 0.3 && analysis.promptTokens > 4000) {
        recordSignal(
          'cache_instability',
          run.runId,
          1,
          `Run [${run.runId}]: Low cache hit ratio ${(analysis.cacheHitRatio * 100).toFixed(1)}% over ${analysis.promptTokens} prompt tokens`,
          0.88,
        );
      }

      // 2. Excessive context / context overflow
      if (analysis.totalTokens > 100_000) {
        recordSignal(
          'context_overflow',
          run.runId,
          analysis.totalIterations,
          `Run [${run.runId}]: Total tokens reached ${analysis.totalTokens}`,
          0.92,
        );
      } else if (analysis.totalTokens > 30_000) {
        recordSignal(
          'excessive_context',
          run.runId,
          analysis.totalIterations,
          `Run [${run.runId}]: High token consumption (${analysis.totalTokens} tokens)`,
          0.8,
        );
      }

      // 3. Excessive cost
      if (analysis.totalCostDollars > 0.5) {
        recordSignal(
          'excessive_cost',
          run.runId,
          analysis.totalIterations,
          `Run [${run.runId}]: Total cost $${analysis.totalCostDollars.toFixed(4)} exceeded efficiency target`,
          0.85,
        );
      }

      // 4. Policy & security denials
      if (analysis.policyDenialCount > 0) {
        recordSignal(
          'security_denial',
          run.runId,
          1,
          `Run [${run.runId}]: ${analysis.policyDenialCount} policy denial(s) triggered`,
          0.9,
        );
      }

      // 5. Inspect per-iteration trace patterns
      const seenToolCalls = new Map<string, number>();
      let mutatedFiles = false;
      let ranVerificationAfterMutation = false;

      for (let i = 0; i < run.traces.length; i++) {
        const trace = run.traces[i]!;
        const seq = trace.sequenceNumber || i + 1;

        // Oscillation detection
        if (
          trace.phaseAfter === 'OSCILLATION_DETECTED' ||
          (i > 0 &&
            trace.phaseBefore === 'REPAIR' &&
            run.traces[i - 1]?.phaseBefore === 'IMPLEMENT' &&
            trace.phaseAfter === 'IMPLEMENT')
        ) {
          recordSignal(
            'oscillation',
            run.runId,
            seq,
            `Run [${run.runId}] Iter ${seq}: Phase oscillation (${trace.phaseBefore} -> ${trace.phaseAfter})`,
            0.92,
          );
        }

        // Regression detection
        if (
          trace.phaseAfter === 'REGRESSION_DETECTED' ||
          trace.evidenceCreated.some((e) => String(e.outcome) === 'REGRESSION')
        ) {
          recordSignal(
            'regression',
            run.runId,
            seq,
            `Run [${run.runId}] Iter ${seq}: Prior passing tests regressed`,
            0.95,
          );
        }

        // Budget exceeded
        if (trace.phaseAfter === 'BUDGET_EXCEEDED') {
          recordSignal(
            'budget_exceeded',
            run.runId,
            seq,
            `Run [${run.runId}] Iter ${seq}: Transitioned to BUDGET_EXCEEDED`,
            0.95,
          );
        }

        // Latency check
        if (trace.durationMs > 45_000) {
          recordSignal(
            'excessive_latency',
            run.runId,
            seq,
            `Run [${run.runId}] Iter ${seq}: Iteration took ${trace.durationMs}ms`,
            0.78,
          );
        }

        // Repeated tool calls
        for (const call of trace.proposedToolCalls) {
          const sig = `${call.name}:${JSON.stringify(call.input)}`;
          const count = (seenToolCalls.get(sig) ?? 0) + 1;
          seenToolCalls.set(sig, count);
          if (count >= 2) {
            recordSignal(
              'repeated_tool_call',
              run.runId,
              seq,
              `Run [${run.runId}] Iter ${seq}: Repeated identical tool call '${call.name}' (${count}x)`,
              0.88,
            );
          }

          if (call.name === 'write_file' || call.name === 'edit_file' || call.name === 'apply_patch') {
            mutatedFiles = true;
            ranVerificationAfterMutation = false;
          }
          if (call.name === 'run_command' || call.name === 'run_tests') {
            ranVerificationAfterMutation = true;
          }
        }

        // Tool errors, timeouts, syntax rejections, script/plugin failures
        for (const res of trace.executedToolResults) {
          const toolName = String(res.metadata?.['toolName'] ?? (res as any).name ?? 'unknown');
          if (String(res.status) === 'TIMEOUT') {
            recordSignal(
              'timeout',
              run.runId,
              seq,
              `Run [${run.runId}] Iter ${seq}: Tool '${toolName}' timed out`,
              0.9,
            );
          } else if (String(res.status) !== 'SUCCESS') {
            const errText = `${res.error ?? ''} ${res.output ?? ''}`.trim();
            if (errText.toLowerCase().includes('syntax')) {
              recordSignal(
                'syntax_gate_rejection',
                run.runId,
                seq,
                `Run [${run.runId}] Iter ${seq}: Syntax rejection on '${toolName}': ${errText.slice(0, 100)}`,
                0.9,
              );
            } else if (toolName.includes('script')) {
              recordSignal(
                'script_failure',
                run.runId,
                seq,
                `Run [${run.runId}] Iter ${seq}: Script '${toolName}' failed: ${errText.slice(0, 100)}`,
                0.88,
              );
            } else {
              recordSignal(
                'tool_error',
                run.runId,
                seq,
                `Run [${run.runId}] Iter ${seq}: Tool '${toolName}' failed: ${errText.slice(0, 100)}`,
                0.88,
              );
            }
          }
        }

        if (trace.evidenceCreated.some((e) => e.pass)) {
          ranVerificationAfterMutation = true;
        }
      }

      if (mutatedFiles && !ranVerificationAfterMutation) {
        recordSignal(
          'mutation_without_verification',
          run.runId,
          run.traces.length,
          `Run [${run.runId}]: Mutated workspace files without subsequent verification check`,
          0.9,
        );
      }

      if (run.executionResult && !run.executionResult.success && signals.size === 0) {
        recordSignal(
          'premature_completion',
          run.runId,
          run.executionResult.iterationCount,
          `Run [${run.runId}]: Execution ended unsuccessfully (${run.executionResult.status}): ${run.executionResult.summary}`,
          0.75,
        );
      }
    }

    const output: FailureSignal[] = [];
    for (const [type, data] of signals.entries()) {
      const def = this.taxonomy.get(type);
      const runBonus = data.runIds.size >= 2 ? 0.05 : 0;
      output.push({
        id: `sig-${type}-${Array.from(data.runIds).join('_')}`,
        type,
        severity: def?.defaultSeverity ?? 'MEDIUM',
        confidence: Math.min(0.99, data.confidence + runBonus),
        iterationNumbers: Array.from(data.iterationNumbers).sort((a, b) => a - b),
        runIds: Array.from(data.runIds),
        evidenceExcerpts: data.excerpts,
        implicatedSurfaces: def?.defaultImplicatedSurfaces ?? ['systemPrompt'],
        suggestedQuadrants: def?.defaultQuadrants ?? ['INVARIANT_GUIDANCE'],
      });
    }

    return output;
  }
}
