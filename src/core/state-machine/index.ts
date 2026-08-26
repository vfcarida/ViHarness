/**
 * State machine module barrel export.
 */

// Transition table
export { TRANSITION_TABLE, TRANSITION_INDEX, lookupTransition } from './transition-table.js';
export type { TransitionRule } from './transition-table.js';

// Transition validator
export { validateTransition, validateTransitionOrThrow } from './transition-validator.js';
export type { TransitionValidationResult } from './transition-validator.js';

// State machine
export { StateMachine } from './state-machine.js';
export type { StateMachineSnapshot } from './state-machine.js';

// Loop fingerprint abstraction
export {
  buildLoopFingerprint,
  buildLoopFingerprintFromRaw,
  loopFingerprintsMatch,
  computeFingerprintHash,
  detectTrajectoryCycle,
} from './loop-fingerprint.js';
export type { LoopFingerprint } from './loop-fingerprint.js';

// Loop control
export {
  evaluateLoopControl,
  checkGoalRoundBudget,
  checkGoalTokenBudget,
  checkGoalCostBudget,
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
} from './loop-control.js';
export type { LoopControlConfig } from './loop-control.js';
