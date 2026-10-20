/**
 * Evolvable Surface Registry Domain Contracts.
 *
 * Ensures that only explicitly registered surfaces with declared capability classes,
 * schemas/validators, materializers, and required admission evidence levels can be mutated.
 * Prevents arbitrary repository file edits by the self-evolution optimizer.
 */
import type { ComponentCapabilityClass, EvidenceLevel } from './constitution.js';
import type { ComponentRef } from './harness-manifest.js';

export interface SurfaceValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

export type SurfaceRollbackStrategy =
  | 'SNAPSHOT_RESTORE'
  | 'PLUGIN_DISPOSE'
  | 'CONFIG_REVERT';

export interface SurfaceComparisonResult {
  readonly changed: boolean;
  readonly magnitude: number;
  readonly summary: string;
}

export interface SurfaceCostEstimate {
  readonly estimatedTokenOverhead: number;
  readonly estimatedLatencyOverheadMs: number;
}

export interface EvolvableSurfaceDefinition<T = unknown> {
  readonly id: string;
  readonly description: string;
  readonly capabilityClass: ComponentCapabilityClass;
  readonly requiredTaskEvidenceLevel: EvidenceLevel;
  readonly requiredPromotionEvidenceLevel: EvidenceLevel;
  readonly allowedCapabilities: ReadonlyArray<string>;
  readonly costModel: SurfaceCostEstimate;
  readonly rollbackStrategy: SurfaceRollbackStrategy;
  validate(value: T): SurfaceValidationResult;
  materialize(
    value: T,
    currentRuntimeConfig: Record<string, unknown>,
  ): Record<string, unknown>;
  compare(before: T, after: T): SurfaceComparisonResult;
}

export interface HarnessSurfaceRegistry {
  register<T>(definition: EvolvableSurfaceDefinition<T>): void;
  get<T = unknown>(surfaceId: string): EvolvableSurfaceDefinition<T> | undefined;
  list(): ReadonlyArray<EvolvableSurfaceDefinition>;
  isEvolvable(surfaceId: string): boolean;
  validateComponentRef(ref: ComponentRef): SurfaceValidationResult;
}
