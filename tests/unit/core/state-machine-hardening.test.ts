/**
 * State Machine Hardening Tests.
 *
 * Verifies:
 * 1. DONE evidence gate: VERIFICATION_PASSED → DONE requires evidenceIds
 * 2. All new transitions (IMPLEMENT→BLOCKED, VERIFY→BLOCKED, IMPLEMENT→REGRESSION_DETECTED)
 * 3. Terminal states reject all events
 * 4. LLM cannot emit runtime-only events
 * 5. BLOCK is runtime-only (LLM cannot emit it)
 * 6. Transition whitelist: arbitrary transitions are rejected
 * 7. VERIFY→HUMAN_REQUIRED via NO_PROGRESS
 */
import { describe, it, expect } from 'vitest';
import {
  AgentPhase,
  StateEvent,
  TERMINAL_PHASES,
  RUNTIME_ONLY_EVENTS,
  validateTransition,
  lookupTransition,
  StateMachine,
} from '../../../src/core/index.js';
import { HarnessError } from '../../../src/core/errors/base-error.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';
import { SystemClock } from '../../../src/infra/time/system-clock.js';

describe('State Machine Hardening', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new SystemClock();

  function makeMachine(initialPhase?: AgentPhase): StateMachine {
    return new StateMachine({
      taskId: idFactory.create<'Task'>(),
      idFactory,
      clock,
      initialPhase,
    });
  }

  // =========================================================================
  // DONE Evidence Gate
  // =========================================================================

  describe('DONE Evidence Gate', () => {
    it('should reject VERIFICATION_PASSED → DONE without evidenceIds', () => {
      const machine = makeMachine(AgentPhase.VERIFY);

      expect(() => machine.apply(StateEvent.VERIFICATION_PASSED, { evidenceIds: [] })).toThrow(
        HarnessError,
      );
    });

    it('should reject VERIFICATION_PASSED → DONE with undefined evidenceIds', () => {
      const machine = makeMachine(AgentPhase.VERIFY);

      expect(() => machine.apply(StateEvent.VERIFICATION_PASSED)).toThrow(HarnessError);
    });

    it('should allow VERIFICATION_PASSED → DONE with at least one evidenceId', () => {
      const machine = makeMachine(AgentPhase.VERIFY);
      const evidenceId = idFactory.create<'Evidence'>();

      const transition = machine.apply(StateEvent.VERIFICATION_PASSED, {
        evidenceIds: [evidenceId],
      });

      expect(machine.phase).toBe(AgentPhase.DONE);
      expect(transition.to).toBe(AgentPhase.DONE);
      expect(transition.evidenceIds).toContain(evidenceId);
    });

    it('should allow MARK_DONE → DONE without evidenceIds (human override path)', () => {
      // MARK_DONE from HUMAN_REQUIRED does not require evidenceIds
      // — it is a human-authorized override
      const machine = makeMachine(AgentPhase.HUMAN_REQUIRED);

      const transition = machine.apply(StateEvent.MARK_DONE);
      expect(machine.phase).toBe(AgentPhase.DONE);
      expect(transition.to).toBe(AgentPhase.DONE);
    });
  });

  // =========================================================================
  // New Transition Coverage
  // =========================================================================

  describe('New Transition Coverage', () => {
    it('IMPLEMENT → BLOCKED via BLOCK event', () => {
      const machine = makeMachine(AgentPhase.IMPLEMENT);
      machine.apply(StateEvent.BLOCK);
      expect(machine.phase).toBe(AgentPhase.BLOCKED);
    });

    it('VERIFY → BLOCKED via BLOCK event', () => {
      const machine = makeMachine(AgentPhase.VERIFY);
      machine.apply(StateEvent.BLOCK);
      expect(machine.phase).toBe(AgentPhase.BLOCKED);
    });

    it('IMPLEMENT → REGRESSION_DETECTED via REGRESSION_FOUND', () => {
      const machine = makeMachine(AgentPhase.IMPLEMENT);
      machine.apply(StateEvent.REGRESSION_FOUND);
      expect(machine.phase).toBe(AgentPhase.REGRESSION_DETECTED);
    });

    it('VERIFY → HUMAN_REQUIRED via NO_PROGRESS', () => {
      const machine = makeMachine(AgentPhase.VERIFY);
      machine.apply(StateEvent.NO_PROGRESS);
      expect(machine.phase).toBe(AgentPhase.HUMAN_REQUIRED);
    });

    it('BLOCKED → IMPLEMENT via UNBLOCK', () => {
      const machine = makeMachine(AgentPhase.BLOCKED);
      machine.apply(StateEvent.UNBLOCK);
      expect(machine.phase).toBe(AgentPhase.IMPLEMENT);
    });
  });

  // =========================================================================
  // Terminal State Enforcement
  // =========================================================================

  describe('Terminal State Enforcement', () => {
    const terminalPhases = Array.from(TERMINAL_PHASES);
    const someEvents = [
      StateEvent.START,
      StateEvent.PLAN_READY,
      StateEvent.IMPLEMENTATION_COMPLETE,
      StateEvent.VERIFICATION_PASSED,
      StateEvent.REPAIR_COMPLETE,
      StateEvent.MARK_DONE,
      StateEvent.MARK_FAILED,
      StateEvent.ESCALATE,
    ];

    for (const phase of terminalPhases) {
      for (const event of someEvents) {
        it(`should reject any event from terminal phase ${phase} (event: ${event})`, () => {
          const result = validateTransition(phase, event, false);
          expect(result.valid).toBe(false);
          expect(result.reason).toContain('terminal');
        });
      }
    }
  });

  // =========================================================================
  // LLM Cannot Emit Runtime-Only Events
  // =========================================================================

  describe('LLM Cannot Emit Runtime-Only Events', () => {
    const runtimeEvents = Array.from(RUNTIME_ONLY_EVENTS);

    for (const event of runtimeEvents) {
      it(`should reject LLM emission of runtime-only event: ${event}`, () => {
        const result = validateTransition(AgentPhase.IMPLEMENT, event, true);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('runtime');
      });
    }

    it('BLOCK is in RUNTIME_ONLY_EVENTS', () => {
      expect(RUNTIME_ONLY_EVENTS.has(StateEvent.BLOCK)).toBe(true);
    });

    it('LLM cannot emit BLOCK even from a phase that supports it', () => {
      const result = validateTransition(AgentPhase.IMPLEMENT, StateEvent.BLOCK, true);
      expect(result.valid).toBe(false);
    });

    it('Runtime CAN emit BLOCK from IMPLEMENT', () => {
      const result = validateTransition(AgentPhase.IMPLEMENT, StateEvent.BLOCK, false);
      expect(result.valid).toBe(true);
      expect(result.to).toBe(AgentPhase.BLOCKED);
    });
  });

  // =========================================================================
  // Transition Whitelist Enforcement
  // =========================================================================

  describe('Transition Whitelist Enforcement', () => {
    it('should reject INIT → DONE (not in whitelist)', () => {
      const result = validateTransition(AgentPhase.INIT, StateEvent.MARK_DONE, false);
      expect(result.valid).toBe(false);
    });

    it('should reject EXPLORE → DONE (not in whitelist)', () => {
      const result = validateTransition(AgentPhase.EXPLORE, StateEvent.VERIFICATION_PASSED, false);
      expect(result.valid).toBe(false);
    });

    it('should reject PLAN → DONE (not in whitelist)', () => {
      const result = validateTransition(AgentPhase.PLAN, StateEvent.MARK_DONE, false);
      expect(result.valid).toBe(false);
    });

    it('should reject IMPLEMENT → DONE directly (must go through VERIFY)', () => {
      const result = validateTransition(
        AgentPhase.IMPLEMENT,
        StateEvent.VERIFICATION_PASSED,
        false,
      );
      expect(result.valid).toBe(false);
    });

    it('lookupTransition returns undefined for unregistered (from, event) pairs', () => {
      expect(lookupTransition(AgentPhase.INIT, StateEvent.REPAIR_COMPLETE)).toBeUndefined();
      expect(lookupTransition(AgentPhase.DONE, StateEvent.START)).toBeUndefined();
      expect(lookupTransition(AgentPhase.FAILED, StateEvent.RETRY)).toBeUndefined();
    });

    it('StateMachine throws HarnessError on invalid transition', () => {
      const machine = makeMachine(AgentPhase.INIT);
      // Can't go directly from INIT to REPAIR
      expect(() => machine.apply(StateEvent.REPAIR_COMPLETE)).toThrow(HarnessError);
    });
  });

  // =========================================================================
  // Valid Happy-Path Transitions
  // =========================================================================

  describe('Valid Happy-Path Transitions', () => {
    it('should execute full happy path: INIT→EXPLORE→PLAN→IMPLEMENT→VERIFY→DONE', () => {
      const machine = makeMachine(AgentPhase.INIT);
      const evidenceId = idFactory.create<'Evidence'>();

      machine.apply(StateEvent.START);
      expect(machine.phase).toBe(AgentPhase.EXPLORE);

      machine.apply(StateEvent.EXPLORE_COMPLETE);
      expect(machine.phase).toBe(AgentPhase.PLAN);

      machine.apply(StateEvent.PLAN_READY);
      expect(machine.phase).toBe(AgentPhase.IMPLEMENT);

      machine.apply(StateEvent.IMPLEMENTATION_COMPLETE);
      expect(machine.phase).toBe(AgentPhase.VERIFY);

      machine.apply(StateEvent.VERIFICATION_PASSED, { evidenceIds: [evidenceId] });
      expect(machine.phase).toBe(AgentPhase.DONE);

      expect(machine.isTerminal).toBe(true);
      expect(machine.history).toHaveLength(5);
    });

    it('should record all transitions in history', () => {
      const machine = makeMachine(AgentPhase.IMPLEMENT);
      machine.apply(StateEvent.IMPLEMENTATION_COMPLETE);
      machine.apply(StateEvent.VERIFICATION_FAILED);
      machine.apply(StateEvent.REPAIR_COMPLETE);

      expect(machine.history).toHaveLength(3);
      expect(machine.history[0]!.from).toBe(AgentPhase.IMPLEMENT);
      expect(machine.history[0]!.to).toBe(AgentPhase.VERIFY);
      expect(machine.history[1]!.from).toBe(AgentPhase.VERIFY);
      expect(machine.history[1]!.to).toBe(AgentPhase.REPAIR);
      expect(machine.history[2]!.from).toBe(AgentPhase.REPAIR);
      expect(machine.history[2]!.to).toBe(AgentPhase.VERIFY);
    });
  });
});
