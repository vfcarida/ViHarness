/**
 * Canonical Versioned HarnessManifest Domain Model (ADR-015).
 *
 * Represents an execution harness as a first-class, immutable, content-addressed,
 * diffable, and revertible artifact covering:
 * - 8 conceptual Harness² components (systemPrompt, guardrails, memoryPolicy,
 *   toolGuidance, subagents, skills, scripts, plugins)
 * - 4 native Vi-Harness structural policy surfaces (contextPolicy, routingPolicy,
 *   verificationPolicy, toolSchedulingPolicy)
 */
import type {
  HarnessId,
  EvolutionRunId,
  HypothesisId,
} from '../types/identifiers.js';
import type { ComponentCapabilityClass, EvidenceLevel } from './constitution.js';

export interface ComponentRef {
  readonly id: string;
  readonly surfaceId: string;
  readonly capabilityClass: ComponentCapabilityClass;
  readonly version: string;
  readonly contentHash: string;
  readonly content: string | Readonly<Record<string, unknown>>;
  readonly permissions?: ReadonlyArray<string>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface HarnessComponents {
  // Eight Harness² conceptual components
  readonly systemPrompt: ComponentRef;
  readonly guardrails: ComponentRef;
  readonly memoryPolicy: ComponentRef;
  readonly toolGuidance: ComponentRef;
  readonly subagents: ReadonlyArray<ComponentRef>;
  readonly skills: ReadonlyArray<ComponentRef>;
  readonly scripts: ReadonlyArray<ComponentRef>;
  readonly plugins: ReadonlyArray<ComponentRef>;

  // Four Vi-Harness native structural extension surfaces
  readonly contextPolicy?: ComponentRef;
  readonly routingPolicy?: ComponentRef;
  readonly verificationPolicy?: ComponentRef;
  readonly toolSchedulingPolicy?: ComponentRef;
}

export interface HarnessTargetProfile {
  readonly modelFamily?: string;
  readonly domain?: string;
  readonly language?: string;
  readonly environmentFingerprint: string;
}

export type ManifestCreatorRole =
  | 'baseline'
  | 'proposer'
  | 'composer'
  | 'human'
  | 'imported';

export interface ProvenanceRecord {
  readonly createdBy: ManifestCreatorRole;
  readonly parentManifestId?: HarnessId;
  readonly parentContentHash?: string;
  readonly lineageIds: ReadonlyArray<HarnessId>;
  readonly evolutionRunId?: EvolutionRunId;
  readonly hypothesisId?: HypothesisId;
  readonly signature?: string;
  readonly signedAt?: string;
  readonly keyId?: string;
}

export interface EvidenceSummary {
  readonly highestLevelAchieved: EvidenceLevel;
  readonly bundleIds: ReadonlyArray<string>;
  readonly passRate?: number;
  readonly meanTokens?: number;
  readonly meanCostDollars?: number;
  readonly meanLatencyMs?: number;
  readonly regressionsDetected: number;
  readonly securityViolations: number;
  readonly retentionStatus?: 'PASS' | 'FAIL' | 'UNTESTED';
}

export interface EvolutionBudgetProfile {
  readonly maxIterationsPerProbe: number;
  readonly maxTokensPerProbe: number;
  readonly maxCostDollarsPerProbe: number;
  readonly maxWallTimeMsPerProbe: number;
  readonly maxProbesPerEvolutionRun: number;
  readonly maxTotalEvolutionCostDollars: number;
}

export type ProbeNetworkEgressPolicy =
  | 'DENY_ALL'
  | 'ALLOWLIST_ONLY'
  | 'RESTRICTED_BENCHMARK';

export interface EvolutionSecurityProfile {
  readonly sandboxMode: 'local' | 'docker' | 'worktree';
  readonly networkEgressPolicy: ProbeNetworkEgressPolicy;
  readonly allowFilesystemEscape: false;
  readonly allowPrivilegeEscalation: false;
  readonly grantedPermissions: ReadonlyArray<string>;
}

export interface HarnessManifest {
  readonly id: HarnessId;
  readonly parentId?: HarnessId;
  readonly schemaVersion: string;
  readonly createdAt: string;
  readonly frozen: boolean;
  readonly contentHash: string;
  readonly components: HarnessComponents;
  readonly target: HarnessTargetProfile;
  readonly provenance: ProvenanceRecord;
  readonly evidence: EvidenceSummary;
  readonly budgetProfile: EvolutionBudgetProfile;
  readonly securityProfile: EvolutionSecurityProfile;
}

export type ComponentChangeType = 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';

export interface ComponentDiffEntry {
  readonly surfaceId: string;
  readonly componentId: string;
  readonly changeType: ComponentChangeType;
  readonly capabilityClass: ComponentCapabilityClass;
  readonly beforeHash?: string;
  readonly afterHash?: string;
  readonly beforeContent?: unknown;
  readonly afterContent?: unknown;
  readonly magnitude: number;
  readonly summary: string;
}

export interface HarnessManifestDiff {
  readonly baseManifestId: HarnessId;
  readonly candidateManifestId: HarnessId;
  readonly baseHash: string;
  readonly candidateHash: string;
  readonly identical: boolean;
  readonly changedSurfaces: ReadonlyArray<string>;
  readonly highestRiskClassTouched: ComponentCapabilityClass;
  readonly componentDiffs: ReadonlyArray<ComponentDiffEntry>;
  readonly totalUnitsChanged: number;
}
