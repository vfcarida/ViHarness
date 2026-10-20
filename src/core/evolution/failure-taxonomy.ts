/**
 * Typed Failure Signal Taxonomy for Recursive Harness Evolution.
 *
 * Replaces unconstrained LLM reflection over raw trajectories with a structured,
 * plugin-extensible failure signal taxonomy (30 canonical signals + custom plugin signals).
 */

export const CANONICAL_FAILURE_SIGNALS = [
  'context_overflow',
  'lost_relevant_context',
  'stale_context',
  'excessive_context',
  'repeated_tool_call',
  'unnecessary_tool_call',
  'wrong_tool',
  'tool_error',
  'mutation_without_verification',
  'premature_completion',
  'regression',
  'oscillation',
  'plan_execution_mismatch',
  'environment_assumption',
  'repository_navigation_failure',
  'incorrect_delegation',
  'excessive_delegation',
  'missing_skill',
  'skill_misapplication',
  'script_failure',
  'plugin_failure',
  'timeout',
  'budget_exceeded',
  'security_denial',
  'privilege_request',
  'unverifiable_output',
  'cache_instability',
  'excessive_cost',
  'excessive_latency',
  'syntax_gate_rejection',
] as const;

export type CanonicalFailureSignalType = (typeof CANONICAL_FAILURE_SIGNALS)[number];

/** Allows plugin-registered custom failure signal identifiers while preserving autocomplete. */
export type FailureSignalType = CanonicalFailureSignalType | (string & {});

export type CandidateExplorationQuadrant =
  | 'INVARIANT_GUIDANCE'
  | 'DOMAIN_GUIDANCE'
  | 'INVARIANT_STRUCTURAL'
  | 'DOMAIN_STRUCTURAL';

export interface FailureSignal {
  readonly id: string;
  readonly type: FailureSignalType;
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly confidence: number; // 0.0 - 1.0
  readonly iterationNumbers: ReadonlyArray<number>;
  readonly runIds: ReadonlyArray<string>;
  readonly evidenceExcerpts: ReadonlyArray<string>;
  readonly implicatedSurfaces: ReadonlyArray<string>;
  readonly suggestedQuadrants: ReadonlyArray<CandidateExplorationQuadrant>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface FailureSignalDefinition {
  readonly type: FailureSignalType;
  readonly defaultSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly description: string;
  readonly defaultImplicatedSurfaces: ReadonlyArray<string>;
  readonly defaultQuadrants: ReadonlyArray<CandidateExplorationQuadrant>;
}

export class FailureTaxonomyRegistry {
  private readonly definitions = new Map<string, FailureSignalDefinition>();

  constructor() {
    this.registerCanonicalSignals();
  }

  register(definition: FailureSignalDefinition): void {
    this.definitions.set(definition.type, definition);
  }

  get(type: FailureSignalType): FailureSignalDefinition | undefined {
    return this.definitions.get(type);
  }

  has(type: FailureSignalType): boolean {
    return this.definitions.has(type);
  }

  list(): ReadonlyArray<FailureSignalDefinition> {
    return Array.from(this.definitions.values());
  }

  private registerCanonicalSignals(): void {
    const defaults: ReadonlyArray<FailureSignalDefinition> = [
      {
        type: 'context_overflow',
        defaultSeverity: 'CRITICAL',
        description: 'Context window capacity exceeded or truncated critical state.',
        defaultImplicatedSurfaces: ['contextPolicy', 'memoryPolicy'],
        defaultQuadrants: ['INVARIANT_STRUCTURAL'],
      },
      {
        type: 'lost_relevant_context',
        defaultSeverity: 'HIGH',
        description: 'Previously read symbol or constraint was pruned before use.',
        defaultImplicatedSurfaces: ['contextPolicy', 'memoryPolicy'],
        defaultQuadrants: ['INVARIANT_STRUCTURAL', 'INVARIANT_GUIDANCE'],
      },
      {
        type: 'stale_context',
        defaultSeverity: 'MEDIUM',
        description: 'Agent acted on outdated file contents after later edits.',
        defaultImplicatedSurfaces: ['contextPolicy', 'toolGuidance'],
        defaultQuadrants: ['INVARIANT_STRUCTURAL'],
      },
      {
        type: 'excessive_context',
        defaultSeverity: 'MEDIUM',
        description: 'Token usage inflated by uncompacted observations.',
        defaultImplicatedSurfaces: ['contextPolicy'],
        defaultQuadrants: ['INVARIANT_STRUCTURAL'],
      },
      {
        type: 'repeated_tool_call',
        defaultSeverity: 'HIGH',
        description: 'Agent invoked identical or near-identical tool calls repeatedly.',
        defaultImplicatedSurfaces: ['toolGuidance', 'toolSchedulingPolicy'],
        defaultQuadrants: ['INVARIANT_GUIDANCE', 'INVARIANT_STRUCTURAL'],
      },
      {
        type: 'unnecessary_tool_call',
        defaultSeverity: 'LOW',
        description: 'Redundant exploration or tool call when information was already present.',
        defaultImplicatedSurfaces: ['toolGuidance', 'systemPrompt'],
        defaultQuadrants: ['INVARIANT_GUIDANCE'],
      },
      {
        type: 'wrong_tool',
        defaultSeverity: 'MEDIUM',
        description: 'Suboptimal or inappropriate tool selected for the operation.',
        defaultImplicatedSurfaces: ['toolGuidance', 'skills'],
        defaultQuadrants: ['INVARIANT_GUIDANCE', 'DOMAIN_GUIDANCE'],
      },
      {
        type: 'tool_error',
        defaultSeverity: 'HIGH',
        description: 'Tool execution failed due to invalid arguments or runtime error.',
        defaultImplicatedSurfaces: ['toolGuidance', 'scripts', 'plugins'],
        defaultQuadrants: ['INVARIANT_GUIDANCE', 'DOMAIN_STRUCTURAL'],
      },
      {
        type: 'mutation_without_verification',
        defaultSeverity: 'CRITICAL',
        description: 'Files were modified without running verification tests/checks.',
        defaultImplicatedSurfaces: ['verificationPolicy', 'guardrails'],
        defaultQuadrants: ['INVARIANT_STRUCTURAL', 'INVARIANT_GUIDANCE'],
      },
      {
        type: 'premature_completion',
        defaultSeverity: 'CRITICAL',
        description: 'Agent attempted completion before all acceptance checks passed.',
        defaultImplicatedSurfaces: ['verificationPolicy', 'guardrails', 'systemPrompt'],
        defaultQuadrants: ['INVARIANT_STRUCTURAL', 'INVARIANT_GUIDANCE'],
      },
      {
        type: 'regression',
        defaultSeverity: 'CRITICAL',
        description: 'Modification broke previously passing tests or invariants.',
        defaultImplicatedSurfaces: ['verificationPolicy', 'routingPolicy', 'skills'],
        defaultQuadrants: ['INVARIANT_STRUCTURAL', 'DOMAIN_GUIDANCE'],
      },
      {
        type: 'oscillation',
        defaultSeverity: 'HIGH',
        description: 'State machine oscillated between IMPLEMENT and REPAIR without progress.',
        defaultImplicatedSurfaces: ['routingPolicy', 'systemPrompt', 'subagents'],
        defaultQuadrants: ['INVARIANT_STRUCTURAL', 'INVARIANT_GUIDANCE'],
      },
      {
        type: 'plan_execution_mismatch',
        defaultSeverity: 'MEDIUM',
        description: 'Executed tool actions diverged from the formulated plan.',
        defaultImplicatedSurfaces: ['systemPrompt', 'routingPolicy'],
        defaultQuadrants: ['INVARIANT_GUIDANCE', 'INVARIANT_STRUCTURAL'],
      },
      {
        type: 'environment_assumption',
        defaultSeverity: 'MEDIUM',
        description: 'Agent assumed missing binaries, paths, or OS conventions.',
        defaultImplicatedSurfaces: ['skills', 'toolGuidance', 'scripts'],
        defaultQuadrants: ['DOMAIN_GUIDANCE', 'DOMAIN_STRUCTURAL'],
      },
      {
        type: 'repository_navigation_failure',
        defaultSeverity: 'MEDIUM',
        description: 'Failed to locate relevant symbols or files efficiently.',
        defaultImplicatedSurfaces: ['toolGuidance', 'contextPolicy', 'skills'],
        defaultQuadrants: ['INVARIANT_GUIDANCE', 'DOMAIN_GUIDANCE'],
      },
      {
        type: 'incorrect_delegation',
        defaultSeverity: 'MEDIUM',
        description: 'Delegated task to inappropriate subagent or with insufficient context.',
        defaultImplicatedSurfaces: ['subagents', 'systemPrompt'],
        defaultQuadrants: ['INVARIANT_STRUCTURAL', 'INVARIANT_GUIDANCE'],
      },
      {
        type: 'excessive_delegation',
        defaultSeverity: 'LOW',
        description: 'Spawned unnecessary subagents inflating token and latency overhead.',
        defaultImplicatedSurfaces: ['subagents', 'routingPolicy'],
        defaultQuadrants: ['INVARIANT_STRUCTURAL'],
      },
      {
        type: 'missing_skill',
        defaultSeverity: 'MEDIUM',
        description: 'Domain workflow lacked a reusable procedural skill.',
        defaultImplicatedSurfaces: ['skills', 'scripts'],
        defaultQuadrants: ['DOMAIN_GUIDANCE', 'DOMAIN_STRUCTURAL'],
      },
      {
        type: 'skill_misapplication',
        defaultSeverity: 'MEDIUM',
        description: 'Applied a domain skill outside its valid applicability conditions.',
        defaultImplicatedSurfaces: ['skills', 'memoryPolicy'],
        defaultQuadrants: ['DOMAIN_GUIDANCE'],
      },
      {
        type: 'script_failure',
        defaultSeverity: 'HIGH',
        description: 'Custom harness helper script exited with non-zero code or error.',
        defaultImplicatedSurfaces: ['scripts'],
        defaultQuadrants: ['DOMAIN_STRUCTURAL'],
      },
      {
        type: 'plugin_failure',
        defaultSeverity: 'HIGH',
        description: 'Harness plugin threw an error or violated service contract.',
        defaultImplicatedSurfaces: ['plugins'],
        defaultQuadrants: ['INVARIANT_STRUCTURAL', 'DOMAIN_STRUCTURAL'],
      },
      {
        type: 'timeout',
        defaultSeverity: 'HIGH',
        description: 'Tool or model call exceeded deadline policy.',
        defaultImplicatedSurfaces: ['toolSchedulingPolicy', 'routingPolicy'],
        defaultQuadrants: ['INVARIANT_STRUCTURAL'],
      },
      {
        type: 'budget_exceeded',
        defaultSeverity: 'HIGH',
        description: 'Execution exhausted token or dollar budget before completion.',
        defaultImplicatedSurfaces: ['contextPolicy', 'routingPolicy'],
        defaultQuadrants: ['INVARIANT_STRUCTURAL'],
      },
      {
        type: 'security_denial',
        defaultSeverity: 'HIGH',
        description: 'Proposed action was blocked by zero-trust PolicyEngine.',
        defaultImplicatedSurfaces: ['guardrails', 'toolGuidance', 'systemPrompt'],
        defaultQuadrants: ['INVARIANT_GUIDANCE'],
      },
      {
        type: 'privilege_request',
        defaultSeverity: 'CRITICAL',
        description: 'Agent or candidate attempted an operation requiring elevated privileges.',
        defaultImplicatedSurfaces: ['guardrails', 'plugins', 'scripts'],
        defaultQuadrants: ['INVARIANT_GUIDANCE'],
      },
      {
        type: 'unverifiable_output',
        defaultSeverity: 'HIGH',
        description: 'Changes could not be verified by deterministic checks.',
        defaultImplicatedSurfaces: ['verificationPolicy', 'skills'],
        defaultQuadrants: ['INVARIANT_STRUCTURAL', 'DOMAIN_STRUCTURAL'],
      },
      {
        type: 'cache_instability',
        defaultSeverity: 'MEDIUM',
        description: 'Low prompt-cache hit ratio due to prefix mutation.',
        defaultImplicatedSurfaces: ['contextPolicy', 'memoryPolicy'],
        defaultQuadrants: ['INVARIANT_STRUCTURAL'],
      },
      {
        type: 'excessive_cost',
        defaultSeverity: 'MEDIUM',
        description: 'Dollar expenditure per solved task exceeded target efficiency profile.',
        defaultImplicatedSurfaces: ['routingPolicy', 'contextPolicy'],
        defaultQuadrants: ['INVARIANT_STRUCTURAL'],
      },
      {
        type: 'excessive_latency',
        defaultSeverity: 'LOW',
        description: 'Wall-clock execution time exceeded target latency profile.',
        defaultImplicatedSurfaces: ['toolSchedulingPolicy', 'routingPolicy'],
        defaultQuadrants: ['INVARIANT_STRUCTURAL'],
      },
      {
        type: 'syntax_gate_rejection',
        defaultSeverity: 'MEDIUM',
        description: 'PreWriteSyntaxGate rejected malformed code write/edit.',
        defaultImplicatedSurfaces: ['toolGuidance', 'skills'],
        defaultQuadrants: ['INVARIANT_GUIDANCE', 'DOMAIN_GUIDANCE'],
      },
    ];

    for (const def of defaults) {
      this.definitions.set(def.type, def);
    }
  }
}
