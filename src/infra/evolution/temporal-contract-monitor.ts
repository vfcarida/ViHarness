/**
 * Wave 9.3 — Runtime Temporal Logic ($\text{LTL}_f$) Monitor & Contract Enforcer
 * (`RuntimeTemporalContractMonitor`).
 *
 * Formally verifies finite-trace Linear Temporal Logic ($\text{LTL}_f$) behavioral
 * contracts over agent iteration traces (`IterationTraceRecord` or simplified step events):
 * - `LTL-01 (Verify-After-Write)`: $\mathbf{G}(\text{file\_mutation} \implies \mathbf{F}(\text{verification\_passed}))$
 * - `LTL-02 (Read-Before-Edit)`: $\mathbf{G}(\text{edit\_file} \implies \mathbf{O}(\text{read\_or\_search}))$
 * - `LTL-03 (Bounded-Error-Recovery)`: $\mathbf{G}(\text{tool\_error} \implies \mathbf{F}_{\le 2}(\text{recovery\_or\_success}))$
 * - `LTL-04 (Monotonic-Loop-Hygiene)`: $\mathbf{G}(\neg \text{three\_consecutive\_identical\_tool\_failures})$
 */
import type { IterationTraceRecord } from '../../core/model/trace-types.js';

export interface TemporalStepObservation {
  readonly stepIndex: number;
  readonly toolName?: string;
  readonly isFileMutation?: boolean;
  readonly isReadOrSearch?: boolean;
  readonly isVerificationPassed?: boolean;
  readonly isToolError?: boolean;
}

export interface TemporalContractResult {
  readonly formulaId: 'LTL-01' | 'LTL-02' | 'LTL-03' | 'LTL-04';
  readonly formulaName: string;
  readonly ltlFormula: string;
  readonly satisfied: boolean;
  readonly violatingStepIndices: ReadonlyArray<number>;
  readonly witnessSummary: string;
}

export interface TemporalContractVerificationReport {
  readonly totalStepsEvaluated: number;
  readonly allContractsSatisfied: boolean;
  readonly contractResults: ReadonlyArray<TemporalContractResult>;
  readonly violatedFormulaIds: ReadonlyArray<string>;
}

const MUTATION_TOOLS = new Set([
  'write_file',
  'edit_file',
  'apply_patch',
  'create_file',
]);
const DISCOVERY_TOOLS = new Set([
  'read_file',
  'search_code',
  'batch_find_symbols',
  'list_dir',
  'grep_search',
]);

export class RuntimeTemporalContractMonitor {
  /**
   * Normalizes full `IterationTraceRecord` objects into `TemporalStepObservation` steps
   * and evaluates all 4 $\text{LTL}_f$ contracts.
   */
  verifyIterationTraces(
    traces: ReadonlyArray<IterationTraceRecord>,
  ): TemporalContractVerificationReport {
    const steps: TemporalStepObservation[] = traces.map((tr, idx) => {
      const toolNames = tr.proposedToolCalls.map((t) => t.name);
      const primaryTool = toolNames[0];
      const isFileMutation = toolNames.some((n) => MUTATION_TOOLS.has(n));
      const isReadOrSearch = toolNames.some((n) => DISCOVERY_TOOLS.has(n));
      const isToolError = tr.executedToolResults.some((t) => t.status !== 'SUCCESS');
      const isVerificationPassed =
        tr.evidenceCreated.some((e) => e.pass) ||
        (toolNames.includes('run_command') && !isToolError);

      return {
        stepIndex: tr.sequenceNumber ?? idx + 1,
        toolName: primaryTool,
        isFileMutation,
        isReadOrSearch,
        isVerificationPassed,
        isToolError,
      };
    });

    return this.verifyStepSequence(steps);
  }

  /**
   * Evaluates all 4 finite-trace $\text{LTL}_f$ contracts over a sequence of step observations.
   */
  verifyStepSequence(
    steps: ReadonlyArray<TemporalStepObservation>,
  ): TemporalContractVerificationReport {
    const ltl01 = this.checkVerifyAfterWrite(steps);
    const ltl02 = this.checkReadBeforeEdit(steps);
    const ltl03 = this.checkBoundedErrorRecovery(steps);
    const ltl04 = this.checkMonotonicLoopHygiene(steps);

    const contractResults = [ltl01, ltl02, ltl03, ltl04];
    const violatedFormulaIds = contractResults
      .filter((r) => !r.satisfied)
      .map((r) => r.formulaId);

    return {
      totalStepsEvaluated: steps.length,
      allContractsSatisfied: violatedFormulaIds.length === 0,
      contractResults,
      violatedFormulaIds,
    };
  }

  /**
   * LTL-01: G(file_mutation -> F(verification_passed))
   */
  private checkVerifyAfterWrite(
    steps: ReadonlyArray<TemporalStepObservation>,
  ): TemporalContractResult {
    const violating: number[] = [];
    for (let i = 0; i < steps.length; i++) {
      if (steps[i]!.isFileMutation) {
        let verifiedLater = false;
        for (let j = i; j < steps.length; j++) {
          if (steps[j]!.isVerificationPassed) {
            verifiedLater = true;
            break;
          }
        }
        if (!verifiedLater) {
          violating.push(steps[i]!.stepIndex);
        }
      }
    }

    return {
      formulaId: 'LTL-01',
      formulaName: 'Verify-After-Write',
      ltlFormula: 'G(file_mutation -> F(verification_passed))',
      satisfied: violating.length === 0,
      violatingStepIndices: violating,
      witnessSummary:
        violating.length === 0
          ? 'All file mutations were followed by empirical verification.'
          : `Unverified file mutation(s) at step(s) [${violating.join(', ')}] without subsequent verification_passed.`,
    };
  }

  /**
   * LTL-02: G(edit_file -> O(read_or_search))
   */
  private checkReadBeforeEdit(
    steps: ReadonlyArray<TemporalStepObservation>,
  ): TemporalContractResult {
    const violating: number[] = [];
    let seenDiscovery = false;

    for (const step of steps) {
      if (step.isReadOrSearch) {
        seenDiscovery = true;
      }
      if (
        (step.toolName === 'edit_file' || step.isFileMutation) &&
        !seenDiscovery
      ) {
        violating.push(step.stepIndex);
      }
    }

    return {
      formulaId: 'LTL-02',
      formulaName: 'Read-Before-Edit',
      ltlFormula: 'G(file_mutation -> O(read_or_search))',
      satisfied: violating.length === 0,
      violatingStepIndices: violating,
      witnessSummary:
        violating.length === 0
          ? 'All file mutations were preceded by workspace read/search discovery.'
          : `Blind file mutation(s) executed before any read/search discovery at step(s) [${violating.join(', ')}].`,
    };
  }

  /**
   * LTL-03: G(tool_error -> F_{<=2}(!tool_error))
   */
  private checkBoundedErrorRecovery(
    steps: ReadonlyArray<TemporalStepObservation>,
  ): TemporalContractResult {
    const violating: number[] = [];
    for (let i = 0; i < steps.length; i++) {
      if (steps[i]!.isToolError) {
        const windowEnd = Math.min(steps.length - 1, i + 2);
        let recovered = false;
        for (let j = i + 1; j <= windowEnd; j++) {
          if (!steps[j]!.isToolError) {
            recovered = true;
            break;
          }
        }
        if (!recovered && i < steps.length - 1) {
          violating.push(steps[i]!.stepIndex);
        } else if (!recovered && i === steps.length - 1) {
          violating.push(steps[i]!.stepIndex);
        }
      }
    }

    return {
      formulaId: 'LTL-03',
      formulaName: 'Bounded-Error-Recovery',
      ltlFormula: 'G(tool_error -> F_{<=2}(recovery_step))',
      satisfied: violating.length === 0,
      violatingStepIndices: violating,
      witnessSummary:
        violating.length === 0
          ? 'All tool errors recovered within <= 2 subsequent steps.'
          : `Unrecovered tool error(s) at step(s) [${violating.join(', ')}].`,
    };
  }

  /**
   * LTL-04: G(!(tool_error(t) & tool_error(t+1) & tool_error(t+2) & same_tool))
   */
  private checkMonotonicLoopHygiene(
    steps: ReadonlyArray<TemporalStepObservation>,
  ): TemporalContractResult {
    const violating: number[] = [];
    for (let i = 0; i + 2 < steps.length; i++) {
      const a = steps[i]!;
      const b = steps[i + 1]!;
      const c = steps[i + 2]!;
      if (
        a.isToolError &&
        b.isToolError &&
        c.isToolError &&
        a.toolName &&
        a.toolName === b.toolName &&
        b.toolName === c.toolName
      ) {
        violating.push(c.stepIndex);
      }
    }

    return {
      formulaId: 'LTL-04',
      formulaName: 'Monotonic-Loop-Hygiene',
      ltlFormula: 'G(!three_consecutive_identical_tool_failures)',
      satisfied: violating.length === 0,
      violatingStepIndices: violating,
      witnessSummary:
        violating.length === 0
          ? 'No repetitive 3-step identical tool failure loops detected.'
          : `Repetitive tool thrashing loop detected culminating at step(s) [${violating.join(', ')}].`,
    };
  }
}
