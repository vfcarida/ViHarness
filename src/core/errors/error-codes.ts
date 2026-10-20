/**
 * Standardized error codes and categories for the Vi-Harness runtime.
 *
 * Every HarnessError carries a code (specific failure) and category (domain area).
 * This enables structured error handling, observability, and automated triage.
 */

// ---------------------------------------------------------------------------
// Error categories — broad domain areas
// ---------------------------------------------------------------------------

export enum ErrorCategory {
  CONFIGURATION = 'CONFIGURATION',
  MODEL = 'MODEL',
  TOOL = 'TOOL',
  POLICY = 'POLICY',
  STATE = 'STATE',
  VERIFICATION = 'VERIFICATION',
  INFRASTRUCTURE = 'INFRASTRUCTURE',
  CONTEXT = 'CONTEXT',
  RUNTIME = 'RUNTIME',
  EVOLUTION = 'EVOLUTION',
}

// ---------------------------------------------------------------------------
// Error codes — specific failure modes
// ---------------------------------------------------------------------------

export enum ErrorCode {
  // Configuration
  CONFIG_MISSING = 'CONFIG_MISSING',
  CONFIG_INVALID = 'CONFIG_INVALID',
  CONFIG_PARSE_ERROR = 'CONFIG_PARSE_ERROR',

  // Model
  MODEL_UNAVAILABLE = 'MODEL_UNAVAILABLE',
  MODEL_TIMEOUT = 'MODEL_TIMEOUT',
  MODEL_RATE_LIMITED = 'MODEL_RATE_LIMITED',
  MODEL_INVALID_RESPONSE = 'MODEL_INVALID_RESPONSE',
  MODEL_MALFORMED_OUTPUT = 'MODEL_MALFORMED_OUTPUT',

  // Tool
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
  TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED',
  TOOL_TIMEOUT = 'TOOL_TIMEOUT',
  TOOL_INVALID_INPUT = 'TOOL_INVALID_INPUT',

  // Policy
  POLICY_DENIED = 'POLICY_DENIED',
  POLICY_ESCALATION_REQUIRED = 'POLICY_ESCALATION_REQUIRED',

  // State
  STATE_INVALID_TRANSITION = 'STATE_INVALID_TRANSITION',
  STATE_NOT_FOUND = 'STATE_NOT_FOUND',
  STATE_CORRUPTED = 'STATE_CORRUPTED',

  // Verification
  VERIFICATION_FAILED = 'VERIFICATION_FAILED',

  // Infrastructure
  INFRA_CONNECTION_FAILED = 'INFRA_CONNECTION_FAILED',
  INFRA_TIMEOUT = 'INFRA_TIMEOUT',
  GIT_OPERATION_FAILED = 'GIT_OPERATION_FAILED',

  // Context
  CONTEXT_COMPILATION_FAILED = 'CONTEXT_COMPILATION_FAILED',
  CONTEXT_BUDGET_EXCEEDED = 'CONTEXT_BUDGET_EXCEEDED',

  // Runtime
  RUNTIME_EXECUTION_FAILED = 'RUNTIME_EXECUTION_FAILED',
  RUNTIME_MAX_ITERATIONS = 'RUNTIME_MAX_ITERATIONS',

  // Evolution
  EVOLUTION_CONSTITUTION_VIOLATION = 'EVOLUTION_CONSTITUTION_VIOLATION',
  EVOLUTION_MANIFEST_INVALID = 'EVOLUTION_MANIFEST_INVALID',
  EVOLUTION_SURFACE_LOCKED = 'EVOLUTION_SURFACE_LOCKED',
  EVOLUTION_REGULARIZATION_REJECTED = 'EVOLUTION_REGULARIZATION_REJECTED',
  EVOLUTION_PROBE_FAILED = 'EVOLUTION_PROBE_FAILED',
  EVOLUTION_ADMISSION_DENIED = 'EVOLUTION_ADMISSION_DENIED',
  EVOLUTION_HELD_OUT_ACCESS_DENIED = 'EVOLUTION_HELD_OUT_ACCESS_DENIED',
}

// ---------------------------------------------------------------------------
// Mapping — code → category (for validation / lookup)
// ---------------------------------------------------------------------------

export const ERROR_CODE_CATEGORY: Readonly<Record<ErrorCode, ErrorCategory>> = {
  [ErrorCode.CONFIG_MISSING]: ErrorCategory.CONFIGURATION,
  [ErrorCode.CONFIG_INVALID]: ErrorCategory.CONFIGURATION,
  [ErrorCode.CONFIG_PARSE_ERROR]: ErrorCategory.CONFIGURATION,

  [ErrorCode.MODEL_UNAVAILABLE]: ErrorCategory.MODEL,
  [ErrorCode.MODEL_TIMEOUT]: ErrorCategory.MODEL,
  [ErrorCode.MODEL_RATE_LIMITED]: ErrorCategory.MODEL,
  [ErrorCode.MODEL_INVALID_RESPONSE]: ErrorCategory.MODEL,
  [ErrorCode.MODEL_MALFORMED_OUTPUT]: ErrorCategory.MODEL,

  [ErrorCode.TOOL_NOT_FOUND]: ErrorCategory.TOOL,
  [ErrorCode.TOOL_EXECUTION_FAILED]: ErrorCategory.TOOL,
  [ErrorCode.TOOL_TIMEOUT]: ErrorCategory.TOOL,
  [ErrorCode.TOOL_INVALID_INPUT]: ErrorCategory.TOOL,

  [ErrorCode.POLICY_DENIED]: ErrorCategory.POLICY,
  [ErrorCode.POLICY_ESCALATION_REQUIRED]: ErrorCategory.POLICY,

  [ErrorCode.STATE_INVALID_TRANSITION]: ErrorCategory.STATE,
  [ErrorCode.STATE_NOT_FOUND]: ErrorCategory.STATE,
  [ErrorCode.STATE_CORRUPTED]: ErrorCategory.STATE,

  [ErrorCode.VERIFICATION_FAILED]: ErrorCategory.VERIFICATION,

  [ErrorCode.INFRA_CONNECTION_FAILED]: ErrorCategory.INFRASTRUCTURE,
  [ErrorCode.INFRA_TIMEOUT]: ErrorCategory.INFRASTRUCTURE,
  [ErrorCode.GIT_OPERATION_FAILED]: ErrorCategory.INFRASTRUCTURE,

  [ErrorCode.CONTEXT_COMPILATION_FAILED]: ErrorCategory.CONTEXT,
  [ErrorCode.CONTEXT_BUDGET_EXCEEDED]: ErrorCategory.CONTEXT,

  [ErrorCode.RUNTIME_EXECUTION_FAILED]: ErrorCategory.RUNTIME,
  [ErrorCode.RUNTIME_MAX_ITERATIONS]: ErrorCategory.RUNTIME,

  [ErrorCode.EVOLUTION_CONSTITUTION_VIOLATION]: ErrorCategory.EVOLUTION,
  [ErrorCode.EVOLUTION_MANIFEST_INVALID]: ErrorCategory.EVOLUTION,
  [ErrorCode.EVOLUTION_SURFACE_LOCKED]: ErrorCategory.EVOLUTION,
  [ErrorCode.EVOLUTION_REGULARIZATION_REJECTED]: ErrorCategory.EVOLUTION,
  [ErrorCode.EVOLUTION_PROBE_FAILED]: ErrorCategory.EVOLUTION,
  [ErrorCode.EVOLUTION_ADMISSION_DENIED]: ErrorCategory.EVOLUTION,
  [ErrorCode.EVOLUTION_HELD_OUT_ACCESS_DENIED]: ErrorCategory.EVOLUTION,
};
