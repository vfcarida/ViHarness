/**
 * Wave 5.3 — MCP & ACP Evolution Plane Endpoints (`EvolutionRpcDispatcher`).
 *
 * Exposes the Evolution Plane over JSON-RPC 2.0 (ACP and MCP compatible) so external
 * orchestrators, CI pipelines, and `ViForge` training controllers can query, synthesize,
 * transfer, and co-evolve harnesses programmatically:
 * - `evolution/synthesizeManifest`: Zero-search `Memo` synthesis from `HarnessExperienceLibrary`
 * - `evolution/inspectLineage`: Query experience entries, negative evidence, and snapshot hash
 * - `evolution/splitAndTransfer`: Decompose `TransferableCore` vs `EcosystemMargin` and recombine
 * - `evolution/prepareViForgeHandoff`: Produce a signed `ViForgeHandoffManifest`
 * - `evolution/ingestModelCheckpoint`: Ingest an updated model checkpoint $M_{t+1}$ from `ViForge`
 */
import * as path from 'node:path';
import type { HarnessId } from '../../core/types/identifiers.js';
import type { FailureSignalType } from '../../core/evolution/failure-taxonomy.js';
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';
import type {
  HarnessExperienceLibrary,
  ExperienceLibraryQuery,
} from '../../core/evolution/interfaces.js';
import {
  ContrastivePreferenceExporter,
  type DpoPreferenceRecord,
  type GrpoRolloutGroupRecord,
  type ModelCapabilityCeilingDiagnosis,
  type SpinSelfPlayRecord,
} from './contrastive-preference-exporter.js';
import { EcosystemMarginSplitter } from './ecosystem-margin.js';
import { FileHarnessExperienceLibrary } from './file-experience-library.js';
import { HarnessManifestToolkit } from './manifest-toolkit.js';
import {
  MemoHarnessSynthesizer,
  type MemoHarnessSynthesisResult,
} from './sqlite-experience-library.js';
import {
  ViForgeCoEvolutionBridge,
  type ViForgeCheckpointIngestionResult,
  type ViForgeHandoffManifest,
} from './viforge-coevolution-bridge.js';

export interface SynthesizeManifestRpcParams {
  readonly baseManifest?: HarnessManifest;
  readonly taskId?: string;
  readonly prompt?: string;
  readonly domain?: string;
  readonly language?: string;
  readonly modelFamily?: string;
  readonly predictedFailureSignals?: ReadonlyArray<FailureSignalType>;
}

export type InspectLineageRpcParams = ExperienceLibraryQuery;

export interface InspectLineageRpcResult {
  readonly snapshotHash: string;
  readonly totalMatched: number;
  readonly activeCount: number;
  readonly staleCount: number;
  readonly entries: ReadonlyArray<unknown>;
}

export interface SplitAndTransferRpcParams {
  readonly sourceManifest?: HarnessManifest;
  readonly targetModelFamily?: string;
  readonly targetDomain?: string;
  readonly targetLanguage?: string;
}

export interface PrepareViForgeHandoffRpcParams {
  readonly sourceManifest?: HarnessManifest;
  readonly dpoPairs?: ReadonlyArray<DpoPreferenceRecord>;
  readonly grpoGroups?: ReadonlyArray<GrpoRolloutGroupRecord>;
  readonly spinRecords?: ReadonlyArray<SpinSelfPlayRecord>;
  readonly ceilingDiagnosis?: ModelCapabilityCeilingDiagnosis;
  readonly outputDir?: string;
}

export interface IngestModelCheckpointRpcParams {
  readonly handoffId?: string;
  readonly previousModelFamily: string;
  readonly newModelFamily: string;
  readonly newModelCheckpointId: string;
  readonly checkpointSha256: string;
  readonly sourceManifest?: HarnessManifest;
}

export class EvolutionRpcDispatcher {
  private readonly library: HarnessExperienceLibrary;
  private readonly synthesizer: MemoHarnessSynthesizer;
  private readonly splitter: EcosystemMarginSplitter;
  private readonly exporter: ContrastivePreferenceExporter;
  private readonly viforgeBridge: ViForgeCoEvolutionBridge;
  private readonly toolkit: HarnessManifestToolkit;

  constructor(options?: {
    readonly library?: HarnessExperienceLibrary;
    readonly synthesizer?: MemoHarnessSynthesizer;
    readonly splitter?: EcosystemMarginSplitter;
    readonly exporter?: ContrastivePreferenceExporter;
    readonly viforgeBridge?: ViForgeCoEvolutionBridge;
    readonly toolkit?: HarnessManifestToolkit;
  }) {
    this.library =
      options?.library ??
      new FileHarnessExperienceLibrary({
        storageDir: path.resolve(process.cwd(), '.vi-evolution', 'libraries'),
      });
    this.synthesizer =
      options?.synthesizer ?? new MemoHarnessSynthesizer({ library: this.library });
    this.splitter = options?.splitter ?? new EcosystemMarginSplitter();
    this.exporter = options?.exporter ?? new ContrastivePreferenceExporter();
    this.viforgeBridge =
      options?.viforgeBridge ??
      new ViForgeCoEvolutionBridge({
        exporter: this.exporter,
        splitter: this.splitter,
        experienceLibrary: this.library,
      });
    this.toolkit = options?.toolkit ?? new HarnessManifestToolkit();
  }

  /**
   * Returns true if the given RPC method is handled by the Evolution Plane dispatcher.
   */
  canHandle(method: string): boolean {
    return (
      method === 'evolution/synthesizeManifest' ||
      method === 'evolution/inspectLineage' ||
      method === 'evolution/splitAndTransfer' ||
      method === 'evolution/prepareViForgeHandoff' ||
      method === 'evolution/ingestModelCheckpoint'
    );
  }

  /**
   * Dispatches an `evolution/*` RPC method call.
   */
  async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'evolution/synthesizeManifest':
        return this.handleSynthesizeManifest((params ?? {}) as SynthesizeManifestRpcParams);
      case 'evolution/inspectLineage':
        return this.handleInspectLineage((params ?? {}) as InspectLineageRpcParams);
      case 'evolution/splitAndTransfer':
        return this.handleSplitAndTransfer((params ?? {}) as SplitAndTransferRpcParams);
      case 'evolution/prepareViForgeHandoff':
        return this.handlePrepareViForgeHandoff((params ?? {}) as PrepareViForgeHandoffRpcParams);
      case 'evolution/ingestModelCheckpoint':
        return this.handleIngestModelCheckpoint(params as IngestModelCheckpointRpcParams);
      default:
        throw new Error(`Unsupported Evolution RPC method: ${method}`);
    }
  }

  async handleSynthesizeManifest(
    params: SynthesizeManifestRpcParams,
  ): Promise<MemoHarnessSynthesisResult> {
    const baseManifest = params.baseManifest ?? this.toolkit.createCanonicalBaseline();
    return this.synthesizer.synthesizeForTask({
      baseManifest,
      taskId: params.taskId ?? 'rpc-task',
      prompt: params.prompt ?? 'Synthesize zero-search harness manifest via RPC',
      domain: params.domain,
      language: params.language,
      modelFamily: params.modelFamily,
      predictedFailureSignals: params.predictedFailureSignals,
    });
  }

  async handleInspectLineage(params: InspectLineageRpcParams): Promise<InspectLineageRpcResult> {
    const entries = await this.library.query({
      ...params,
      includeNegativeEvidence: params.includeNegativeEvidence ?? true,
      includeStale: params.includeStale ?? true,
    });
    const snapshotHash = await this.library.computeSnapshotHash();
    const activeCount = entries.filter((e) => e.status === 'ACTIVE').length;
    const staleCount = entries.filter((e) => e.status === 'STALE').length;

    return {
      snapshotHash,
      totalMatched: entries.length,
      activeCount,
      staleCount,
      entries,
    };
  }

  async handleSplitAndTransfer(params: SplitAndTransferRpcParams): Promise<{
    readonly core: ReturnType<EcosystemMarginSplitter['split']>['core'];
    readonly margin: ReturnType<EcosystemMarginSplitter['split']>['margin'];
    readonly transferredManifest?: HarnessManifest;
  }> {
    const sourceManifest = params.sourceManifest ?? this.toolkit.createCanonicalBaseline();
    const { core, margin } = this.splitter.split(sourceManifest);

    if (params.targetModelFamily || params.targetDomain || params.targetLanguage) {
      const targetMargin = {
        ...margin,
        targetProfile: {
          ...margin.targetProfile,
          modelFamily: params.targetModelFamily ?? margin.targetProfile.modelFamily,
          domain: params.targetDomain ?? margin.targetProfile.domain,
          language: params.targetLanguage ?? margin.targetProfile.language,
        },
      };
      const newManifestId = `harness-transfer-${
        params.targetModelFamily ?? 'target'
      }-${Date.now().toString(36)}` as HarnessId;
      const transferredManifest = this.splitter.recombine({
        baseManifest: sourceManifest,
        core,
        margin: targetMargin,
        newManifestId,
        targetProfileOverride: {
          modelFamily: params.targetModelFamily,
          domain: params.targetDomain,
          language: params.targetLanguage,
        },
      });
      return { core, margin: targetMargin, transferredManifest };
    }

    return { core, margin };
  }

  async handlePrepareViForgeHandoff(
    params: PrepareViForgeHandoffRpcParams,
  ): Promise<ViForgeHandoffManifest> {
    const sourceManifest = params.sourceManifest ?? this.toolkit.createCanonicalBaseline();
    const defaultCeiling: ModelCapabilityCeilingDiagnosis = params.ceilingDiagnosis ?? {
      ceilingDetected: false,
      persistentFailureSignals: [],
      exhaustedQuadrants: [],
      candidatesEvaluated: 0,
      bestAchievedPassRateDelta: 0,
      recommendedPostTrainingMethod: 'DPO',
      rationale: 'Explicit RPC handoff export.',
    };

    return this.viforgeBridge.prepareViForgeHandoff({
      sourceManifest,
      dpoPairs: params.dpoPairs ?? [],
      grpoGroups: params.grpoGroups ?? [],
      spinRecords: params.spinRecords ?? [],
      ceilingDiagnosis: defaultCeiling,
      outputDir: params.outputDir,
    });
  }

  async handleIngestModelCheckpoint(
    params: IngestModelCheckpointRpcParams,
  ): Promise<ViForgeCheckpointIngestionResult> {
    if (!params?.previousModelFamily || !params?.newModelFamily || !params?.newModelCheckpointId) {
      throw new Error(
        'evolution/ingestModelCheckpoint requires previousModelFamily, newModelFamily, and newModelCheckpointId',
      );
    }
    const sourceManifest = params.sourceManifest ?? this.toolkit.createCanonicalBaseline();
    return this.viforgeBridge.ingestUpdatedModelCheckpoint({
      handoffId: params.handoffId,
      previousModelFamily: params.previousModelFamily,
      newModelFamily: params.newModelFamily,
      newModelCheckpointId: params.newModelCheckpointId,
      checkpointSha256: params.checkpointSha256 ?? 'sha256:unspecified',
      sourceManifest,
    });
  }
}
