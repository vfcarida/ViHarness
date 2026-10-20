/**
 * Wave 4.5 — `One Recipe, Many Harnesses`: Transferable Core vs Ecosystem Margin.
 *
 * Implements the architectural separation from "One Recipe, Many Harnesses:
 * Extracting and Transferring Harness Engineering Practices":
 * - **Transferable Core (`TransferableCore`)**: Model-agnostic, language-agnostic
 *   verification, scheduling, guardrail, and memory invariants.
 * - **Ecosystem Margin (`EcosystemMargin`)**: Model-family, language, and domain-specific
 *   adapters (`routingPolicy`, `contextPolicy`, `toolGuidance`, `subagents`, `skills`,
 *   `scripts`, `plugins`).
 *
 * Enables recombining an evolved `TransferableCore` with any target `EcosystemMargin`
 * (or transferring an evolved `EcosystemMargin` across compatible models) while enforcing
 * constitutional and surface-registry invariants.
 */
import * as crypto from 'node:crypto';
import type { HarnessId } from '../../core/types/identifiers.js';
import {
  DEFAULT_HARNESS_CONSTITUTION,
  type HarnessConstitution,
} from '../../core/evolution/constitution.js';
import type {
  ComponentRef,
  EvolutionBudgetProfile,
  EvolutionSecurityProfile,
  HarnessManifest,
  HarnessTargetProfile,
} from '../../core/evolution/harness-manifest.js';
import type { HarnessSurfaceRegistry } from '../../core/evolution/surface-registry.js';
import { DefaultHarnessSurfaceRegistry } from './default-surface-registry.js';
import { HarnessManifestToolkit } from './manifest-toolkit.js';

export interface TransferableCore {
  readonly coreId: string;
  readonly sourceManifestId: HarnessId;
  readonly coreHash: string;
  readonly systemPrompt: ComponentRef;
  readonly guardrails: ComponentRef;
  readonly memoryPolicy: ComponentRef;
  readonly verificationPolicy?: ComponentRef;
  readonly toolSchedulingPolicy?: ComponentRef;
  readonly securityProfile: EvolutionSecurityProfile;
  readonly budgetProfile: EvolutionBudgetProfile;
}

export interface EcosystemMargin {
  readonly marginId: string;
  readonly sourceManifestId: HarnessId;
  readonly marginHash: string;
  readonly targetProfile: HarnessTargetProfile;
  readonly toolGuidance: ComponentRef;
  readonly contextPolicy?: ComponentRef;
  readonly routingPolicy?: ComponentRef;
  readonly subagents: ReadonlyArray<ComponentRef>;
  readonly skills: ReadonlyArray<ComponentRef>;
  readonly scripts: ReadonlyArray<ComponentRef>;
  readonly plugins: ReadonlyArray<ComponentRef>;
}

export class EcosystemMarginSplitter {
  private readonly surfaceRegistry: HarnessSurfaceRegistry;
  private readonly constitution: HarnessConstitution;

  constructor(options?: {
    readonly surfaceRegistry?: HarnessSurfaceRegistry;
    readonly constitution?: HarnessConstitution;
  }) {
    this.surfaceRegistry =
      options?.surfaceRegistry ?? new DefaultHarnessSurfaceRegistry();
    this.constitution = options?.constitution ?? DEFAULT_HARNESS_CONSTITUTION;
  }

  /**
   * Decomposes a `HarnessManifest` into its model-agnostic `TransferableCore`
   * and its ecosystem-specific `EcosystemMargin`.
   */
  split(manifest: HarnessManifest): {
    readonly core: TransferableCore;
    readonly margin: EcosystemMargin;
  } {
    const corePayload = {
      systemPrompt: manifest.components.systemPrompt,
      guardrails: manifest.components.guardrails,
      memoryPolicy: manifest.components.memoryPolicy,
      verificationPolicy: manifest.components.verificationPolicy,
      toolSchedulingPolicy: manifest.components.toolSchedulingPolicy,
      securityProfile: manifest.securityProfile,
      budgetProfile: manifest.budgetProfile,
    };
    const coreHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(corePayload))
      .digest('hex');

    const marginPayload = {
      targetProfile: manifest.target,
      toolGuidance: manifest.components.toolGuidance,
      contextPolicy: manifest.components.contextPolicy,
      routingPolicy: manifest.components.routingPolicy,
      subagents: manifest.components.subagents,
      skills: manifest.components.skills,
      scripts: manifest.components.scripts,
      plugins: manifest.components.plugins,
    };
    const marginHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(marginPayload))
      .digest('hex');

    return {
      core: {
        coreId: `core_${coreHash.slice(0, 12)}`,
        sourceManifestId: manifest.id,
        coreHash,
        ...corePayload,
      },
      margin: {
        marginId: `margin_${marginHash.slice(0, 12)}`,
        sourceManifestId: manifest.id,
        marginHash,
        ...marginPayload,
      },
    };
  }

  /**
   * Recombines a `TransferableCore` with a target `EcosystemMargin` into a validated,
   * content-addressed `HarnessManifest`.
   */
  recombine(params: {
    readonly baseManifest: HarnessManifest;
    readonly core: TransferableCore;
    readonly margin: EcosystemMargin;
    readonly newManifestId: HarnessId;
    readonly targetProfileOverride?: Partial<HarnessTargetProfile>;
  }): HarnessManifest {
    const mergedTarget: HarnessTargetProfile = {
      ...params.baseManifest.target,
      ...params.margin.targetProfile,
      ...params.targetProfileOverride,
    };

    const targetAdjustedBase: HarnessManifest = {
      ...params.baseManifest,
      target: mergedTarget,
    };

    const recombined = HarnessManifestToolkit.clone(targetAdjustedBase, {
      newId: params.newManifestId,
      createdBy: 'composer',
      componentOverrides: {
        systemPrompt: params.baseManifest.components.systemPrompt,
        guardrails: params.baseManifest.components.guardrails,
        memoryPolicy: params.baseManifest.components.memoryPolicy,
        verificationPolicy: params.baseManifest.components.verificationPolicy,
        toolSchedulingPolicy: params.baseManifest.components.toolSchedulingPolicy,
        toolGuidance: params.margin.toolGuidance,
        contextPolicy:
          params.margin.contextPolicy ??
          params.baseManifest.components.contextPolicy,
        routingPolicy:
          params.margin.routingPolicy ??
          params.baseManifest.components.routingPolicy,
        subagents: params.margin.subagents,
        skills: params.margin.skills,
        scripts: params.margin.scripts,
        plugins: params.margin.plugins,
      },
    });

    HarnessManifestToolkit.assertValid(
      recombined,
      this.surfaceRegistry,
      this.constitution,
    );

    return recombined;
  }
}
