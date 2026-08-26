import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentPhase,
  StateEvent,
  TerminationReason,
  DEFAULT_GOAL_CONSTRAINTS,
  evaluateLoopControl,
  checkMaxIterations,
  checkMaxCost,
  checkMaxDuration,
  checkMaxRepairs,
  checkExactRepetition,
  checkRepeatedHypotheses,
  checkRepeatedToolFailure,
  checkOscillation,
  checkTrajectoryOscillation,
  checkNoProgress,
  fingerprintsMatch,
  DEFAULT_LOOP_CONTROL_CONFIG,
  buildLoopFingerprint,
  buildLoopFingerprintFromRaw,
  loopFingerprintsMatch,
  computeFingerprintHash,
  detectTrajectoryCycle,
} from '../../../src/core/index.js';
import type {
  AgentState,
  GoalConstraints,
  Iteration,
  IterationFingerprint,
  StateTransition,
  TerminationDecision,
  TerminationEvidence,
} from '../../../src/core/index.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';

describe('Loop Control Engine', () => {
  let idFactory: UuidV7IdFactory;

  beforeEach(() => {
    idFactory = new UuidV7IdFactory();
  });

  const createDummyState = (override?: Partial<AgentState>): AgentState => ({
    id: idFactory.create<'State'>(),
    taskId: idFactory.create<'Task'>(),
    phase: AgentPhase.IMPLEMENT,
    previousPhase: AgentPhase.PLAN,
    iterationId: idFactory.create<'Iteration'>(),
    iterationCount: 1,
    repairCount: 0,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...override,
  });

  const createDummyFingerprint = (
    override?: Partial<IterationFingerprint>,
  ): IterationFingerprint => ({
    filesModified: ['src/app.ts'],
    hypothesisId: idFactory.create<'Hypothesis'>(),
    errorSignature: 'ERR_001',
    patchSignature: 'PATCH_AAA',
    failingTests: ['test_1'],
    phaseAtStart: AgentPhase.IMPLEMENT,
    stateTrajectory: [AgentPhase.IMPLEMENT],
    toolFailureSignature: null,
    ...override,
  });

  const createDummyIteration = (seq: number, fingerprint?: IterationFingerprint): Iteration => ({
    id: idFactory.create<'Iteration'>(),
    taskId: idFactory.create<'Task'>(),
    sequenceNumber: seq,
    outcome: 0 as any,
    fingerprint: fingerprint ?? createDummyFingerprint(),
    evidenceIds: [],
    actionIds: [],
    startedAt: new Date(),
    completedAt: new Date(),
    durationMs: 1000,
    costDollars: 0.05,
    metadata: {},
  });

  // Helper to assert a TerminationDecision is terminal with the right reason
  // AND carries structured evidence
  function assertTerminalWithEvidence(
    decision: TerminationDecision,
    expectedReason: TerminationReason,
  ): TerminationEvidence[] {
    expect(decision.terminal).toBe(true);
    expect(decision.reason).toBe(expectedReason);
    expect(decision.evidence).toBeDefined();
    expect(decision.evidence.length).toBeGreaterThan(0);
    expect(typeof decision.evidence[0]!.description).toBe('string');
    expect(decision.evidence[0]!.description.length).toBeGreaterThan(0);
    return decision.evidence as TerminationEvidence[];
  }

  // =========================================================================
  // Budget & Limit Checks
  // =========================================================================

  describe('Budget & Limit Checks', () => {
    it('checkMaxIterations should continue below limit', () => {
      expect(checkMaxIterations(5, 10).terminal).toBe(false);
    });

    it('checkMaxIterations should terminate at limit with structured evidence', () => {
      const res = checkMaxIterations(10, 10, 10);
      const ev = assertTerminalWithEvidence(res, TerminationReason.MAX_ITERATIONS);
      expect(ev[0]!.type).toBe('BUDGET_LIMIT');
      expect(res.iterationsAnalyzed).toBe(10);
      expect(ev[0]!.data).toMatchObject({ current: 10, max: 10 });
    });

    it('checkMaxCost should continue below limit', () => {
      expect(checkMaxCost(4.5, 5.0).terminal).toBe(false);
    });

    it('checkMaxCost should terminate at limit with structured evidence', () => {
      const res = checkMaxCost(5.0, 5.0, 7);
      const ev = assertTerminalWithEvidence(res, TerminationReason.MAX_COST);
      expect(ev[0]!.type).toBe('BUDGET_EXHAUSTION');
      expect(res.iterationsAnalyzed).toBe(7);
      expect(ev[0]!.data).toMatchObject({ currentDollars: 5.0, maxDollars: 5.0 });
    });

    it('checkMaxDuration should continue below limit', () => {
      expect(checkMaxDuration(1000, 5000).terminal).toBe(false);
    });

    it('checkMaxDuration should terminate at limit with structured evidence', () => {
      const res = checkMaxDuration(5000, 5000, 3);
      const ev = assertTerminalWithEvidence(res, TerminationReason.MAX_DURATION);
      expect(ev[0]!.type).toBe('BUDGET_EXHAUSTION');
      expect(ev[0]!.data).toMatchObject({ elapsedMs: 5000, maxMs: 5000 });
    });

    it('checkMaxRepairs should continue below limit', () => {
      expect(checkMaxRepairs(2, 5).terminal).toBe(false);
    });

    it('checkMaxRepairs should terminate at limit and request human', () => {
      const res = checkMaxRepairs(5, 5, 5);
      const ev = assertTerminalWithEvidence(res, TerminationReason.MAX_REPAIRS);
      expect(res.humanRequired).toBe(true);
      expect(ev[0]!.type).toBe('BUDGET_LIMIT');
      expect(ev[0]!.data).toMatchObject({ consecutiveRepairs: 5, maxRepairs: 5 });
    });
  });

  // =========================================================================
  // LoopFingerprint Abstraction
  // =========================================================================

  describe('LoopFingerprint Abstraction', () => {
    it('buildLoopFingerprintFromRaw should produce a stable hash', () => {
      const fp = createDummyFingerprint({
        hypothesisId: 'hyp-123' as any,
        errorSignature: 'ERR_ABC',
        patchSignature: 'PATCH_XYZ',
        toolFailureSignature: null,
        failingTests: ['test_b', 'test_a'], // deliberately unordered
        filesModified: ['src/b.ts', 'src/a.ts'],
        stateTrajectory: [AgentPhase.IMPLEMENT, AgentPhase.VERIFY],
      });

      const loopFp = buildLoopFingerprintFromRaw(fp);

      // Hash must be stable
      const loopFp2 = buildLoopFingerprintFromRaw(fp);
      expect(loopFp.hash).toBe(loopFp2.hash);

      // Sets must be sorted
      expect(loopFp.failingTests).toEqual(['test_a', 'test_b']);
      expect(loopFp.filesModified).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('loopFingerprintsMatch should return true for identical fingerprints', () => {
      const fp = createDummyFingerprint({ hypothesisId: 'same-hyp' as any });
      const lfp1 = buildLoopFingerprintFromRaw(fp);
      const lfp2 = buildLoopFingerprintFromRaw(fp);
      expect(loopFingerprintsMatch(lfp1, lfp2)).toBe(true);
    });

    it('loopFingerprintsMatch should return false when errorSignature differs', () => {
      const fp1 = createDummyFingerprint({ errorSignature: 'ERR_A' });
      const fp2 = createDummyFingerprint({ errorSignature: 'ERR_B' });
      expect(
        loopFingerprintsMatch(buildLoopFingerprintFromRaw(fp1), buildLoopFingerprintFromRaw(fp2)),
      ).toBe(false);
    });

    it('loopFingerprintsMatch should return false when stateTrajectory differs', () => {
      const fp1 = createDummyFingerprint({ stateTrajectory: [AgentPhase.IMPLEMENT] });
      const fp2 = createDummyFingerprint({ stateTrajectory: [AgentPhase.VERIFY] });
      expect(
        loopFingerprintsMatch(buildLoopFingerprintFromRaw(fp1), buildLoopFingerprintFromRaw(fp2)),
      ).toBe(false);
    });

    it('computeFingerprintHash should produce different hashes for different inputs', () => {
      const h1 = computeFingerprintHash({
        hypothesisId: 'A',
        errorSignature: 'ERR',
        patchSignature: null,
        toolFailureSignature: null,
        failingTests: [],
        filesModified: [],
        stateTrajectory: [],
      });
      const h2 = computeFingerprintHash({
        hypothesisId: 'B',
        errorSignature: 'ERR',
        patchSignature: null,
        toolFailureSignature: null,
        failingTests: [],
        filesModified: [],
        stateTrajectory: [],
      });
      expect(h1).not.toBe(h2);
    });

    it('buildLoopFingerprint from Iteration should produce same result as buildLoopFingerprintFromRaw', () => {
      const fp = createDummyFingerprint();
      const iteration = createDummyIteration(1, fp);
      const fromIteration = buildLoopFingerprint(iteration);
      const fromRaw = buildLoopFingerprintFromRaw(fp);
      expect(fromIteration.hash).toBe(fromRaw.hash);
    });
  });

  // =========================================================================
  // Exact Repetition Detection
  // =========================================================================

  describe('Exact Repetition Detection', () => {
    it('should detect exact repetition when same fingerprint hash seen before', () => {
      const fp = createDummyFingerprint({
        hypothesisId: 'same-hyp' as any,
        errorSignature: 'same-error',
        patchSignature: 'same-patch',
      });

      const fingerprints = [
        buildLoopFingerprintFromRaw(fp),
        buildLoopFingerprintFromRaw(createDummyFingerprint({ patchSignature: 'different' })),
        buildLoopFingerprintFromRaw(fp), // Exact repeat of index 0
      ];

      const res = checkExactRepetition(fingerprints, 3);
      const ev = assertTerminalWithEvidence(res, TerminationReason.EXACT_REPETITION);
      expect(res.humanRequired).toBe(true);
      expect(ev[0]!.type).toBe('FINGERPRINT_MATCH');
      expect(ev[0]!.data).toMatchObject({ currentIterationIndex: 2, priorIterationIndex: 0 });
    });

    it('should continue when all fingerprints are unique', () => {
      const fingerprints = [
        buildLoopFingerprintFromRaw(createDummyFingerprint({ patchSignature: 'A' })),
        buildLoopFingerprintFromRaw(createDummyFingerprint({ patchSignature: 'B' })),
        buildLoopFingerprintFromRaw(createDummyFingerprint({ patchSignature: 'C' })),
      ];

      expect(checkExactRepetition(fingerprints, 3).terminal).toBe(false);
    });

    it('should not trigger on the very first occurrence (only on repeat)', () => {
      const fp = createDummyFingerprint({ hypothesisId: 'hyp-A' as any });
      const fingerprints = [buildLoopFingerprintFromRaw(fp)]; // Only one, no repeat
      expect(checkExactRepetition(fingerprints, 1).terminal).toBe(false);
    });
  });

  // =========================================================================
  // Repeated Hypotheses
  // =========================================================================

  describe('Repeated Hypotheses', () => {
    it('should terminate if same hypothesisId is tried at or above threshold', () => {
      const hypId = idFactory.create<'Hypothesis'>();
      const fp = createDummyFingerprint({ hypothesisId: hypId });

      const iters = [
        createDummyIteration(1, fp),
        createDummyIteration(2, fp),
        createDummyIteration(3, fp),
      ];

      const res = checkRepeatedHypotheses(iters, 3, 3);
      const ev = assertTerminalWithEvidence(res, TerminationReason.REPEATED_HYPOTHESIS);
      expect(res.humanRequired).toBe(true);
      expect(ev[0]!.type).toBe('HYPOTHESIS_REPETITION');
      expect(ev[0]!.data).toMatchObject({ count: 3, threshold: 3 });
    });

    it('should continue if hypothesis count is below threshold', () => {
      const hypId = idFactory.create<'Hypothesis'>();
      const fp = createDummyFingerprint({ hypothesisId: hypId });

      const iters = [createDummyIteration(1, fp), createDummyIteration(2, fp)];

      expect(checkRepeatedHypotheses(iters, 3, 2).terminal).toBe(false);
    });

    it('should continue if hypotheses differ', () => {
      const iters = [
        createDummyIteration(1, createDummyFingerprint()),
        createDummyIteration(2, createDummyFingerprint()),
        createDummyIteration(3, createDummyFingerprint()),
      ];
      expect(checkRepeatedHypotheses(iters, 3, 3).terminal).toBe(false);
    });

    it('should respect configurable threshold (threshold=2 fires earlier)', () => {
      const hypId = idFactory.create<'Hypothesis'>();
      const fp = createDummyFingerprint({ hypothesisId: hypId });

      const iters = [createDummyIteration(1, fp), createDummyIteration(2, fp)];
      // threshold=2: should fire
      expect(checkRepeatedHypotheses(iters, 2, 2).terminal).toBe(true);
      // threshold=3: should not fire
      expect(checkRepeatedHypotheses(iters, 3, 2).terminal).toBe(false);
    });
  });

  // =========================================================================
  // Repeated Tool Failure Detection
  // =========================================================================

  describe('Repeated Tool Failure Detection', () => {
    it('should detect repeated tool failure at or above threshold', () => {
      const sig = 'read_file:ENOENT';
      const fp = createDummyFingerprint({ toolFailureSignature: sig });

      const iters = [
        createDummyIteration(1, fp),
        createDummyIteration(2, fp),
        createDummyIteration(3, fp),
      ];

      const res = checkRepeatedToolFailure(iters, 3, 3);
      const ev = assertTerminalWithEvidence(res, TerminationReason.REPEATED_TOOL_FAILURE);
      expect(res.humanRequired).toBe(true);
      expect(ev[0]!.type).toBe('TOOL_FAILURE_REPETITION');
      expect(ev[0]!.data).toMatchObject({ toolFailureSignature: sig, count: 3, threshold: 3 });
    });

    it('should continue if tool failures are below threshold', () => {
      const sig = 'run_tests:TIMEOUT';
      const fp = createDummyFingerprint({ toolFailureSignature: sig });

      const iters = [createDummyIteration(1, fp), createDummyIteration(2, fp)];
      expect(checkRepeatedToolFailure(iters, 3, 2).terminal).toBe(false);
    });

    it('should continue if toolFailureSignature is null (no tool failures)', () => {
      const fp = createDummyFingerprint({ toolFailureSignature: null });
      const iters = [
        createDummyIteration(1, fp),
        createDummyIteration(2, fp),
        createDummyIteration(3, fp),
      ];
      expect(checkRepeatedToolFailure(iters, 3, 3).terminal).toBe(false);
    });

    it('should respect configurable threshold (threshold=2 fires earlier)', () => {
      const sig = 'write_file:EACCES';
      const fp = createDummyFingerprint({ toolFailureSignature: sig });

      const iters = [createDummyIteration(1, fp), createDummyIteration(2, fp)];
      expect(checkRepeatedToolFailure(iters, 2, 2).terminal).toBe(true);
      expect(checkRepeatedToolFailure(iters, 3, 2).terminal).toBe(false);
    });
  });

  // =========================================================================
  // Phase-Pair Oscillation Detection
  // =========================================================================

  describe('Phase-Pair Oscillation Detection', () => {
    it('should detect oscillation when transitions repeat phase pairs within window', () => {
      const transitions: StateTransition[] = [
        {
          id: '1',
          from: AgentPhase.REPAIR,
          to: AgentPhase.VERIFY,
          event: StateEvent.REPAIR_COMPLETE,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
        {
          id: '2',
          from: AgentPhase.VERIFY,
          to: AgentPhase.REPAIR,
          event: StateEvent.VERIFICATION_FAILED,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
        {
          id: '3',
          from: AgentPhase.REPAIR,
          to: AgentPhase.VERIFY,
          event: StateEvent.REPAIR_COMPLETE,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
        {
          id: '4',
          from: AgentPhase.VERIFY,
          to: AgentPhase.REPAIR,
          event: StateEvent.VERIFICATION_FAILED,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
        {
          id: '5',
          from: AgentPhase.REPAIR,
          to: AgentPhase.VERIFY,
          event: StateEvent.REPAIR_COMPLETE,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
        {
          id: '6',
          from: AgentPhase.VERIFY,
          to: AgentPhase.REPAIR,
          event: StateEvent.VERIFICATION_FAILED,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
      ];

      const res = checkOscillation(transitions, 10, 3, 6);
      const ev = assertTerminalWithEvidence(res, TerminationReason.OSCILLATION);
      expect(res.humanRequired).toBe(true);
      expect(ev[0]!.type).toBe('OSCILLATION_PATTERN');
      expect(ev[0]!.data).toMatchObject({ threshold: 3, windowSize: 10 });
    });

    it('should not trigger oscillation when transitions are progressive', () => {
      const transitions: StateTransition[] = [
        {
          id: '1',
          from: AgentPhase.INIT,
          to: AgentPhase.EXPLORE,
          event: StateEvent.START,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
        {
          id: '2',
          from: AgentPhase.EXPLORE,
          to: AgentPhase.PLAN,
          event: StateEvent.EXPLORE_COMPLETE,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
        {
          id: '3',
          from: AgentPhase.PLAN,
          to: AgentPhase.IMPLEMENT,
          event: StateEvent.PLAN_READY,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
      ];
      expect(checkOscillation(transitions, 10, 3, 3).terminal).toBe(false);
    });

    it('should respect configurable windowSize — transitions outside window do not count', () => {
      // 6 transitions, only look at last 4 — pair count below threshold in window
      const transitions: StateTransition[] = [
        {
          id: '1',
          from: AgentPhase.REPAIR,
          to: AgentPhase.VERIFY,
          event: StateEvent.REPAIR_COMPLETE,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
        {
          id: '2',
          from: AgentPhase.VERIFY,
          to: AgentPhase.REPAIR,
          event: StateEvent.VERIFICATION_FAILED,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
        {
          id: '3',
          from: AgentPhase.REPAIR,
          to: AgentPhase.VERIFY,
          event: StateEvent.REPAIR_COMPLETE,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
        // New phases from here (within a window=4)
        {
          id: '4',
          from: AgentPhase.VERIFY,
          to: AgentPhase.DONE,
          event: StateEvent.VERIFICATION_PASSED,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
        {
          id: '5',
          from: AgentPhase.INIT,
          to: AgentPhase.EXPLORE,
          event: StateEvent.START,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
        {
          id: '6',
          from: AgentPhase.EXPLORE,
          to: AgentPhase.PLAN,
          event: StateEvent.EXPLORE_COMPLETE,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
      ];

      // window=4 — last 4 are progressive, no oscillation
      expect(checkOscillation(transitions, 4, 3, 6).terminal).toBe(false);
    });
  });

  // =========================================================================
  // State Trajectory Oscillation Detection
  // =========================================================================

  describe('State Trajectory Oscillation Detection', () => {
    it('should detect 3-phase cycle: IMPLEMENT→VERIFY→REPAIR repeating', () => {
      const trajectory: AgentPhase[] = [
        AgentPhase.IMPLEMENT,
        AgentPhase.VERIFY,
        AgentPhase.REPAIR,
        AgentPhase.IMPLEMENT,
        AgentPhase.VERIFY,
        AgentPhase.REPAIR, // exact repeat
      ];

      const res = checkTrajectoryOscillation(trajectory, 3, 6);
      const ev = assertTerminalWithEvidence(res, TerminationReason.TRAJECTORY_OSCILLATION);
      expect(res.humanRequired).toBe(true);
      expect(ev[0]!.type).toBe('TRAJECTORY_CYCLE');
      expect(ev[0]!.data).toMatchObject({ cycleLength: 3 });
    });

    it('should not trigger when trajectory is too short for cycle detection', () => {
      const trajectory: AgentPhase[] = [AgentPhase.IMPLEMENT, AgentPhase.VERIFY];
      expect(checkTrajectoryOscillation(trajectory, 3, 1).terminal).toBe(false);
    });

    it('should not trigger when trajectory is progressive (no cycle)', () => {
      const trajectory: AgentPhase[] = [
        AgentPhase.INIT,
        AgentPhase.EXPLORE,
        AgentPhase.PLAN,
        AgentPhase.IMPLEMENT,
        AgentPhase.VERIFY,
        AgentPhase.DONE,
      ];
      expect(checkTrajectoryOscillation(trajectory, 3, 5).terminal).toBe(false);
    });

    it('detectTrajectoryCycle utility should correctly identify cycles', () => {
      const cycle3 = [AgentPhase.IMPLEMENT, AgentPhase.VERIFY, AgentPhase.REPAIR];
      const trajectory = [...cycle3, ...cycle3]; // 6 elements

      const detected = detectTrajectoryCycle(trajectory, 3);
      expect(detected).not.toBeNull();
      expect(detected).toEqual(cycle3);
    });

    it('detectTrajectoryCycle should return null for non-repeating trajectory', () => {
      const trajectory = [
        AgentPhase.IMPLEMENT,
        AgentPhase.VERIFY,
        AgentPhase.REPAIR,
        AgentPhase.EXPLORE,
        AgentPhase.PLAN,
        AgentPhase.IMPLEMENT,
      ];
      expect(detectTrajectoryCycle(trajectory, 3)).toBeNull();
    });
  });

  // =========================================================================
  // No Progress Detection
  // =========================================================================

  describe('No Progress Detection', () => {
    it('fingerprintsMatch (legacy shim) should correctly evaluate equality', () => {
      const fp1 = createDummyFingerprint();
      const fp2 = { ...fp1 };
      const fp3 = { ...fp1, errorSignature: 'ERR_002' };

      expect(fingerprintsMatch(fp1, fp2)).toBe(true);
      expect(fingerprintsMatch(fp1, fp3)).toBe(false);
    });

    it('checkNoProgress should detect identical consecutive fingerprints', () => {
      const fp = createDummyFingerprint({
        hypothesisId: 'stuck-hyp' as any,
        patchSignature: 'same-patch',
      });
      const iters = [
        createDummyIteration(1, fp),
        createDummyIteration(2, fp),
        createDummyIteration(3, fp),
      ];

      const res = checkNoProgress(iters, 3, 3);
      const ev = assertTerminalWithEvidence(res, TerminationReason.NO_PROGRESS);
      expect(res.humanRequired).toBe(true);
      expect(ev[0]!.type).toBe('NO_PROGRESS_SPAN');
      expect(ev[0]!.data).toMatchObject({ windowSize: 3 });
    });

    it('checkNoProgress should continue if any fingerprint aspect changes', () => {
      const fp1 = createDummyFingerprint({ patchSignature: 'A' });
      const fp2 = createDummyFingerprint({ patchSignature: 'B' });
      const fp3 = createDummyFingerprint({ patchSignature: 'C' });

      const iters = [
        createDummyIteration(1, fp1),
        createDummyIteration(2, fp2),
        createDummyIteration(3, fp3),
      ];

      expect(checkNoProgress(iters, 3, 3).terminal).toBe(false);
    });

    it('checkNoProgress should continue when not enough iterations accumulated', () => {
      const fp = createDummyFingerprint();
      const iters = [createDummyIteration(1, fp), createDummyIteration(2, fp)];
      // Only 2 iterations, threshold is 3
      expect(checkNoProgress(iters, 3, 2).terminal).toBe(false);
    });
  });

  // =========================================================================
  // Full evaluateLoopControl Aggregator
  // =========================================================================

  describe('Full evaluateLoopControl Aggregator', () => {
    it('should return continueExecution when all limits and rules are respected', () => {
      const state = createDummyState({ iterationCount: 2, repairCount: 1 });
      const constraints: GoalConstraints = { ...DEFAULT_GOAL_CONSTRAINTS };

      const res = evaluateLoopControl({
        state,
        constraints,
        iterations: [createDummyIteration(1)],
        transitions: [],
        elapsedMs: 5000,
        totalCostDollars: 0.1,
      });

      expect(res.terminal).toBe(false);
      expect(res.reason).toBeNull();
    });

    it('should prioritize earlier checks (maxIterations before maxCost)', () => {
      const state = createDummyState({ iterationCount: 50 });
      const constraints: GoalConstraints = {
        ...DEFAULT_GOAL_CONSTRAINTS,
        maxIterations: 10,
        maxCostDollars: 1.0,
      };

      const res = evaluateLoopControl({
        state,
        constraints,
        iterations: [],
        transitions: [],
        elapsedMs: 100,
        totalCostDollars: 500.0,
      });

      expect(res.terminal).toBe(true);
      expect(res.reason).toBe(TerminationReason.MAX_ITERATIONS);
    });

    it('should populate iterationsAnalyzed in every terminal decision', () => {
      const state = createDummyState({ iterationCount: 20 });
      const constraints: GoalConstraints = {
        ...DEFAULT_GOAL_CONSTRAINTS,
        maxIterations: 10,
      };
      const iterations = Array.from({ length: 5 }, (_, i) => createDummyIteration(i + 1));

      const res = evaluateLoopControl({
        state,
        constraints,
        iterations,
        transitions: [],
        elapsedMs: 100,
        totalCostDollars: 0.1,
      });

      expect(res.terminal).toBe(true);
      // iterationsAnalyzed is set to iterations.length
      expect(res.iterationsAnalyzed).toBe(5);
    });

    it('should use custom config thresholds (oscillationThreshold=2)', () => {
      const state = createDummyState({ iterationCount: 2 });
      const constraints: GoalConstraints = { ...DEFAULT_GOAL_CONSTRAINTS };

      const transitions: StateTransition[] = [
        {
          id: '1',
          from: AgentPhase.REPAIR,
          to: AgentPhase.VERIFY,
          event: StateEvent.REPAIR_COMPLETE,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
        {
          id: '2',
          from: AgentPhase.VERIFY,
          to: AgentPhase.REPAIR,
          event: StateEvent.VERIFICATION_FAILED,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
        {
          id: '3',
          from: AgentPhase.REPAIR,
          to: AgentPhase.VERIFY,
          event: StateEvent.REPAIR_COMPLETE,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
        {
          id: '4',
          from: AgentPhase.VERIFY,
          to: AgentPhase.REPAIR,
          event: StateEvent.VERIFICATION_FAILED,
          timestamp: new Date(),
          stateId: '' as any,
          evidenceIds: [],
          metadata: {},
        },
      ];

      // Default threshold=3 → should not trigger
      const resDefault = evaluateLoopControl({
        state,
        constraints,
        iterations: [createDummyIteration(1)],
        transitions,
        elapsedMs: 100,
        totalCostDollars: 0.1,
      });
      expect(resDefault.terminal).toBe(false);

      // Custom threshold=2 → should trigger
      const resCustom = evaluateLoopControl({
        state,
        constraints,
        iterations: [createDummyIteration(1)],
        transitions,
        elapsedMs: 100,
        totalCostDollars: 0.1,
        config: { ...DEFAULT_LOOP_CONTROL_CONFIG, oscillationThreshold: 2 },
      });
      expect(resCustom.terminal).toBe(true);
      expect(resCustom.reason).toBe(TerminationReason.OSCILLATION);
    });
  });
});
