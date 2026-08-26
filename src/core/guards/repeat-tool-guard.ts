// Pattern: Repeat-Tool Advisory Guard (ref: DeepSeek Harness)
/**
 * Repeat-Tool Advisory Reminder Guard.
 *
 * Tracks tool invocations in a sliding window and generates advisory warnings
 * when the agent repeats identical or near-identical tool calls (> 90% argument similarity)
 * to break unproductive loops.
 */
export interface RepeatGuardConfig {
  /** Enable or disable the repeat tool guard (default: true). */
  readonly enabled: boolean;
  /** Number of repeated invocations before generating a reminder (default: 3). */
  readonly thresholdCount: number;
  /** Argument similarity threshold between 0.0 and 1.0 (default: 0.9). */
  readonly similarityThreshold: number;
  /** Sliding window size of prior tool calls to inspect (default: 20). */
  readonly windowSize: number;
}

export const DEFAULT_REPEAT_GUARD_CONFIG: RepeatGuardConfig = {
  enabled: true,
  thresholdCount: 3,
  similarityThreshold: 0.9,
  windowSize: 20,
};

export interface RepeatInfo {
  readonly tool: string;
  readonly count: number;
  readonly similarity: number;
  readonly previousResults: ReadonlyArray<string>;
}

export interface ToolCallHistoryEntry {
  readonly callId: string;
  readonly tool: string;
  readonly args: unknown;
  readonly serializedArgs: string;
  readonly resultSummary?: string;
  readonly timestamp: number;
}

export class DefaultRepeatToolGuard {
  private readonly config: RepeatGuardConfig;
  private readonly history: ToolCallHistoryEntry[] = [];

  constructor(config: Partial<RepeatGuardConfig> = {}) {
    this.config = { ...DEFAULT_REPEAT_GUARD_CONFIG, ...config };
  }

  /**
   * Record a completed tool call into the sliding window.
   */
  recordCall(callId: string, name: string, args: unknown, resultSummary?: string): void {
    if (!this.config.enabled) return;

    this.history.push({
      callId,
      tool: name,
      args,
      serializedArgs: this.normalizeArgs(args),
      resultSummary: resultSummary ? resultSummary.slice(0, 150) : undefined,
      timestamp: Date.now(),
    });

    if (this.history.length > this.config.windowSize) {
      this.history.shift();
    }
  }

  /**
   * Check if an upcoming tool call is a repetition above threshold.
   */
  isRepeat(name: string, args: unknown): RepeatInfo | null {
    if (!this.config.enabled) return null;

    const normalizedTarget = this.normalizeArgs(args);
    const matches: ToolCallHistoryEntry[] = [];
    let highestSimilarity = 0;

    // Search window in reverse
    for (let i = this.history.length - 1; i >= 0; i--) {
      const entry = this.history[i]!;
      if (entry.tool === name) {
        const similarity = this.computeSimilarity(normalizedTarget, entry.serializedArgs);
        if (similarity >= this.config.similarityThreshold) {
          matches.push(entry);
          if (similarity > highestSimilarity) highestSimilarity = similarity;
        }
      }
    }

    // Including this upcoming call: count = matches.length + 1
    const totalCount = matches.length + 1;
    if (totalCount >= this.config.thresholdCount) {
      const previousResults = matches.map((m) => m.resultSummary || '(no summary)').filter(Boolean);

      return {
        tool: name,
        count: totalCount,
        similarity: highestSimilarity || 1.0,
        previousResults,
      };
    }

    return null;
  }

  /**
   * Generate an advisory reminder string for the model.
   */
  generateReminder(info: RepeatInfo): string {
    const resultsSummary =
      info.previousResults.length > 0
        ? `\nPrevious observations: [${info.previousResults.slice(0, 3).join(' | ')}]`
        : '';

    return (
      `Advisory Notice: You have invoked tool '${info.tool}' ${info.count} times ` +
      `with similar arguments (${Math.round(info.similarity * 100)}% similarity).${resultsSummary}\n` +
      `Please consider adopting a different strategy, modifying parameters, or using the data you already obtained.`
    );
  }

  /**
   * Clear recorded history.
   */
  clear(): void {
    this.history.length = 0;
  }

  private normalizeArgs(args: unknown): string {
    if (args === null || args === undefined) return '';
    if (typeof args === 'string') return args.trim().toLowerCase();
    try {
      if (typeof args === 'object') {
        // Sort keys deterministically
        const sorted = Object.keys(args as object)
          .sort()
          .reduce(
            (acc, k) => {
              acc[k] = (args as any)[k];
              return acc;
            },
            {} as Record<string, unknown>,
          );
        return JSON.stringify(sorted).toLowerCase();
      }
      return String(args).toLowerCase();
    } catch {
      return String(args).toLowerCase();
    }
  }

  private computeSimilarity(a: string, b: string): number {
    if (a === b) return 1.0;
    if (!a || !b) return 0.0;

    // Token-based Jaccard similarity + Levenshtein character similarity
    const setA = new Set(a.split(/[\s,{}":[\]]+/));
    const setB = new Set(b.split(/[\s,{}":[\]]+/));

    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    const jaccard = union.size > 0 ? intersection.size / union.size : 0.0;

    // Length penalty
    const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return jaccard * 0.7 + lenRatio * 0.3;
  }
}
