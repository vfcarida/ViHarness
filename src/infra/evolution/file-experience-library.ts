/**
 * Evolution-Aware Harness Experience Library & Reflector.
 *
 * Persists full executable HarnessManifests + hypothesis outcomes + positive AND negative
 * evidence + provenance + staleness/expiry + cryptographic audit signatures.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { createId } from '../../core/types/identifiers.js';
import type { ExperienceEntryId } from '../../core/types/identifiers.js';
import type { Clock } from '../../core/interfaces/clock.js';
import type {
  ExperienceEntry,
  ExperienceLibraryQuery,
  HarnessExperienceLibrary,
  HarnessReflector,
  ProposedCandidate,
  AdmissionDecision,
} from '../../core/evolution/interfaces.js';
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';
import type {
  EvidenceBundle,
  BehavioralContrast,
} from '../../core/evolution/hypothesis.js';

export interface FileHarnessExperienceLibraryOptions {
  readonly storageDir: string;
  readonly hmacSecret?: string;
  readonly defaultTtlDays?: number;
  readonly clock?: Clock;
}

const DEFAULT_CLOCK: Clock = {
  now: () => new Date(),
  timestamp: () => Date.now(),
};

export class DefaultHarnessReflector implements HarnessReflector {
  private readonly clock: Clock;
  private readonly hmacSecret: string;
  private readonly defaultTtlDays: number;

  constructor(options?: {
    readonly clock?: Clock;
    readonly hmacSecret?: string;
    readonly defaultTtlDays?: number;
  }) {
    this.clock = options?.clock ?? DEFAULT_CLOCK;
    this.hmacSecret = options?.hmacSecret ?? 'vi-harness-default-evolution-secret';
    this.defaultTtlDays = options?.defaultTtlDays ?? 30;
  }

  reflect(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidate: ProposedCandidate;
    readonly evidenceBundle: EvidenceBundle;
    readonly contrast: BehavioralContrast;
    readonly admissionDecision: AdmissionDecision;
    readonly taskDomain: string;
  }): ExperienceEntry {
    const now = this.clock.now();
    const createdAt = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + this.defaultTtlDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const positiveEvidence: string[] = [];
    const negativeEvidence: string[] = [];

    if (params.contrast.passRateDelta > 0 || params.contrast.partialScoreDelta > 0) {
      positiveEvidence.push(
        `Pass rate delta ${(params.contrast.passRateDelta * 100).toFixed(1)}% (partialScoreDelta=${params.contrast.partialScoreDelta.toFixed(3)}) over baseline ${params.baseManifest.id}.`,
      );
    } else if (params.contrast.passRateDelta < 0 || params.contrast.partialScoreDelta < 0) {
      negativeEvidence.push(
        `Pass rate regressed by ${(Math.abs(params.contrast.passRateDelta) * 100).toFixed(1)}% vs baseline ${params.baseManifest.id}.`,
      );
    }

    for (const sig of params.contrast.resolvedFailureSignals) {
      positiveEvidence.push(`Resolved failure signal '${sig}'.`);
    }
    for (const sig of params.contrast.newlyIntroducedFailureSignals) {
      negativeEvidence.push(`Introduced failure signal '${sig}'.`);
    }

    const observedEffectSizes: Record<string, number> = {};
    for (const eff of params.contrast.hypothesisOutcome.observedEffects) {
      observedEffectSizes[eff.metric] = eff.delta;
    }

    const safetyImpact: 'NONE' | 'IMPROVED' | 'DEGRADED' =
      params.contrast.policyViolationDelta > 0
        ? 'DEGRADED'
        : params.contrast.policyViolationDelta < 0
          ? 'IMPROVED'
          : 'NONE';

    const entryId = createId<'ExperienceEntry'>(
      `exp_${params.candidate.manifest.contentHash.slice(0, 10)}_${now.getTime()}`,
    );

    const unsignedEntry: ExperienceEntry = {
      id: entryId,
      manifest: params.candidate.manifest,
      manifestHash: params.candidate.manifest.contentHash,
      diffFromBaseline: params.candidate.diffFromBase,
      applicability: params.candidate.hypothesis.applicability,
      motivatingFailureSignals: params.candidate.hypothesis.observedFailureSignals,
      hypothesis: params.candidate.hypothesis,
      predictedEffects: params.candidate.hypothesis.predictedEffects,
      hypothesisOutcome: params.contrast.hypothesisOutcome,
      positiveEvidence,
      negativeEvidence,
      contradictedPredictions: params.contrast.hypothesisOutcome.unexpectedEffects,
      observedEffectSizes,
      probeBundleIds: [String(params.evidenceBundle.id)],
      repetitionsCount: params.evidenceBundle.repetitions,
      targetProfile: params.candidate.manifest.target,
      taskDomainProvenance: [params.taskDomain, ...params.evidenceBundle.taskIds],
      tokenDelta: params.contrast.meanTokensDelta,
      costDollarsDelta: params.contrast.meanCostDollarsDelta,
      latencyMsDelta: params.contrast.meanLatencyMsDelta,
      safetyImpact,
      heldOutEvidenceLevel: params.admissionDecision.evidenceLevelVerified,
      retentionPassed: params.admissionDecision.retentionResult?.passed ?? true,
      admissionStatus: params.admissionDecision.status,
      confidence: params.contrast.hypothesisOutcome.confidence,
      createdAt,
      lastValidatedAt: createdAt,
      expiresAt,
      status: params.admissionDecision.status === 'quarantined' ? 'QUARANTINED' : 'ACTIVE',
    };

    const auditSignature = crypto
      .createHmac('sha256', this.hmacSecret)
      .update(JSON.stringify(unsignedEntry))
      .digest('hex');

    return {
      ...unsignedEntry,
      auditSignature,
    };
  }
}

export class FileHarnessExperienceLibrary implements HarnessExperienceLibrary {
  private readonly storageDir: string;
  private readonly entriesFilePath: string;
  private readonly clock: Clock;
  private readonly entries = new Map<ExperienceEntryId, ExperienceEntry>();
  private loaded = false;

  constructor(options: FileHarnessExperienceLibraryOptions) {
    this.storageDir = options.storageDir;
    this.entriesFilePath = path.join(this.storageDir, 'experience-library.json');
    this.clock = options.clock ?? DEFAULT_CLOCK;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const content = await fs.readFile(this.entriesFilePath, 'utf-8');
      const parsed = JSON.parse(content) as ExperienceEntry[];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          this.entries.set(item.id, item);
        }
      }
    } catch {
      // File does not exist yet
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true });
    const all = Array.from(this.entries.values());
    await fs.writeFile(this.entriesFilePath, JSON.stringify(all, null, 2), 'utf-8');
  }

  async record(entry: ExperienceEntry): Promise<void> {
    await this.ensureLoaded();
    this.entries.set(entry.id, entry);
    await this.persist();
  }

  async get(id: ExperienceEntryId): Promise<ExperienceEntry | null> {
    await this.ensureLoaded();
    return this.entries.get(id) ?? null;
  }

  async query(filter: ExperienceLibraryQuery = {}): Promise<ReadonlyArray<ExperienceEntry>> {
    await this.ensureLoaded();
    const nowIso = this.clock.now().toISOString();
    let results = Array.from(this.entries.values());

    results = results.filter((entry) => {
      if (entry.status === 'QUARANTINED' || entry.status === 'PRUNED' || entry.status === 'SUPERSEDED') {
        return false;
      }
      const isExpired = entry.expiresAt !== undefined && entry.expiresAt < nowIso;
      if ((entry.status === 'STALE' || isExpired) && !filter.includeStale) {
        return false;
      }
      return true;
    });

    if (filter.domain) {
      const targetDomain = filter.domain.toLowerCase();
      results = results.filter(
        (e) =>
          e.targetProfile.domain?.toLowerCase() === targetDomain ||
          e.applicability.domains?.some((d) => d.toLowerCase() === targetDomain) ||
          e.taskDomainProvenance.some((d) => d.toLowerCase().includes(targetDomain)),
      );
    }

    if (filter.language) {
      const targetLang = filter.language.toLowerCase();
      results = results.filter(
        (e) =>
          e.targetProfile.language?.toLowerCase() === targetLang ||
          e.applicability.languages?.some((l) => l.toLowerCase() === targetLang),
      );
    }

    if (filter.modelFamily) {
      const targetModel = filter.modelFamily.toLowerCase();
      results = results.filter(
        (e) =>
          e.targetProfile.modelFamily?.toLowerCase() === targetModel ||
          e.applicability.modelFamilies?.some((m) => m.toLowerCase() === targetModel),
      );
    }

    if (filter.failureSignals && filter.failureSignals.length > 0) {
      const signalSet = new Set(filter.failureSignals);
      results = results.filter((e) =>
        e.motivatingFailureSignals.some((s) => signalSet.has(s)),
      );
    }

    if (!filter.includeNegativeEvidence) {
      results = results.filter(
        (e) => e.hypothesisOutcome.verdict === 'supported' && e.safetyImpact !== 'DEGRADED',
      );
    }

    if (filter.minConfidence !== undefined) {
      results = results.filter((e) => e.confidence >= filter.minConfidence!);
    }

    results.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.createdAt.localeCompare(a.createdAt);
    });

    if (filter.limit !== undefined && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  async deduplicateAndConsolidate(): Promise<{
    readonly mergedCount: number;
    readonly quarantinedCount: number;
  }> {
    await this.ensureLoaded();
    let mergedCount = 0;
    let quarantinedCount = 0;

    const activeEntries = Array.from(this.entries.values()).filter(
      (e) => e.status === 'ACTIVE',
    );

    const byManifestHash = new Map<string, ExperienceEntry[]>();
    for (const entry of activeEntries) {
      const group = byManifestHash.get(entry.manifestHash) ?? [];
      group.push(entry);
      byManifestHash.set(entry.manifestHash, group);
    }

    for (const group of byManifestHash.values()) {
      if (group.length <= 1) continue;
      group.sort((a, b) => b.confidence - a.confidence);
      const winner = group[0]!;
      for (let i = 1; i < group.length; i++) {
        const duplicate = group[i]!;
        this.entries.set(duplicate.id, {
          ...duplicate,
          status: 'SUPERSEDED',
          supersededById: winner.id,
        });
        mergedCount++;
      }
    }

    const bySurfaceKey = new Map<string, ExperienceEntry[]>();
    for (const entry of Array.from(this.entries.values()).filter((e) => e.status === 'ACTIVE')) {
      const surfaceKey = `${entry.diffFromBaseline.componentDiffs
        .filter((d) => d.changeType !== 'UNCHANGED')
        .map((d) => `${d.surfaceId}:${d.afterHash}`)
        .join('|')}::${entry.motivatingFailureSignals.slice().sort().join(',')}`;
      const list = bySurfaceKey.get(surfaceKey) ?? [];
      list.push(entry);
      bySurfaceKey.set(surfaceKey, list);
    }

    for (const list of bySurfaceKey.values()) {
      if (list.length <= 1) continue;
      const hasSupported = list.some((e) => e.hypothesisOutcome.verdict === 'supported');
      const hasContradicted = list.some((e) => e.hypothesisOutcome.verdict === 'contradicted');
      if (hasSupported && hasContradicted) {
        for (const item of list) {
          if (item.repetitionsCount <= 1 && item.confidence < 0.8) {
            this.entries.set(item.id, {
              ...item,
              status: 'QUARANTINED',
            });
            quarantinedCount++;
          }
        }
      }
    }

    if (mergedCount > 0 || quarantinedCount > 0) {
      await this.persist();
    }

    return { mergedCount, quarantinedCount };
  }

  async prune(nowIso?: string): Promise<{
    readonly prunedIds: ReadonlyArray<ExperienceEntryId>;
  }> {
    await this.ensureLoaded();
    const cutoffIso = nowIso ?? this.clock.now().toISOString();
    const prunedIds: ExperienceEntryId[] = [];

    for (const [id, entry] of this.entries.entries()) {
      if (entry.status === 'PRUNED') continue;

      const isExpired = entry.expiresAt !== undefined && entry.expiresAt <= cutoffIso;
      const isNegligibleAndCostly =
        entry.hypothesisOutcome.verdict === 'inconclusive' && entry.costDollarsDelta > 0.05;

      if (isExpired || isNegligibleAndCostly) {
        this.entries.set(id, {
          ...entry,
          status: 'PRUNED',
        });
        prunedIds.push(id);
      }
    }

    if (prunedIds.length > 0) {
      await this.persist();
    }

    return { prunedIds };
  }

  async invalidate(id: ExperienceEntryId, reason: string): Promise<void> {
    await this.ensureLoaded();
    const existing = this.entries.get(id);
    if (!existing) return;
    this.entries.set(id, {
      ...existing,
      status: 'STALE',
      negativeEvidence: [...existing.negativeEvidence, `Invalidated: ${reason}`],
    });
    await this.persist();
  }

  async quarantine(id: ExperienceEntryId, reason: string): Promise<void> {
    await this.ensureLoaded();
    const existing = this.entries.get(id);
    if (!existing) return;
    this.entries.set(id, {
      ...existing,
      status: 'QUARANTINED',
      negativeEvidence: [...existing.negativeEvidence, `Quarantined: ${reason}`],
    });
    await this.persist();
  }

  async computeSnapshotHash(): Promise<string> {
    await this.ensureLoaded();
    const activeHashes = Array.from(this.entries.values())
      .filter((e) => e.status === 'ACTIVE')
      .map((e) => `${e.id}:${e.manifestHash}:${e.status}`)
      .sort()
      .join('|');
    return crypto.createHash('sha256').update(activeHashes).digest('hex');
  }
}
