import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentPhase,
  StateEvent,
  TERMINAL_PHASES,
  HUMAN_RESUMABLE_PHASES,
  HarnessError,
  ErrorCode,
  StateMachine,
  validateTransition,
  validateTransitionOrThrow,
  TRANSITION_TABLE,
} from '../../../src/core/index.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';
import { TestClock } from '../../../src/infra/time/test-clock.js';
import type { TaskId } from '../../../src/core/types/identifiers.js';

describe('State Machine & Transition Validation', () => {
  let idFactory: UuidV7IdFactory;
  let clock: TestClock;
  let taskId: TaskId;

  beforeEach(() => {
    idFactory = new UuidV7IdFactory();
    clock = new TestClock(new Date('2024-01-01T00:00:00Z'));
    taskId = idFactory.create<'Task'>();
  });

  describe('Transition Validator', () => {
    it('should validate all transitions in TRANSITION_TABLE as valid', () => {
      for (const rule of TRANSITION_TABLE) {
        const result = validateTransition(rule.from, rule.event, false);
        expect(result.valid).toBe(true);
        expect(result.from).toBe(rule.from);
        expect(result.event).toBe(rule.event);
        expect(result.to).toBe(rule.to);
      }
    });

    it('should reject invalid transitions (e.g., INIT -> DONE)', () => {
      const result = validateTransition(AgentPhase.INIT, StateEvent.MARK_DONE);
      expect(result.valid).toBe(false);
      expect(result.to).toBeNull();
      expect(result.reason).toContain('No transition defined');
    });

    it('should reject transitions from terminal states', () => {
      for (const terminalPhase of TERMINAL_PHASES) {
        const result = validateTransition(terminalPhase, StateEvent.START);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Cannot transition from terminal phase');
      }
    });

    it('should reject runtime-only events when emitted by LLM', () => {
      const result = validateTransition(
        AgentPhase.REPAIR,
        StateEvent.OSCILLATION_FOUND,
        true, // isLlmEmitted = true
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('can only be emitted by the runtime');
    });

    it('should throw HarnessError with STATE_INVALID_TRANSITION code on invalid transition in validateTransitionOrThrow', () => {
      expect(() => validateTransitionOrThrow(AgentPhase.IMPLEMENT, StateEvent.MARK_DONE)).toThrow(
        HarnessError,
      );

      try {
        validateTransitionOrThrow(AgentPhase.IMPLEMENT, StateEvent.MARK_DONE);
      } catch (err) {
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe(ErrorCode.STATE_INVALID_TRANSITION);
      }
    });
  });

  describe('StateMachine Behavior', () => {
    it('should initialize in INIT phase by default', () => {
      const sm = new StateMachine({ taskId, idFactory, clock });
      expect(sm.phase).toBe(AgentPhase.INIT);
      expect(sm.isTerminal).toBe(false);
      expect(sm.history).toHaveLength(0);
    });

    it('should execute valid transition lifecycle: INIT -> EXPLORE -> PLAN -> IMPLEMENT -> VERIFY -> DONE', () => {
      const sm = new StateMachine({ taskId, idFactory, clock });

      sm.apply(StateEvent.START);
      expect(sm.phase).toBe(AgentPhase.EXPLORE);

      sm.apply(StateEvent.EXPLORE_COMPLETE);
      expect(sm.phase).toBe(AgentPhase.PLAN);

      sm.apply(StateEvent.PLAN_READY);
      expect(sm.phase).toBe(AgentPhase.IMPLEMENT);

      sm.apply(StateEvent.IMPLEMENTATION_COMPLETE);
      expect(sm.phase).toBe(AgentPhase.VERIFY);
      expect(sm.state.iterationCount).toBe(1);

      const evidenceId = idFactory.create<'Evidence'>();
      sm.apply(StateEvent.VERIFICATION_PASSED, { evidenceIds: [evidenceId] });
      expect(sm.phase).toBe(AgentPhase.DONE);
      expect(sm.isTerminal).toBe(true);
      expect(sm.history).toHaveLength(5);
    });

    it('should handle repair cycle: VERIFY -> REPAIR -> VERIFY', () => {
      const sm = new StateMachine({
        taskId,
        idFactory,
        clock,
        initialPhase: AgentPhase.VERIFY,
      });

      sm.apply(StateEvent.VERIFICATION_FAILED);
      expect(sm.phase).toBe(AgentPhase.REPAIR);
      expect(sm.state.repairCount).toBe(1);

      sm.apply(StateEvent.REPAIR_COMPLETE);
      expect(sm.phase).toBe(AgentPhase.VERIFY);
      expect(sm.state.iterationCount).toBe(1);

      const evidenceId = idFactory.create<'Evidence'>();
      sm.apply(StateEvent.VERIFICATION_PASSED, { evidenceIds: [evidenceId] });
      expect(sm.phase).toBe(AgentPhase.DONE);
    });

    it('should handle escalation states: IMPLEMENT -> HUMAN_REQUIRED -> PLAN', () => {
      const sm = new StateMachine({
        taskId,
        idFactory,
        clock,
        initialPhase: AgentPhase.IMPLEMENT,
      });

      sm.apply(StateEvent.ESCALATE);
      expect(sm.phase).toBe(AgentPhase.HUMAN_REQUIRED);
      expect(HUMAN_RESUMABLE_PHASES.has(sm.phase)).toBe(true);

      sm.apply(StateEvent.HUMAN_RESPONDED);
      expect(sm.phase).toBe(AgentPhase.PLAN);
    });

    it('should handle cancellation from non-terminal states', () => {
      const sm = new StateMachine({
        taskId,
        idFactory,
        clock,
        initialPhase: AgentPhase.EXPLORE,
      });

      sm.apply(StateEvent.CANCEL);
      expect(sm.phase).toBe(AgentPhase.CANCELLED);
      expect(sm.isTerminal).toBe(true);
    });
  });

  describe('Serialization & Deterministic Replay', () => {
    it('should serialize to snapshot and restore cleanly', () => {
      const sm = new StateMachine({ taskId, idFactory, clock });
      sm.apply(StateEvent.START);
      sm.apply(StateEvent.EXPLORE_COMPLETE);

      const snapshot = sm.toSnapshot();
      expect(snapshot.state.phase).toBe(AgentPhase.PLAN);
      expect(snapshot.history).toHaveLength(2);

      const restoredSm = StateMachine.fromSnapshot(snapshot, idFactory, clock);
      expect(restoredSm.phase).toBe(AgentPhase.PLAN);
      expect(restoredSm.history).toHaveLength(2);

      // Continue restored machine
      restoredSm.apply(StateEvent.PLAN_READY);
      expect(restoredSm.phase).toBe(AgentPhase.IMPLEMENT);
    });

    it('should deterministically replay a sequence of events to produce identical history', () => {
      const eventsSequence = [
        StateEvent.START,
        StateEvent.EXPLORE_COMPLETE,
        StateEvent.PLAN_READY,
        StateEvent.IMPLEMENTATION_COMPLETE,
        StateEvent.VERIFICATION_FAILED,
        StateEvent.REPAIR_COMPLETE,
        StateEvent.VERIFICATION_PASSED,
      ];

      const runSequence = (): StateMachine => {
        const testClk = new TestClock(new Date('2024-01-01T00:00:00Z'));
        const sm = new StateMachine({
          taskId,
          idFactory,
          clock: testClk,
        });
        const evidenceId = idFactory.create<'Evidence'>();
        const eventsWithOptions: Array<[StateEvent, { evidenceIds?: string[] }?]> = [
          [StateEvent.START],
          [StateEvent.EXPLORE_COMPLETE],
          [StateEvent.PLAN_READY],
          [StateEvent.IMPLEMENTATION_COMPLETE],
          [StateEvent.VERIFICATION_FAILED],
          [StateEvent.REPAIR_COMPLETE],
          [StateEvent.VERIFICATION_PASSED, { evidenceIds: [evidenceId] }],
        ];
        for (const [ev, opts] of eventsWithOptions) {
          testClk.advance(1000);
          sm.apply(ev, opts as any);
        }
        return sm;
      };

      const sm1 = runSequence();
      const sm2 = runSequence();

      expect(sm1.phase).toBe(sm2.phase);
      expect(sm1.history).toHaveLength(sm2.history.length);

      for (let i = 0; i < sm1.history.length; i++) {
        expect(sm1.history[i]!.from).toBe(sm2.history[i]!.from);
        expect(sm1.history[i]!.to).toBe(sm2.history[i]!.to);
        expect(sm1.history[i]!.event).toBe(sm2.history[i]!.event);
        expect(sm1.history[i]!.timestamp).toEqual(sm2.history[i]!.timestamp);
      }
    });
  });
});
