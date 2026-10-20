/**
 * Wave 4.4 — Dual-Layer `MemoHarness` & SQLite-Backed Experience Library.
 *
 * 1. `SqliteHarnessExperienceLibrary`: Production SQLite-backed implementation of
 *    `HarnessExperienceLibrary` using `StorageEngine` (`better-sqlite3` WAL), supporting
 *    indexed filtering, deduplication, contradiction quarantine, expiry pruning, and
 *    lexical/TF-IDF semantic retrieval.
 * 2. `MemoHarnessSynthesizer`: Implements the `MemoHarness` dual-layer paradigm
 *    (Offline Experience Library + Zero-Search Online Manifest Synthesis) to compose
 *    task-specialized `HarnessManifest` instances from canonical `H0` in O(1) without
 *    test-time probe loops when library retrieval confidence meets threshold.
 */
import * as crypto from 'node:crypto';
import type {
  ExperienceEntryId,
  HarnessId,
} from '../../core/types/identifiers.js';
import type { Clock } from '../../core/interfaces/clock.js';
import {
  DEFAULT_HARNESS_CONSTITUTION,
  EvidenceLevel,
  type HarnessConstitution,
} from '../../core/evolution/constitution.js';
import type {
  ComponentRef,
  HarnessComponents,
  HarnessManifest,
} from '../../core/evolution/harness-manifest.js';
import type { FailureSignalType } from '../../core/evolution/failure-taxonomy.js';
import type {
  ExperienceEntry,
  ExperienceLibraryQuery,
  HarnessExperienceLibrary,
} from '../../core/evolution/interfaces.js';
import type { HarnessSurfaceRegistry } from '../../core/evolution/surface-registry.js';
import type { StorageEngine } from '../storage/sqlite-store.js';
import { DefaultHarnessSurfaceRegistry } from './default-surface-registry.js';
import { HarnessManifestToolkit } from './manifest-toolkit.js';

const DEFAULT_CLOCK: Clock = {
  now: () => new Date(),
  timestamp: () => Date.now(),
};

const EVOLUTION_LIBRARY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS evolution_experience_library (
  id TEXT PRIMARY KEY,
  manifest_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  domain TEXT,
  language TEXT,
  model_family TEXT,
  verdict TEXT NOT NULL,
  safety_impact TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  entry_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evo_exp_status ON evolution_experience_library(status, confidence);
CREATE INDEX IF NOT EXISTS idx_evo_exp_manifest_hash ON evolution_experience_library(manifest_hash);
`;

export interface SqliteHarnessExperienceLibraryOptions {
  readonly store: StorageEngine;
  readonly dbPath?: string;
  readonly clock?: Clock;
}

export interface ScoredExperienceMatch {
  readonly entry: ExperienceEntry;
  readonly similarityScore: number;
  readonly combinedRelevance: number;
}

export class SqliteHarnessExperienceLibrary implements HarnessExperienceLibrary {
  private readonly store: StorageEngine;
  private readonly dbPath?: string;
  private readonly clock: Clock;
  private initialized = false;

  constructor(options: SqliteHarnessExperienceLibraryOptions) {
    this.store = options.store;
    this.dbPath = options.dbPath;
    this.clock = options.clock ?? DEFAULT_CLOCK;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (!this.store.isOpened) {
      await this.store.open(this.dbPath);
    }
    this.store.db.exec(EVOLUTION_LIBRARY_SCHEMA_SQL);
    this.initialized = true;
  }

  async record(entry: ExperienceEntry): Promise<void> {
    await this.ensureInitialized();
    const stmt = this.store.db.prepare(`
      INSERT INTO evolution_experience_library (
        id, manifest_hash, status, domain, language, model_family,
        verdict, safety_impact, confidence, created_at, expires_at, entry_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        manifest_hash = excluded.manifest_hash,
        status = excluded.status,
        domain = excluded.domain,
        language = excluded.language,
        model_family = excluded.model_family,
        verdict = excluded.verdict,
        safety_impact = excluded.safety_impact,
        confidence = excluded.confidence,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at,
        entry_json = excluded.entry_json
    `);

    stmt.run(
      entry.id,
      entry.manifestHash,
      entry.status,
      entry.targetProfile.domain ?? null,
      entry.targetProfile.language ?? null,
      entry.targetProfile.modelFamily ?? null,
      entry.hypothesisOutcome.verdict,
      entry.safetyImpact,
      entry.confidence,
      entry.createdAt,
      entry.expiresAt ?? null,
      JSON.stringify(entry),
    );
  }

  async get(id: ExperienceEntryId): Promise<ExperienceEntry | null> {
    await this.ensureInitialized();
    const row = this.store.db
      .prepare('SELECT entry_json FROM evolution_experience_library WHERE id = ?')
      .get(id) as { entry_json: string } | undefined;

    if (!row) return null;
    return JSON.parse(row.entry_json) as ExperienceEntry;
  }

  private loadAllRaw(): ExperienceEntry[] {
    const rows = this.store.db
      .prepare('SELECT entry_json FROM evolution_experience_library')
      .all() as Array<{ entry_json: string }>;
    return rows.map((r) => JSON.parse(r.entry_json) as ExperienceEntry);
  }

  async query(
    filter: ExperienceLibraryQuery = {},
  ): Promise<ReadonlyArray<ExperienceEntry>> {
    await this.ensureInitialized();
    const nowIso = this.clock.now().toISOString();
    let results = this.loadAllRaw();

    results = results.filter((entry) => {
      if (
        entry.status === 'QUARANTINED' ||
        entry.status === 'PRUNED' ||
        entry.status === 'SUPERSEDED'
      ) {
        return false;
      }
      const isExpired =
        entry.expiresAt !== undefined && entry.expiresAt < nowIso;
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
          e.applicability.domains?.some(
            (d) => d.toLowerCase() === targetDomain,
          ) ||
          e.taskDomainProvenance.some((d) =>
            d.toLowerCase().includes(targetDomain),
          ),
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
          e.applicability.modelFamilies?.some(
            (m) => m.toLowerCase() === targetModel || m.toLowerCase() === 'model-agnostic',
          ),
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
        (e) =>
          e.hypothesisOutcome.verdict === 'supported' &&
          e.safetyImpact !== 'DEGRADED',
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

  /**
   * Retrieves top-K entries ranked by combined semantic token similarity + empirical confidence.
   */
  async retrieveBySemanticSimilarity(params: {
    readonly prompt: string;
    readonly domain?: string;
    readonly language?: string;
    readonly modelFamily?: string;
    readonly failureSignals?: ReadonlyArray<FailureSignalType>;
    readonly minConfidence?: number;
    readonly topK?: number;
  }): Promise<ReadonlyArray<ScoredExperienceMatch>> {
    const candidates = await this.query({
      domain: params.domain,
      language: params.language,
      modelFamily: params.modelFamily,
      minConfidence: params.minConfidence,
      includeNegativeEvidence: false,
    });

    const queryTokens = this.tokenize(
      `${params.prompt} ${params.domain ?? ''} ${params.language ?? ''} ${(params.failureSignals ?? []).join(' ')}`,
    );

    const scored: ScoredExperienceMatch[] = candidates.map((entry) => {
      const entryText = [
        entry.hypothesis.rationale,
        entry.hypothesis.generalizationClaim,
        entry.motivatingFailureSignals.join(' '),
        entry.taskDomainProvenance.join(' '),
        entry.diffFromBaseline.changedSurfaces.join(' '),
      ].join(' ');
      const entryTokens = this.tokenize(entryText);
      const similarityScore = this.computeJaccardOverlap(queryTokens, entryTokens);
      const combinedRelevance = Number(
        (0.55 * entry.confidence + 0.45 * similarityScore).toFixed(4),
      );
      return {
        entry,
        similarityScore: Number(similarityScore.toFixed(4)),
        combinedRelevance,
      };
    });

    scored.sort((a, b) => b.combinedRelevance - a.combinedRelevance);
    return scored.slice(0, params.topK ?? 5);
  }

  async deduplicateAndConsolidate(): Promise<{
    readonly mergedCount: number;
    readonly quarantinedCount: number;
  }> {
    await this.ensureInitialized();
    let mergedCount = 0;
    let quarantinedCount = 0;

    const all = this.loadAllRaw();
    const activeEntries = all.filter((e) => e.status === 'ACTIVE');

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
        await this.record({
          ...duplicate,
          status: 'SUPERSEDED',
          supersededById: winner.id,
        });
        mergedCount++;
      }
    }

    const refreshedActive = this.loadAllRaw().filter((e) => e.status === 'ACTIVE');
    const bySurfaceKey = new Map<string, ExperienceEntry[]>();
    for (const entry of refreshedActive) {
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
      const hasSupported = list.some(
        (e) => e.hypothesisOutcome.verdict === 'supported',
      );
      const hasContradicted = list.some(
        (e) => e.hypothesisOutcome.verdict === 'contradicted',
      );
      if (hasSupported && hasContradicted) {
        for (const item of list) {
          if (item.repetitionsCount <= 1 && item.confidence < 0.8) {
            await this.record({
              ...item,
              status: 'QUARANTINED',
            });
            quarantinedCount++;
          }
        }
      }
    }

    return { mergedCount, quarantinedCount };
  }

  async prune(nowIso?: string): Promise<{
    readonly prunedIds: ReadonlyArray<ExperienceEntryId>;
  }> {
    await this.ensureInitialized();
    const cutoffIso = nowIso ?? this.clock.now().toISOString();
    const prunedIds: ExperienceEntryId[] = [];

    for (const entry of this.loadAllRaw()) {
      if (entry.status === 'PRUNED') continue;
      const isExpired =
        entry.expiresAt !== undefined && entry.expiresAt <= cutoffIso;
      const isNegligibleAndCostly =
        entry.hypothesisOutcome.verdict === 'inconclusive' &&
        entry.costDollarsDelta > 0.05;

      if (isExpired || isNegligibleAndCostly) {
        await this.record({
          ...entry,
          status: 'PRUNED',
        });
        prunedIds.push(entry.id);
      }
    }

    return { prunedIds };
  }

  async invalidate(id: ExperienceEntryId, reason: string): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;
    await this.record({
      ...existing,
      status: 'STALE',
      negativeEvidence: [...existing.negativeEvidence, `Invalidated: ${reason}`],
    });
  }

  async quarantine(id: ExperienceEntryId, reason: string): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;
    await this.record({
      ...existing,
      status: 'QUARANTINED',
      negativeEvidence: [...existing.negativeEvidence, `Quarantined: ${reason}`],
    });
  }

  async computeSnapshotHash(): Promise<string> {
    await this.ensureInitialized();
    const activeHashes = this.loadAllRaw()
      .filter((e) => e.status === 'ACTIVE')
      .map((e) => `${e.id}:${e.manifestHash}:${e.status}`)
      .sort()
      .join('|');
    return crypto.createHash('sha256').update(activeHashes).digest('hex');
  }

  private tokenize(text: string): Set<string> {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    return new Set(words);
  }

  private computeJaccardOverlap(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const token of a) {
      if (b.has(token)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union > 0 ? intersection / union : 0;
  }
}

// ---------------------------------------------------------------------------
// 2. MemoHarnessSynthesizer (Dual-Layer Zero-Search Test-Time Adaptation)
// ---------------------------------------------------------------------------

export interface MemoHarnessSynthesisRequest {
  readonly baseManifest: HarnessManifest;
  readonly taskId: string;
  readonly prompt: string;
  readonly domain?: string;
  readonly language?: string;
  readonly modelFamily?: string;
  readonly predictedFailureSignals?: ReadonlyArray<FailureSignalType>;
}

export interface MemoHarnessSynthesisResult {
  readonly mode: 'ZERO_SEARCH_SYNTHESIS' | 'REQUIRES_ONLINE_PROBING';
  readonly synthesizedManifest: HarnessManifest;
  readonly retrievalConfidence: number;
  readonly matchedEntryIds: ReadonlyArray<ExperienceEntryId>;
  readonly appliedSurfaces: ReadonlyArray<string>;
  readonly rationale: string;
}

export interface MemoHarnessSynthesizerOptions {
  readonly library: HarnessExperienceLibrary;
  readonly surfaceRegistry?: HarnessSurfaceRegistry;
  readonly constitution?: HarnessConstitution;
  readonly minZeroSearchConfidence?: number;
}

export class MemoHarnessSynthesizer {
  private readonly library: HarnessExperienceLibrary;
  private readonly surfaceRegistry: HarnessSurfaceRegistry;
  private readonly constitution: HarnessConstitution;
  private readonly minZeroSearchConfidence: number;

  constructor(options: MemoHarnessSynthesizerOptions) {
    this.library = options.library;
    this.surfaceRegistry =
      options.surfaceRegistry ?? new DefaultHarnessSurfaceRegistry();
    this.constitution = options.constitution ?? DEFAULT_HARNESS_CONSTITUTION;
    this.minZeroSearchConfidence = options.minZeroSearchConfidence ?? 0.75;
  }

  /**
   * Synthesizes a task-specialized `HarnessManifest` directly from verified library memories
   * without running test-time probes (`ZERO_SEARCH_SYNTHESIS`) when retrieval confidence
   * meets `minZeroSearchConfidence`. Falls back to `REQUIRES_ONLINE_PROBING` otherwise.
   */
  async synthesizeForTask(
    request: MemoHarnessSynthesisRequest,
  ): Promise<MemoHarnessSynthesisResult> {
    const entries = await this.library.query({
      domain: request.domain ?? request.baseManifest.target.domain,
      language: request.language ?? request.baseManifest.target.language,
      modelFamily: request.modelFamily ?? request.baseManifest.target.modelFamily,
      failureSignals: request.predictedFailureSignals,
      includeNegativeEvidence: false,
      minConfidence: this.minZeroSearchConfidence,
      limit: 5,
    });

    // Only admit entries backed by E3_VERIFIED or E4_GENERALIZATION evidence and passing retention
    const highAssuranceEntries = entries.filter(
      (e) =>
        e.retentionPassed &&
        (e.heldOutEvidenceLevel === EvidenceLevel.E3_VERIFIED ||
          e.heldOutEvidenceLevel === EvidenceLevel.E4_GENERALIZATION),
    );

    if (highAssuranceEntries.length === 0) {
      return {
        mode: 'REQUIRES_ONLINE_PROBING',
        synthesizedManifest: request.baseManifest,
        retrievalConfidence: 0,
        matchedEntryIds: [],
        appliedSurfaces: [],
        rationale:
          'No high-assurance (E3/E4) library experience matched task profile above confidence threshold; online probing required.',
      };
    }

    const overrides: Record<string, unknown> = {};
    const appliedSurfaces: string[] = [];
    const matchedEntryIds: ExperienceEntryId[] = [];
    const arraySurfaces = new Set(['subagents', 'skills', 'scripts', 'plugins']);

    for (const entry of highAssuranceEntries) {
      let entryContributed = false;
      for (const surfaceId of entry.diffFromBaseline.changedSurfaces) {
        if (!this.surfaceRegistry.isEvolvable(surfaceId)) continue;
        const typedSurface = surfaceId as keyof HarnessComponents;

        if (arraySurfaces.has(surfaceId)) {
          const existingList =
            (overrides[surfaceId] as ReadonlyArray<ComponentRef> | undefined) ??
            request.baseManifest.components[
              typedSurface as 'subagents' | 'skills' | 'scripts' | 'plugins'
            ];
          const incomingList =
            entry.manifest.components[
              typedSurface as 'subagents' | 'skills' | 'scripts' | 'plugins'
            ];
          const mergedMap = new Map<string, ComponentRef>();
          for (const item of existingList) mergedMap.set(item.id, item);
          for (const item of incomingList) mergedMap.set(item.id, item);
          overrides[surfaceId] = Array.from(mergedMap.values());
          if (!appliedSurfaces.includes(surfaceId)) {
            appliedSurfaces.push(surfaceId);
          }
          entryContributed = true;
        } else if (!(surfaceId in overrides)) {
          overrides[surfaceId] = entry.manifest.components[typedSurface];
          appliedSurfaces.push(surfaceId);
          entryContributed = true;
        }
      }
      if (entryContributed) {
        matchedEntryIds.push(entry.id);
      }
    }

    if (appliedSurfaces.length === 0) {
      return {
        mode: 'REQUIRES_ONLINE_PROBING',
        synthesizedManifest: request.baseManifest,
        retrievalConfidence: 0,
        matchedEntryIds: [],
        appliedSurfaces: [],
        rationale: 'Matched entries contained no evolvable surface overrides.',
      };
    }

    const synthesizedId =
      `harness-memo-${request.taskId}-${Date.now().toString(36)}` as HarnessId;
    const candidateManifest = HarnessManifestToolkit.clone(request.baseManifest, {
      newId: synthesizedId,
      createdBy: 'composer',
      componentOverrides: overrides as Partial<HarnessComponents>,
    });

    const validation = HarnessManifestToolkit.validate(
      candidateManifest,
      this.surfaceRegistry,
      this.constitution,
    );
    if (!validation.valid) {
      return {
        mode: 'REQUIRES_ONLINE_PROBING',
        synthesizedManifest: request.baseManifest,
        retrievalConfidence: 0,
        matchedEntryIds: [],
        appliedSurfaces: [],
        rationale: `MemoHarness synthesis failed constitutional validation (${validation.errors[0] ?? 'invalid'}); falling back to online probing.`,
      };
    }

    const meanConfidence = Number(
      (
        highAssuranceEntries.reduce((s, e) => s + e.confidence, 0) /
        highAssuranceEntries.length
      ).toFixed(4),
    );

    return {
      mode: 'ZERO_SEARCH_SYNTHESIS',
      synthesizedManifest: candidateManifest,
      retrievalConfidence: meanConfidence,
      matchedEntryIds,
      appliedSurfaces,
      rationale: `Zero-search MemoHarness synthesis applied [${appliedSurfaces.join(', ')}] from ${matchedEntryIds.length} verified library experience(s) (confidence=${meanConfidence}).`,
    };
  }
}
