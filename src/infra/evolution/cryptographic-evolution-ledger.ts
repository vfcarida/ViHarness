/**
 * Wave 7.2 — Cryptographic Hash-Chained Evolution Ledger & SLSA/In-Toto Provenance Attestor
 * (`CryptographicEvolutionLedger`).
 *
 * Provides a tamper-evident, append-only Merkle / SHA-256 hash chain over all
 * Evolution Plane lifecycle transitions (`H0 -> Hypothesis -> AST Sandbox -> Worktree Probe ->
 * Holm-Bonferroni -> Shapley Pruning -> Admission -> Promotion -> Canary Rollback`).
 *
 * Security Guarantees (`THREAT E-18` & `E-20`):
 * 1. **Append-Only Hash Chaining**: Every `LedgerEntry` commits to `previousEntryHash`
 *    (`'0'.repeat(64)` at genesis) and is signed via HMAC-SHA256.
 * 2. **SLSA v1.0 / In-Toto Provenance Predicates**: Captures input material digests
 *    (`materials`), builder identity, and verification summaries.
 * 3. **Fail-Closed Chain & Manifest Verification**: `verifyLedgerIntegrity()` detects any
 *    modification, deletion, or reordering of entries; `verifyManifestProvenance()` ensures
 *    a `HarnessManifest` has an authentic, unbroken admission/promotion lineage.
 */
import * as crypto from 'node:crypto';
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';

export type EvolutionLedgerEventType =
  | 'GENESIS_BASELINE'
  | 'HYPOTHESIS_DECLARED'
  | 'AST_SANDBOX_VERIFIED'
  | 'WORKTREE_PROBE_EXECUTED'
  | 'HOLM_BONFERRONI_TESTED'
  | 'SHAPLEY_ABLATION_PRUNED'
  | 'ADMISSION_DECIDED'
  | 'BASELINE_PROMOTED'
  | 'CANARY_ROLLBACK';

export interface SlsaMaterialDigest {
  readonly uri: string;
  readonly sha256: string;
}

export interface SlsaEvolutionPredicate {
  readonly predicateType: 'https://vi-harness.dev/provenance/evolution/v1';
  readonly builderId: string;
  readonly invocationId: string;
  readonly materials: ReadonlyArray<SlsaMaterialDigest>;
  readonly verificationSummary: Readonly<Record<string, unknown>>;
}

export interface EvolutionLedgerEntry {
  readonly index: number;
  readonly entryId: string;
  readonly eventType: EvolutionLedgerEventType;
  readonly timestamp: string;
  readonly subjectManifestId: string;
  readonly subjectManifestHash: string;
  readonly previousEntryHash: string;
  readonly slsaPredicate: SlsaEvolutionPredicate;
  readonly entryHash: string;
  readonly hmacSignature: string;
}

export interface LedgerVerificationResult {
  readonly valid: boolean;
  readonly totalEntries: number;
  readonly headHash: string;
  readonly tamperedIndex?: number;
  readonly failureReason?: string;
}

export interface ManifestProvenanceVerificationResult {
  readonly verified: boolean;
  readonly manifestId: string;
  readonly manifestHash: string;
  readonly ledgerIntact: boolean;
  readonly matchingEvents: ReadonlyArray<EvolutionLedgerEventType>;
  readonly latestAttestationEntry?: EvolutionLedgerEntry;
  readonly failureReason?: string;
}

export const GENESIS_PREVIOUS_HASH = '0'.repeat(64);

export class CryptographicEvolutionLedger {
  private readonly hmacSecret: string;
  private readonly builderId: string;
  private readonly entries: EvolutionLedgerEntry[] = [];

  constructor(options?: {
    readonly hmacSecret?: string;
    readonly builderId?: string;
    readonly initialBaseline?: HarnessManifest;
  }) {
    this.hmacSecret =
      options?.hmacSecret ?? 'vi-harness-zero-trust-ledger-secret-v1';
    this.builderId =
      options?.builderId ?? 'urn:vi-harness:evolution-plane:v0.2.0';

    if (options?.initialBaseline) {
      this.appendEntry({
        eventType: 'GENESIS_BASELINE',
        subjectManifestId: String(options.initialBaseline.id),
        subjectManifestHash: options.initialBaseline.contentHash,
        invocationId: 'genesis-init',
        materials: [
          {
            uri: `manifest://${options.initialBaseline.id}`,
            sha256: options.initialBaseline.contentHash,
          },
        ],
        verificationSummary: {
          canonicalBaseline: true,
          schemaVersion: options.initialBaseline.schemaVersion,
        },
      });
    }
  }

  /**
   * Appends a new cryptographically chained and HMAC-signed provenance entry to the ledger.
   */
  appendEntry(params: {
    readonly eventType: EvolutionLedgerEventType;
    readonly subjectManifestId: string;
    readonly subjectManifestHash: string;
    readonly invocationId: string;
    readonly materials?: ReadonlyArray<SlsaMaterialDigest>;
    readonly verificationSummary?: Readonly<Record<string, unknown>>;
    readonly timestamp?: string;
  }): EvolutionLedgerEntry {
    const index = this.entries.length;
    const previousEntryHash =
      index === 0 ? GENESIS_PREVIOUS_HASH : this.entries[index - 1]!.entryHash;
    const timestamp = params.timestamp ?? new Date().toISOString();
    const entryId = `ledger_${index}_${params.eventType.toLowerCase()}`;

    const slsaPredicate: SlsaEvolutionPredicate = {
      predicateType: 'https://vi-harness.dev/provenance/evolution/v1',
      builderId: this.builderId,
      invocationId: params.invocationId,
      materials: params.materials ?? [],
      verificationSummary: params.verificationSummary ?? {},
    };

    const entryHash = this.computeEntryHash({
      index,
      entryId,
      eventType: params.eventType,
      timestamp,
      subjectManifestId: params.subjectManifestId,
      subjectManifestHash: params.subjectManifestHash,
      previousEntryHash,
      slsaPredicate,
    });

    const hmacSignature = this.computeHmac(entryHash);

    const entry: EvolutionLedgerEntry = {
      index,
      entryId,
      eventType: params.eventType,
      timestamp,
      subjectManifestId: params.subjectManifestId,
      subjectManifestHash: params.subjectManifestHash,
      previousEntryHash,
      slsaPredicate,
      entryHash,
      hmacSignature,
    };

    this.entries.push(entry);
    return entry;
  }

  /**
   * Recomputes every entry hash, previous-hash link, and HMAC signature across the chain.
   */
  verifyLedgerIntegrity(
    customEntries?: ReadonlyArray<EvolutionLedgerEntry>,
  ): LedgerVerificationResult {
    const chain = customEntries ?? this.entries;
    if (chain.length === 0) {
      return {
        valid: true,
        totalEntries: 0,
        headHash: GENESIS_PREVIOUS_HASH,
      };
    }

    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i]!;
      const expectedPrevHash =
        i === 0 ? GENESIS_PREVIOUS_HASH : chain[i - 1]!.entryHash;

      if (entry.index !== i) {
        return {
          valid: false,
          totalEntries: chain.length,
          headHash: chain[chain.length - 1]!.entryHash,
          tamperedIndex: i,
          failureReason: `Entry sequence index mismatch at position ${i}: found index=${entry.index}.`,
        };
      }

      if (entry.previousEntryHash !== expectedPrevHash) {
        return {
          valid: false,
          totalEntries: chain.length,
          headHash: chain[chain.length - 1]!.entryHash,
          tamperedIndex: i,
          failureReason: `Broken hash chain link at index ${i}: previousEntryHash '${entry.previousEntryHash.slice(0, 12)}...' !== expected '${expectedPrevHash.slice(0, 12)}...'.`,
        };
      }

      const recomputedHash = this.computeEntryHash({
        index: entry.index,
        entryId: entry.entryId,
        eventType: entry.eventType,
        timestamp: entry.timestamp,
        subjectManifestId: entry.subjectManifestId,
        subjectManifestHash: entry.subjectManifestHash,
        previousEntryHash: entry.previousEntryHash,
        slsaPredicate: entry.slsaPredicate,
      });

      if (recomputedHash !== entry.entryHash) {
        return {
          valid: false,
          totalEntries: chain.length,
          headHash: chain[chain.length - 1]!.entryHash,
          tamperedIndex: i,
          failureReason: `Payload hash mismatch at index ${i} (${entry.eventType}): entry content was mutated after signing.`,
        };
      }

      const expectedHmac = this.computeHmac(entry.entryHash);
      if (expectedHmac !== entry.hmacSignature) {
        return {
          valid: false,
          totalEntries: chain.length,
          headHash: chain[chain.length - 1]!.entryHash,
          tamperedIndex: i,
          failureReason: `Invalid HMAC signature at index ${i} (${entry.eventType}).`,
        };
      }
    }

    return {
      valid: true,
      totalEntries: chain.length,
      headHash: chain[chain.length - 1]!.entryHash,
    };
  }

  /**
   * Verifies that the ledger is intact AND that the target `HarnessManifest` has a valid
   * `GENESIS_BASELINE`, `ADMISSION_DECIDED`, or `BASELINE_PROMOTED` provenance attestation
   * matching its exact `contentHash`.
   */
  verifyManifestProvenance(
    manifest: HarnessManifest,
  ): ManifestProvenanceVerificationResult {
    const chainCheck = this.verifyLedgerIntegrity();
    if (!chainCheck.valid) {
      return {
        verified: false,
        manifestId: String(manifest.id),
        manifestHash: manifest.contentHash,
        ledgerIntact: false,
        matchingEvents: [],
        failureReason: `Ledger integrity check failed: ${chainCheck.failureReason}`,
      };
    }

    const matchingEntries = this.entries.filter(
      (e) =>
        e.subjectManifestId === String(manifest.id) &&
        e.subjectManifestHash === manifest.contentHash,
    );

    if (matchingEntries.length === 0) {
      return {
        verified: false,
        manifestId: String(manifest.id),
        manifestHash: manifest.contentHash,
        ledgerIntact: true,
        matchingEvents: [],
        failureReason: `No cryptographic provenance entry found in ledger for manifest '${manifest.id}' (hash=${manifest.contentHash.slice(0, 12)}...).`,
      };
    }

    const authoritativeEvents = new Set<EvolutionLedgerEventType>([
      'GENESIS_BASELINE',
      'ADMISSION_DECIDED',
      'BASELINE_PROMOTED',
    ]);
    const hasAuthoritativeAttestation = matchingEntries.some((e) =>
      authoritativeEvents.has(e.eventType),
    );

    if (!hasAuthoritativeAttestation) {
      return {
        verified: false,
        manifestId: String(manifest.id),
        manifestHash: manifest.contentHash,
        ledgerIntact: true,
        matchingEvents: matchingEntries.map((e) => e.eventType),
        latestAttestationEntry: matchingEntries[matchingEntries.length - 1],
        failureReason: `Manifest '${manifest.id}' has intermediate ledger events (${matchingEntries.map((e) => e.eventType).join(', ')}) but no authoritative admission or genesis attestation.`,
      };
    }

    return {
      verified: true,
      manifestId: String(manifest.id),
      manifestHash: manifest.contentHash,
      ledgerIntact: true,
      matchingEvents: matchingEntries.map((e) => e.eventType),
      latestAttestationEntry: matchingEntries[matchingEntries.length - 1],
    };
  }

  getEntries(): ReadonlyArray<EvolutionLedgerEntry> {
    return [...this.entries];
  }

  private computeEntryHash(payload: {
    readonly index: number;
    readonly entryId: string;
    readonly eventType: EvolutionLedgerEventType;
    readonly timestamp: string;
    readonly subjectManifestId: string;
    readonly subjectManifestHash: string;
    readonly previousEntryHash: string;
    readonly slsaPredicate: SlsaEvolutionPredicate;
  }): string {
    const canonical = JSON.stringify({
      index: payload.index,
      entryId: payload.entryId,
      eventType: payload.eventType,
      timestamp: payload.timestamp,
      subjectManifestId: payload.subjectManifestId,
      subjectManifestHash: payload.subjectManifestHash,
      previousEntryHash: payload.previousEntryHash,
      slsaPredicate: payload.slsaPredicate,
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  private computeHmac(entryHash: string): string {
    return crypto
      .createHmac('sha256', this.hmacSecret)
      .update(entryHash)
      .digest('hex');
  }
}
