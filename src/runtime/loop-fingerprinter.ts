// Pattern: Loop-hygiene guards & repeat detection (ref: DeepSeek Harness)
/**
 * Loop Fingerprinting & Oscillation Detector.
 *
 * Prevents infinite loops and oscillation traps (A -> B -> A -> B) by computing
 * state fingerprints over phase, error signatures, modified files, and action intent.
 */
import * as crypto from 'node:crypto';

export interface LoopStateSnapshot {
  readonly phase: string;
  readonly activeError?: string;
  readonly modifiedFiles: ReadonlyArray<string>;
  readonly proposedToolNames: ReadonlyArray<string>;
  readonly hypothesis?: string;
}

export type LoopAnomalyType = 'OSCILLATION' | 'STAGNATION' | 'REPEATED_FAILURE';

export interface LoopAnomalyDetection {
  readonly anomalyType: LoopAnomalyType;
  readonly description: string;
  readonly repeatedFingerprint: string;
  readonly occurrences: number;
  readonly iterationsInvolved: ReadonlyArray<number>;
  readonly detectedAtIteration: number;
}

export class LoopFingerprinter {
  private readonly history: Array<{ readonly fingerprint: string; readonly iteration: number }> =
    [];
  private readonly maxWindowSize: number;
  private readonly maxAllowedRepeats: number;

  constructor(options?: { maxWindowSize?: number; maxAllowedRepeats?: number }) {
    this.maxWindowSize = options?.maxWindowSize ?? 8;
    this.maxAllowedRepeats = options?.maxAllowedRepeats ?? 3;
  }

  /**
   * Computes a canonical deterministic hash for a given loop state snapshot.
   */
  static computeFingerprint(snapshot: LoopStateSnapshot): string {
    const normalizedFiles = [...snapshot.modifiedFiles].sort().join(',');
    const normalizedTools = [...snapshot.proposedToolNames].sort().join(',');
    const normalizedError = snapshot.activeError
      ? snapshot.activeError.trim().substring(0, 100)
      : 'NO_ERROR';
    const normalizedHypothesis = snapshot.hypothesis
      ? snapshot.hypothesis.trim().substring(0, 80)
      : '';

    const payload = `${snapshot.phase}|${normalizedError}|${normalizedFiles}|${normalizedTools}|${normalizedHypothesis}`;
    return crypto.createHash('sha256').update(payload, 'utf-8').digest('hex').substring(0, 16);
  }

  /**
   * Record state at current iteration and check for loop anomalies.
   */
  recordAndInspect(
    snapshot: LoopStateSnapshot,
    currentIteration: number,
  ): LoopAnomalyDetection | null {
    const fingerprint = LoopFingerprinter.computeFingerprint(snapshot);
    this.history.push({ fingerprint, iteration: currentIteration });

    if (this.history.length > this.maxWindowSize) {
      this.history.shift();
    }

    // 1. Check for immediate stagnation (A -> A -> A)
    if (this.history.length >= 3) {
      const lastThree = this.history.slice(-3);
      if (lastThree.every((h) => h.fingerprint === fingerprint)) {
        return {
          anomalyType: 'STAGNATION',
          description: `Stagnation detected: identical state repeated across 3 consecutive turns (iterations: ${lastThree.map((h) => h.iteration).join(', ')}).`,
          repeatedFingerprint: fingerprint,
          occurrences: 3,
          iterationsInvolved: lastThree.map((h) => h.iteration),
          detectedAtIteration: currentIteration,
        };
      }
    }

    // 2. Check for alternating 2-cycle oscillation (A -> B -> A -> B)
    if (this.history.length >= 4) {
      const [h1, h2, h3, h4] = this.history.slice(-4);
      if (h1 && h2 && h3 && h4) {
        if (
          h1.fingerprint === h3.fingerprint &&
          h2.fingerprint === h4.fingerprint &&
          h1.fingerprint !== h2.fingerprint
        ) {
          return {
            anomalyType: 'OSCILLATION',
            description: `Oscillation cycle detected between states [${h1.fingerprint}] and [${h2.fingerprint}] (iterations: ${h1.iteration}, ${h2.iteration}, ${h3.iteration}, ${h4.iteration}).`,
            repeatedFingerprint: fingerprint,
            occurrences: 2,
            iterationsInvolved: [h1.iteration, h2.iteration, h3.iteration, h4.iteration],
            detectedAtIteration: currentIteration,
          };
        }
      }
    }

    // 3. Check for repeated failures / general repetitions in sliding window
    const matchingEntries = this.history.filter((h) => h.fingerprint === fingerprint);
    if (matchingEntries.length >= this.maxAllowedRepeats) {
      return {
        anomalyType: 'REPEATED_FAILURE',
        description: `State [${fingerprint}] repeated ${matchingEntries.length} times within recent window (iterations: ${matchingEntries.map((h) => h.iteration).join(', ')}).`,
        repeatedFingerprint: fingerprint,
        occurrences: matchingEntries.length,
        iterationsInvolved: matchingEntries.map((h) => h.iteration),
        detectedAtIteration: currentIteration,
      };
    }

    return null;
  }

  /**
   * Reset history for a new task or after an approved major context reset.
   */
  reset(): void {
    this.history.length = 0;
  }
}
