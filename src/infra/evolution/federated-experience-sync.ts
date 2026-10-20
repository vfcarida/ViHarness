/**
 * Wave 7.5 — Zero-Trust Federated Experience Synchronizer & Privacy Sanitizer
 * (`FederatedExperienceSynchronizer`).
 *
 * Enables cross-repository sharing of evolved `ExperienceEntry` lessons and
 * `TransferableCore` harness artifacts across workspaces (e.g., `Vi-Harness` <-> `ViForge`
 * <-> enterprise repositories) while enforcing:
 * 1. **Zero-Trust Privacy & Specificity Sanitization**:
 *    Redacts absolute/relative host file paths, API keys/tokens, email addresses,
 *    and benchmark-specific task IDs (`swe-bench__*`, `task-*`) from all text surfaces
 *    before export.
 * 2. **Wilson Score Lower-Confidence Bound (LCB) Conflict Resolution**:
 *    When importing an external federated bundle into a local `HarnessExperienceLibrary`,
 *    computes $\text{LCB}_{\text{Wilson}}(p, n)$ for competing entries and quarantines
 *    any unverified executable surface (`scripts`, `plugins`) until local probing completes.
 */
import * as crypto from 'node:crypto';
import { ComponentCapabilityClass } from '../../core/evolution/constitution.js';
import type {
  ExperienceEntry,
  HarnessExperienceLibrary,
} from '../../core/evolution/interfaces.js';

export interface FederatedPrivacyAuditReport {
  readonly pathsRedacted: number;
  readonly secretsRedacted: number;
  readonly emailsRedacted: number;
  readonly taskIdsRedacted: number;
  readonly clean: boolean;
}

export interface FederatedExperienceBundle {
  readonly schemaVersion: '1.0.0';
  readonly bundleId: string;
  readonly sourceWorkspaceAnonymizedId: string;
  readonly exportedAt: string;
  readonly entries: ReadonlyArray<ExperienceEntry>;
  readonly privacyAudit: FederatedPrivacyAuditReport;
  readonly bundleDigest: string;
  readonly hmacSignature: string;
}

export interface FederatedImportReport {
  readonly bundleId: string;
  readonly signatureVerified: boolean;
  readonly totalIncoming: number;
  readonly importedActiveCount: number;
  readonly quarantinedExecutableCount: number;
  readonly skippedLowerConfidenceCount: number;
  readonly rejectedReason?: string;
}

const PATH_REGEX =
  /(?:[a-zA-Z]:\\[^\s"'`]+|\/(?:Users|home|var|tmp|opt|etc|workspace|repos)\/[^\s"'`]+)/g;
const SECRET_REGEX =
  /\b(?:sk-[a-zA-Z0-9_-]{12,}|ghp_[a-zA-Z0-9]{16,}|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[a-zA-Z0-9._-]{16,})\b/g;
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const TASK_ID_REGEX =
  /\b(?:swe-bench__[a-zA-Z0-9_-]+|swebench-[a-zA-Z0-9_-]+|issue-\d{3,})\b/gi;

export class FederatedExperienceSynchronizer {
  private readonly hmacSecret: string;

  constructor(options?: { readonly hmacSecret?: string }) {
    this.hmacSecret =
      options?.hmacSecret ?? 'vi-harness-federated-sync-secret-v1';
  }

  /**
   * Scrubs proprietary host file paths, API keys/tokens, emails, and benchmark task IDs
   * from arbitrary text.
   */
  sanitizeText(text: string): {
    readonly sanitized: string;
    readonly pathsRedacted: number;
    readonly secretsRedacted: number;
    readonly emailsRedacted: number;
    readonly taskIdsRedacted: number;
  } {
    let pathsRedacted = 0;
    let secretsRedacted = 0;
    let emailsRedacted = 0;
    let taskIdsRedacted = 0;

    const afterSecrets = text.replace(SECRET_REGEX, () => {
      secretsRedacted++;
      return '[REDACTED_SECRET]';
    });
    const afterPaths = afterSecrets.replace(PATH_REGEX, () => {
      pathsRedacted++;
      return '[REDACTED_PATH]';
    });
    const afterEmails = afterPaths.replace(EMAIL_REGEX, () => {
      emailsRedacted++;
      return '[REDACTED_EMAIL]';
    });
    const sanitized = afterEmails.replace(TASK_ID_REGEX, () => {
      taskIdsRedacted++;
      return '[REDACTED_TASK_ID]';
    });

    return {
      sanitized,
      pathsRedacted,
      secretsRedacted,
      emailsRedacted,
      taskIdsRedacted,
    };
  }

  /**
   * Exports active, high-confidence entries from a `HarnessExperienceLibrary` into a
   * privacy-sanitized, HMAC-signed `FederatedExperienceBundle`.
   */
  async exportSanitizedBundle(params: {
    readonly library: HarnessExperienceLibrary;
    readonly sourceWorkspaceName: string;
    readonly minConfidence?: number;
  }): Promise<FederatedExperienceBundle> {
    const rawEntries = await params.library.query({
      includeNegativeEvidence: false,
      includeStale: false,
      minConfidence: params.minConfidence ?? 0.65,
      limit: 100,
    });

    let totalPaths = 0;
    let totalSecrets = 0;
    let totalEmails = 0;
    let totalTaskIds = 0;

    const scrub = (val: string): string => {
      const res = this.sanitizeText(val);
      totalPaths += res.pathsRedacted;
      totalSecrets += res.secretsRedacted;
      totalEmails += res.emailsRedacted;
      totalTaskIds += res.taskIdsRedacted;
      return res.sanitized;
    };

    const sanitizedEntries: ExperienceEntry[] = rawEntries
      .filter((e) => e.status === 'ACTIVE')
      .map((entry) => ({
        ...entry,
        diffFromBaseline: {
          ...entry.diffFromBaseline,
          componentDiffs: entry.diffFromBaseline.componentDiffs.map((cd) => ({
            ...cd,
            beforeContent:
              typeof cd.beforeContent === 'string'
                ? scrub(cd.beforeContent)
                : cd.beforeContent,
            afterContent:
              typeof cd.afterContent === 'string'
                ? scrub(cd.afterContent)
                : cd.afterContent,
            summary: scrub(cd.summary),
          })),
        },
        hypothesis: {
          ...entry.hypothesis,
          rationale: scrub(entry.hypothesis.rationale),
          generalizationClaim: scrub(entry.hypothesis.generalizationClaim),
        },
        positiveEvidence: entry.positiveEvidence.map(scrub),
        negativeEvidence: entry.negativeEvidence.map(scrub),
        manifest: {
          ...entry.manifest,
          components: {
            ...entry.manifest.components,
            systemPrompt: {
              ...entry.manifest.components.systemPrompt,
              content:
                typeof entry.manifest.components.systemPrompt.content ===
                'string'
                  ? scrub(entry.manifest.components.systemPrompt.content)
                  : entry.manifest.components.systemPrompt.content,
            },
            toolGuidance: {
              ...entry.manifest.components.toolGuidance,
              content:
                typeof entry.manifest.components.toolGuidance.content ===
                'string'
                  ? scrub(entry.manifest.components.toolGuidance.content)
                  : entry.manifest.components.toolGuidance.content,
            },
          },
        },
      }));

    const anonymizedWorkspaceId = `ws_${crypto
      .createHash('sha256')
      .update(params.sourceWorkspaceName)
      .digest('hex')
      .slice(0, 12)}`;

    const exportedAt = new Date().toISOString();
    const bundleId = `fed_bundle_${Date.now()}`;
    const privacyAudit: FederatedPrivacyAuditReport = {
      pathsRedacted: totalPaths,
      secretsRedacted: totalSecrets,
      emailsRedacted: totalEmails,
      taskIdsRedacted: totalTaskIds,
      clean: true,
    };

    const bundleDigest = this.computeBundleDigest({
      bundleId,
      sourceWorkspaceAnonymizedId: anonymizedWorkspaceId,
      exportedAt,
      entries: sanitizedEntries,
      privacyAudit,
    });

    const hmacSignature = crypto
      .createHmac('sha256', this.hmacSecret)
      .update(bundleDigest)
      .digest('hex');

    return {
      schemaVersion: '1.0.0',
      bundleId,
      sourceWorkspaceAnonymizedId: anonymizedWorkspaceId,
      exportedAt,
      entries: sanitizedEntries,
      privacyAudit,
      bundleDigest,
      hmacSignature,
    };
  }

  /**
   * Verifies and merges an external `FederatedExperienceBundle` into a target
   * `HarnessExperienceLibrary` using Wilson Score LCB conflict resolution and
   * fail-closed quarantine for executable surfaces.
   */
  async importFederatedBundle(params: {
    readonly targetLibrary: HarnessExperienceLibrary;
    readonly bundle: FederatedExperienceBundle;
  }): Promise<FederatedImportReport> {
    const { bundle, targetLibrary } = params;

    const expectedDigest = this.computeBundleDigest({
      bundleId: bundle.bundleId,
      sourceWorkspaceAnonymizedId: bundle.sourceWorkspaceAnonymizedId,
      exportedAt: bundle.exportedAt,
      entries: bundle.entries,
      privacyAudit: bundle.privacyAudit,
    });

    const expectedSig = crypto
      .createHmac('sha256', this.hmacSecret)
      .update(expectedDigest)
      .digest('hex');

    if (
      expectedDigest !== bundle.bundleDigest ||
      expectedSig !== bundle.hmacSignature
    ) {
      return {
        bundleId: bundle.bundleId,
        signatureVerified: false,
        totalIncoming: bundle.entries.length,
        importedActiveCount: 0,
        quarantinedExecutableCount: 0,
        skippedLowerConfidenceCount: 0,
        rejectedReason:
          'Federated bundle digest or HMAC signature verification failed.',
      };
    }

    const existingEntries = await targetLibrary.query({
      includeNegativeEvidence: true,
      includeStale: false,
      limit: 500,
    });

    let importedActiveCount = 0;
    let quarantinedExecutableCount = 0;
    let skippedLowerConfidenceCount = 0;

    for (const incoming of bundle.entries) {
      const touchesExecutable =
        incoming.diffFromBaseline.highestRiskClassTouched ===
          ComponentCapabilityClass.EXECUTABLE ||
        incoming.diffFromBaseline.changedSurfaces.some(
          (s) => s === 'scripts' || s === 'plugins',
        );

      if (touchesExecutable) {
        await targetLibrary.record({
          ...incoming,
          status: 'QUARANTINED',
          negativeEvidence: [
            ...incoming.negativeEvidence,
            `Federated import from '${bundle.sourceWorkspaceAnonymizedId}': executable surface quarantined pending local probe verification.`,
          ],
        });
        quarantinedExecutableCount++;
        continue;
      }

      const incomingLcb = this.computeWilsonLowerBound(
        incoming.confidence,
        Math.max(1, incoming.repetitionsCount),
      );

      // Check if local library already has a higher-LCB entry for the same quadrant & surfaces
      const surfaceKey = incoming.diffFromBaseline.changedSurfaces
        .slice()
        .sort()
        .join(',');
      const conflictingLocal = existingEntries.find(
        (loc) =>
          loc.status === 'ACTIVE' &&
          loc.hypothesis.quadrant === incoming.hypothesis.quadrant &&
          loc.diffFromBaseline.changedSurfaces.slice().sort().join(',') ===
            surfaceKey,
      );

      if (conflictingLocal) {
        const localLcb = this.computeWilsonLowerBound(
          conflictingLocal.confidence,
          Math.max(1, conflictingLocal.repetitionsCount),
        );
        if (localLcb >= incomingLcb) {
          skippedLowerConfidenceCount++;
          continue;
        }
      }

      await targetLibrary.record({
        ...incoming,
        status: 'ACTIVE',
      });
      importedActiveCount++;
    }

    return {
      bundleId: bundle.bundleId,
      signatureVerified: true,
      totalIncoming: bundle.entries.length,
      importedActiveCount,
      quarantinedExecutableCount,
      skippedLowerConfidenceCount,
    };
  }

  /**
   * Computes the 95% Wilson Score Lower Confidence Bound for empirical confidence $p \in [0, 1]$
   * over $n$ repetitions.
   */
  computeWilsonLowerBound(p: number, n: number): number {
    const z = 1.96;
    const clampedP = Math.max(0, Math.min(1, p));
    const safeN = Math.max(1, n);
    const z2 = z * z;
    const denom = 1 + z2 / safeN;
    const center = clampedP + z2 / (2 * safeN);
    const halfWidth =
      z *
      Math.sqrt(
        (clampedP * (1 - clampedP)) / safeN + z2 / (4 * safeN * safeN),
      );
    return Number(Math.max(0, (center - halfWidth) / denom).toFixed(4));
  }

  private computeBundleDigest(payload: {
    readonly bundleId: string;
    readonly sourceWorkspaceAnonymizedId: string;
    readonly exportedAt: string;
    readonly entries: ReadonlyArray<ExperienceEntry>;
    readonly privacyAudit: FederatedPrivacyAuditReport;
  }): string {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
  }
}
