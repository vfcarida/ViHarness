/**
 * Loop control — detects pathological agent behavior and produces
 * structured termination decisions.
 *
 * "Stop conditions live outside the LLM."
 *
 * PRINCIPLE: Every terminal decision MUST explain WHY via structured evidence,
 * not just a reason enum. The `evidence` array contains human-readable
 * descriptions AND machine-parseable data for each detection.
 *
 * Checks performed (in priority order):
 *  0. Task completion (DONE phase)
 *  1. Maximum iterations exceeded
 *  2. Maximum cost exceeded
 *  3. Maximum wall-clock duration exceeded
 *  4. Maximum consecutive repairs exceeded
 *  5. Exact fingerprint repetition (same iteration hash seen before)
 *  6. Repeated hypotheses (same hypothesis ID tried N times)
 *  7. Repeated same tool failure (same tool+error N times)
 *  8. Phase pair oscillation (transition pair repeating in window)
 *  9. State trajectory oscillation (N-phase cycle in full trajectory)
 * 10. No progress (same fingerprint across consecutive iterations)
 *
 * This module is pure domain logic — no I/O, no infrastructure dependency.
 *
 * THRESHOLD DOCUMENTATION
 * All thresholds are configurable. Defaults are documented below.
 * No magic numbers appear without a comment explaining their basis.
 */
import type { GoalConstraints } from '../model/goal.js';
import type { LifecycleGoal } from '../goal/goal-state.js';
import type { Iteration, IterationFingerprint } from '../model/iteration.js';
import type { AgentState, StateTransition } from '../model/state.js';
import { AgentPhase } from '../model/state.js';
import { TerminationReason, continueExecution, terminate } from '../model/termination.js';
import type { TerminationDecision, TerminationEvidence } from '../model/termination.js';
import {
  buildLoopFingerprint,
  buildLoopFingerprintFromRaw,
  loopFingerprintsMatch,
  detectTrajectoryCycle,
} from './loop-fingerprint.js';
import type { LoopFingerprint } from './loop-fingerprint.js';

// ---------------------------------------------------------------------------
// Loop control configuration — all thresholds configurable, all documented
// ---------------------------------------------------------------------------

export interface LoopControlConfig {
  /**
   * How many recent transitions to scan for phase-pair oscillation.
   *
   * Default: 10
   * Rationale: A typical task takes 3–7 transitions. Scanning 10 provides
   * a clear signal of oscillation without noise from earlier phases.
   */
  readonly oscillationWindowSize: number;

  /**
   * Minimum number of times a phase-pair must repeat within the window
   * to trigger oscillation detection.
   *
   * Default: 3
   * Rationale: A pair appearing twice may be coincidental (e.g., a second
   * verify-repair cycle is normal). Three appearances reliably indicates a loop.
   */
  readonly oscillationThreshold: number;

  /**
   * How many consecutive iterations with the same fingerprint trigger
   * no-progress termination.
   *
   * Default: 3
   * Rationale: One identical iteration may be a transient tool retry.
   * Two identical iterations suggests a problem. Three identical iterations
   * confirms no progress is being made.
   */
  readonly noProgressWindowSize: number;

  /**
   * How many times the same hypothesis ID must appear across all iterations
   * before triggering repeated-hypothesis termination.
   *
   * Default: 3
   * Rationale: Trying the same hypothesis twice may be intentional (with
   * a different patch). Three times strongly suggests the agent is stuck.
   */
  readonly maxRepeatedHypothesisCount: number;

  /**
   * How many times the same tool+error combination must appear across all
   * iterations before triggering repeated-tool-failure termination.
   *
   * Default: 3
   * Rationale: A tool may fail transiently (network, lock). Three failures
   * with the same signature indicates the failure is deterministic, not transient.
   */
  readonly maxRepeatedToolFailures: number;

  /**
   * The N-phase cycle length to detect in state trajectory oscillation.
   *
   * Default: 3
   * Rationale: The canonical pathological cycle is IMPLEMENT→VERIFY→REPAIR (length 3).
   * A length-2 cycle is handled by oscillationThreshold. Length 3+ covers
   * more complex cycles that pair-counting misses.
   *
   * The algorithm requires 2*N phases in the trajectory to fire.
   */
  readonly trajectoryOscillationLength: number;
}

export const DEFAULT_LOOP_CONTROL_CONFIG: Readonly<LoopControlConfig> = {
  oscillationWindowSize: 10,
  oscillationThreshold: 3,
  noProgressWindowSize: 3,
  maxRepeatedHypothesisCount: 3,
  maxRepeatedToolFailures: 3,
  trajectoryOscillationLength: 3,
};

// ---------------------------------------------------------------------------
// Main evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate all loop-control rules and return a structured termination decision.
 *
 * The first violated rule produces the termination decision.
 * If no rules are violated, returns continueExecution().
 *
 * GUARANTEE: No terminal decision is produced without at least one evidence
 * item explaining the specific detection.
 */
export function evaluateLoopControl(params: {
  state: AgentState;
  constraints: GoalConstraints;
  iterations: ReadonlyArray<Iteration>;
  transitions: ReadonlyArray<StateTransition>;
  elapsedMs: number;
  totalCostDollars: number;
  goal?: LifecycleGoal;
  config?: LoopControlConfig;
}): TerminationDecision {
  const config = params.config ?? DEFAULT_LOOP_CONTROL_CONFIG;
  const iterationsAnalyzed = params.iterations.length;

  // Build LoopFingerprints once — reused by multiple checks
  const fingerprints = params.iterations.map((it) => buildLoopFingerprint(it));

  // --- 0. Task Completion ---
  if (params.state.phase === AgentPhase.DONE) {
    return terminate({
      reason: TerminationReason.SUCCESS,
      evidence: [
        {
          type: 'ACCEPTANCE_GATE',
          description: 'Agent reached DONE phase — all acceptance criteria satisfied.',
        },
      ],
      iterationsAnalyzed,
      evidenceIds: [],
      confidence: 1.0,
      humanRequired: false,
      recommendedAction: 'Task completed successfully',
    });
  }

  // --- Goal-Level Budgets (from DSH & Prime Agent) ---
  if (params.goal) {
    // 1. Goal round budget
    const roundCheck = checkGoalRoundBudget(
      params.goal.roundsStarted,
      params.goal.maxRounds,
      iterationsAnalyzed,
    );
    if (roundCheck.terminal) return roundCheck;

    // 2. Goal token budget
    if (params.goal.tokenBudget !== undefined) {
      const tokenCheck = checkGoalTokenBudget(
        params.goal.tokensUsed,
        params.goal.tokenBudget,
        iterationsAnalyzed,
      );
      if (tokenCheck.terminal) return tokenCheck;
    }

    // 3. Goal cost budget
    if (params.goal.costBudget !== undefined) {
      const costCheck = checkGoalCostBudget(
        params.goal.costUsed,
        params.goal.costBudget,
        iterationsAnalyzed,
      );
      if (costCheck.terminal) return costCheck;
    }
  }

  // --- Global Execution Budgets ---
  // --- 1. Maximum iterations ---
  {
    const current = Math.max(params.state.iterationCount, params.iterations.length);
    const check = checkMaxIterations(current, params.constraints.maxIterations, iterationsAnalyzed);
    if (check.terminal) return check;
  }

  // --- 2. Maximum cost ---
  {
    const check = checkMaxCost(
      params.totalCostDollars,
      params.constraints.maxCostDollars,
      iterationsAnalyzed,
    );
    if (check.terminal) return check;
  }

  // --- 3. Maximum duration ---
  {
    const check = checkMaxDuration(
      params.elapsedMs,
      params.constraints.maxDurationMs,
      iterationsAnalyzed,
    );
    if (check.terminal) return check;
  }

  // --- 4. Maximum consecutive repairs ---
  {
    const check = checkMaxRepairs(
      params.state.repairCount,
      params.constraints.maxRepairAttempts,
      iterationsAnalyzed,
    );
    if (check.terminal) return check;
  }

  // --- 5. Exact fingerprint repetition ---
  {
    const check = checkExactRepetition(fingerprints, iterationsAnalyzed);
    if (check.terminal) return check;
  }

  // --- 6. Repeated hypotheses ---
  {
    const check = checkRepeatedHypotheses(
      params.iterations,
      config.maxRepeatedHypothesisCount,
      iterationsAnalyzed,
    );
    if (check.terminal) return check;
  }

  // --- 7. Repeated tool failure ---
  {
    const check = checkRepeatedToolFailure(
      params.iterations,
      config.maxRepeatedToolFailures,
      iterationsAnalyzed,
    );
    if (check.terminal) return check;
  }

  // --- 8. Phase-pair oscillation ---
  {
    const check = checkOscillation(
      params.transitions,
      config.oscillationWindowSize,
      config.oscillationThreshold,
      iterationsAnalyzed,
    );
    if (check.terminal) return check;
  }

  // --- 9. State trajectory oscillation ---
  {
    const fullTrajectory = params.iterations.flatMap((it) => it.fingerprint.stateTrajectory ?? []);
    const check = checkTrajectoryOscillation(
      fullTrajectory,
      config.trajectoryOscillationLength,
      iterationsAnalyzed,
    );
    if (check.terminal) return check;
  }

  // --- 10. No progress ---
  {
    const check = checkNoProgress(
      params.iterations,
      config.noProgressWindowSize,
      iterationsAnalyzed,
    );
    if (check.terminal) return check;
  }

  return continueExecution();
}

// ---------------------------------------------------------------------------
// Individual checks — exported for deterministic unit testing
// ---------------------------------------------------------------------------

export function checkGoalRoundBudget(
  roundsStarted: number,
  maxRounds: number,
  iterationsAnalyzed: number = 0,
): TerminationDecision {
  if (roundsStarted >= maxRounds) {
    return terminate({
      reason: TerminationReason.MAX_ITERATIONS,
      evidence: [
        {
          type: 'BUDGET_LIMIT',
          description: `Goal round budget exhausted: ${roundsStarted} rounds reached maximum of ${maxRounds}.`,
          data: { blockerCode: 'budget-exhausted', roundsStarted, maxRounds },
        },
      ],
      iterationsAnalyzed,
      recommendedAction: 'Increase goal maxRounds or clear goal',
    });
  }
  return continueExecution();
}

export function checkGoalTokenBudget(
  tokensUsed: number,
  tokenBudget: number,
  iterationsAnalyzed: number = 0,
): TerminationDecision {
  if (tokensUsed >= tokenBudget) {
    return terminate({
      reason: TerminationReason.MAX_COST,
      evidence: [
        {
          type: 'BUDGET_LIMIT',
          description: `Goal token budget exhausted: ${tokensUsed} tokens reached configured limit of ${tokenBudget}.`,
          data: { blockerCode: 'budget-exhausted', tokensUsed, tokenBudget },
        },
      ],
      iterationsAnalyzed,
      recommendedAction: 'Increase goal tokenBudget or simplify objective',
    });
  }
  return continueExecution();
}

export function checkGoalCostBudget(
  costUsed: number,
  costBudget: number,
  iterationsAnalyzed: number = 0,
): TerminationDecision {
  if (costUsed >= costBudget) {
    return terminate({
      reason: TerminationReason.MAX_COST,
      evidence: [
        {
          type: 'BUDGET_LIMIT',
          description: `Goal cost budget exhausted: $${costUsed.toFixed(4)} reached configured limit of $${costBudget.toFixed(4)}.`,
          data: { blockerCode: 'budget-exhausted', costUsed, costBudget },
        },
      ],
      iterationsAnalyzed,
      recommendedAction: 'Increase goal costBudget',
    });
  }
  return continueExecution();
}

export function checkMaxIterations(
  current: number,
  max: number,
  iterationsAnalyzed: number = 0,
): TerminationDecision {
  if (current >= max) {
    return terminate({
      reason: TerminationReason.MAX_ITERATIONS,
      evidence: [
        {
          type: 'BUDGET_LIMIT',
          description: `Iteration count ${current} reached configured maximum of ${max}.`,
          data: { current, max },
        },
      ],
      iterationsAnalyzed,
      recommendedAction: 'Increase iteration budget or simplify the task',
    });
  }
  return continueExecution();
}

export function checkMaxCost(
  currentDollars: number,
  maxDollars: number,
  iterationsAnalyzed: number = 0,
): TerminationDecision {
  if (currentDollars >= maxDollars) {
    return terminate({
      reason: TerminationReason.MAX_COST,
      evidence: [
        {
          type: 'BUDGET_EXHAUSTION',
          description: `Cumulative cost $${currentDollars.toFixed(4)} reached configured maximum of $${maxDollars.toFixed(4)}.`,
          data: { currentDollars, maxDollars },
        },
      ],
      iterationsAnalyzed,
      recommendedAction: 'Increase cost budget or use a cheaper model',
    });
  }
  return continueExecution();
}

export function checkMaxDuration(
  elapsedMs: number,
  maxMs: number,
  iterationsAnalyzed: number = 0,
): TerminationDecision {
  if (elapsedMs >= maxMs) {
    return terminate({
      reason: TerminationReason.MAX_DURATION,
      evidence: [
        {
          type: 'BUDGET_EXHAUSTION',
          description: `Elapsed time ${elapsedMs}ms reached configured maximum of ${maxMs}ms.`,
          data: { elapsedMs, maxMs },
        },
      ],
      iterationsAnalyzed,
      recommendedAction: 'Increase time budget or decompose the task',
    });
  }
  return continueExecution();
}

export function checkMaxRepairs(
  consecutiveRepairs: number,
  maxRepairs: number,
  iterationsAnalyzed: number = 0,
): TerminationDecision {
  if (consecutiveRepairs >= maxRepairs) {
    return terminate({
      reason: TerminationReason.MAX_REPAIRS,
      evidence: [
        {
          type: 'BUDGET_LIMIT',
          description: `Consecutive repair count ${consecutiveRepairs} reached configured maximum of ${maxRepairs}.`,
          data: { consecutiveRepairs, maxRepairs },
        },
      ],
      iterationsAnalyzed,
      humanRequired: true,
      recommendedAction: 'Escalate to human — agent cannot self-repair',
    });
  }
  return continueExecution();
}

/**
 * Detect exact fingerprint repetition — same full iteration hash seen before.
 *
 * An "exact repetition" is when the current iteration's LoopFingerprint hash
 * exactly matches a hash seen in any previous iteration. This is stronger than
 * no-progress (which requires N consecutive same fingerprints) — this fires
 * on the first recurrence anywhere in history.
 *
 * The O(1) hash lookup makes this check cheap even with long histories.
 */
export function checkExactRepetition(
  fingerprints: ReadonlyArray<LoopFingerprint>,
  iterationsAnalyzed: number = 0,
): TerminationDecision {
  const seen = new Map<string, number>(); // hash → first-seen iteration index

  for (let i = 0; i < fingerprints.length; i++) {
    const fp = fingerprints[i]!;
    const prior = seen.get(fp.hash);

    if (prior !== undefined && i > 0) {
      // Exact repetition confirmed — verify with field-by-field match
      if (loopFingerprintsMatch(fp, fingerprints[prior]!)) {
        return terminate({
          reason: TerminationReason.EXACT_REPETITION,
          evidence: [
            {
              type: 'FINGERPRINT_MATCH',
              description: `Iteration ${i + 1} is an exact repeat of iteration ${prior + 1} (fingerprint hash: ${fp.hash}).`,
              data: {
                currentIterationIndex: i,
                priorIterationIndex: prior,
                fingerprintHash: fp.hash,
              },
            },
          ],
          iterationsAnalyzed,
          humanRequired: true,
          recommendedAction:
            'Agent reproduced the exact same iteration state. No progress possible without external intervention.',
        });
      }
    }

    if (prior === undefined) {
      seen.set(fp.hash, i);
    }
  }

  return continueExecution();
}

/**
 * Detect repeated hypotheses — same hypothesis ID appearing too many times.
 *
 * Configurable threshold: maxRepeatedHypothesisCount (default: 3, documented in config).
 * Null hypothesis IDs are ignored — null means no explicit hypothesis was set.
 */
export function checkRepeatedHypotheses(
  iterations: ReadonlyArray<Iteration>,
  maxCount: number = DEFAULT_LOOP_CONTROL_CONFIG.maxRepeatedHypothesisCount,
  iterationsAnalyzed: number = 0,
): TerminationDecision {
  const hypothesisCounts = new Map<string, number>();

  for (const iteration of iterations) {
    const hId = iteration.fingerprint.hypothesisId;
    if (hId !== null) {
      const count = (hypothesisCounts.get(hId) ?? 0) + 1;
      hypothesisCounts.set(hId, count);

      if (count >= maxCount) {
        return terminate({
          reason: TerminationReason.REPEATED_HYPOTHESIS,
          evidence: [
            {
              type: 'HYPOTHESIS_REPETITION',
              description: `Hypothesis "${hId}" has been attempted ${count} times (threshold: ${maxCount}). Agent is cycling through the same approach.`,
              data: { hypothesisId: hId, count, threshold: maxCount },
            },
          ],
          iterationsAnalyzed,
          humanRequired: true,
          recommendedAction:
            'Agent is repeating the same hypothesis. Needs new direction from human or a different planning approach.',
        });
      }
    }
  }

  return continueExecution();
}

/**
 * Detect repeated tool failure — same tool+error signature appearing too many times.
 *
 * Configurable threshold: maxRepeatedToolFailures (default: 3, documented in config).
 * Null toolFailureSignature means no tool failure occurred — these are skipped.
 */
export function checkRepeatedToolFailure(
  iterations: ReadonlyArray<Iteration>,
  maxCount: number = DEFAULT_LOOP_CONTROL_CONFIG.maxRepeatedToolFailures,
  iterationsAnalyzed: number = 0,
): TerminationDecision {
  const failureCounts = new Map<string, number>();

  for (const iteration of iterations) {
    const sig = iteration.fingerprint.toolFailureSignature;
    if (sig !== null) {
      const count = (failureCounts.get(sig) ?? 0) + 1;
      failureCounts.set(sig, count);

      if (count >= maxCount) {
        return terminate({
          reason: TerminationReason.REPEATED_TOOL_FAILURE,
          evidence: [
            {
              type: 'TOOL_FAILURE_REPETITION',
              description: `Tool failure signature "${sig}" has occurred ${count} times (threshold: ${maxCount}). The failure appears deterministic, not transient.`,
              data: { toolFailureSignature: sig, count, threshold: maxCount },
            },
          ],
          iterationsAnalyzed,
          humanRequired: true,
          recommendedAction:
            'A tool is failing repeatedly with the same error. Requires human intervention or tool configuration change.',
        });
      }
    }
  }

  return continueExecution();
}

/**
 * Detect phase-pair oscillation — same (from→to) pair repeating within a window.
 *
 * Looks at the last `windowSize` transitions for a repeating phase pair.
 * Example: VERIFY→REPAIR appearing 3 times within 10 transitions.
 *
 * Configurable: oscillationWindowSize (default: 10), oscillationThreshold (default: 3).
 * Both are documented in LoopControlConfig.
 */
export function checkOscillation(
  transitions: ReadonlyArray<StateTransition>,
  windowSize: number = DEFAULT_LOOP_CONTROL_CONFIG.oscillationWindowSize,
  threshold: number = DEFAULT_LOOP_CONTROL_CONFIG.oscillationThreshold,
  iterationsAnalyzed: number = 0,
): TerminationDecision {
  if (transitions.length < 2) {
    return continueExecution();
  }

  const window = transitions.slice(-windowSize);
  const phasePairCounts = new Map<string, number>();

  for (let i = 0; i < window.length - 1; i++) {
    const pair = `${window[i]!.from}->${window[i]!.to}`;
    phasePairCounts.set(pair, (phasePairCounts.get(pair) ?? 0) + 1);
  }

  for (const [pair, count] of phasePairCounts) {
    if (count >= threshold) {
      return terminate({
        reason: TerminationReason.OSCILLATION,
        evidence: [
          {
            type: 'OSCILLATION_PATTERN',
            description: `Phase pair "${pair}" occurred ${count} times within the last ${Math.min(window.length, windowSize)} transitions (threshold: ${threshold}).`,
            data: { pair, count, threshold, windowSize },
          },
        ],
        iterationsAnalyzed,
        humanRequired: true,
        recommendedAction:
          'Agent is oscillating between phases. Needs human intervention or a different repair strategy.',
      });
    }
  }

  return continueExecution();
}

/**
 * Detect state trajectory oscillation — N-phase repeating cycle in the full trajectory.
 *
 * This detects longer cycles that pair-counting misses.
 * Example: IMPLEMENT→VERIFY→REPAIR repeating (length-3 cycle).
 *
 * Algorithm: looks at the last 2*N phases in the trajectory; if the
 * last N phases exactly match the preceding N phases, a cycle is confirmed.
 *
 * Configurable: trajectoryOscillationLength (default: 3, documented in config).
 * Requires 2*N phases in the trajectory to fire.
 */
export function checkTrajectoryOscillation(
  trajectory: ReadonlyArray<AgentPhase>,
  cycleLength: number = DEFAULT_LOOP_CONTROL_CONFIG.trajectoryOscillationLength,
  iterationsAnalyzed: number = 0,
): TerminationDecision {
  const cycle = detectTrajectoryCycle(trajectory, cycleLength);

  if (cycle !== null) {
    return terminate({
      reason: TerminationReason.TRAJECTORY_OSCILLATION,
      evidence: [
        {
          type: 'TRAJECTORY_CYCLE',
          description: `Detected a repeating ${cycleLength}-phase cycle in the state trajectory: ${cycle.join('→')}.`,
          data: {
            cycle: [...cycle],
            cycleLength,
            trajectoryLength: trajectory.length,
          },
        },
      ],
      iterationsAnalyzed,
      humanRequired: true,
      recommendedAction: `Agent is cycling through a ${cycleLength}-phase loop. A new approach or human direction is required.`,
    });
  }

  return continueExecution();
}

/**
 * Detect no progress — consecutive iterations with the same fingerprint.
 *
 * "No progress" requires ALL of the following to be identical across N consecutive iterations:
 *   - error signature
 *   - hypothesis ID
 *   - failing test set
 *   - patch signature
 *   - files modified set
 *   - tool failure signature
 *   - state trajectory
 *
 * Configurable: noProgressWindowSize (default: 3, documented in config).
 */
export function checkNoProgress(
  iterations: ReadonlyArray<Iteration>,
  maxConsecutive: number = DEFAULT_LOOP_CONTROL_CONFIG.noProgressWindowSize,
  iterationsAnalyzed: number = 0,
): TerminationDecision {
  if (iterations.length < maxConsecutive) {
    return continueExecution();
  }

  const recent = iterations.slice(-maxConsecutive);
  const referenceFp = buildLoopFingerprintFromRaw(recent[0]!.fingerprint);

  const allSame = recent.every((iteration) =>
    loopFingerprintsMatch(buildLoopFingerprintFromRaw(iteration.fingerprint), referenceFp),
  );

  if (allSame) {
    const evidence: TerminationEvidence[] = [
      {
        type: 'NO_PROGRESS_SPAN',
        description: `The last ${maxConsecutive} consecutive iterations produced identical fingerprints (hash: ${referenceFp.hash}). No progress was made.`,
        data: {
          windowSize: maxConsecutive,
          fingerprintHash: referenceFp.hash,
          hypothesisId: referenceFp.hypothesisId,
          errorSignature: referenceFp.errorSignature,
          failingTests: [...referenceFp.failingTests],
        },
      },
    ];

    return terminate({
      reason: TerminationReason.NO_PROGRESS,
      evidence,
      iterationsAnalyzed,
      humanRequired: true,
      confidence: 0.9,
      recommendedAction: `Agent made no progress for ${maxConsecutive} consecutive iterations. Human intervention or task decomposition required.`,
    });
  }

  return continueExecution();
}

// ---------------------------------------------------------------------------
// Legacy compat — kept for backward compatibility with existing tests
// ---------------------------------------------------------------------------

/**
 * Compare two raw IterationFingerprints for semantic equality.
 * @deprecated Use loopFingerprintsMatch with LoopFingerprint objects instead.
 */
export function fingerprintsMatch(a: IterationFingerprint, b: IterationFingerprint): boolean {
  return loopFingerprintsMatch(buildLoopFingerprintFromRaw(a), buildLoopFingerprintFromRaw(b));
}
