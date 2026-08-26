/**
 * Pi-Style Compaction Baseline Strategy.
 *
 * Simulates conversational agent compaction baselines (e.g. Pi / chat sliding-window compaction).
 *
 * Compaction Mechanism:
 * - Keeps a sliding window of the last K (e.g. 6) turns intact.
 * - When cumulative context exceeds the token limit (e.g., 3,500 tokens), it replaces all
 *   older turns with a generic 1-paragraph text summary.
 * - Consequence: Specific architectural invariants, schema rules, and critical facts injected
 *   earlier in the trajectory are lost during shallow text compaction.
 */
import type {
  TrajectoryStep,
  CriticalMemoryItem,
  ContextStrategyType,
} from '../../../core/model/context-benchmark-types.js';
import type {
  ContextBenchmarkStrategy,
  StrategyStepResult,
  RetentionEvaluationResult,
} from './context-strategy.js';

export interface PiCompactionOptions {
  /** Maximum context token threshold before compaction triggers (default: 3500) */
  readonly tokenThreshold?: number;
  /** Number of recent turns to preserve intact (default: 6) */
  readonly windowSize?: number;
}

export class PiCompactionStrategy implements ContextBenchmarkStrategy {
  readonly name: ContextStrategyType = 'PI_COMPACTION';
  readonly displayName = '2. Pi-style Compaction Baseline';

  private readonly tokenThreshold: number;
  private readonly windowSize: number;

  private systemPrompt: string = '';
  private summaryParagraph: string = '';
  private recentTurns: string[] = [];
  private currentContext: string = '';

  constructor(options?: PiCompactionOptions) {
    this.tokenThreshold = options?.tokenThreshold ?? 3500;
    this.windowSize = options?.windowSize ?? 6;
  }

  reset(): void {
    this.systemPrompt =
      'SYSTEM: You are an autonomous coding agent operating in a conversational sliding window.';
    this.summaryParagraph = '';
    this.recentTurns = [];
    this.assembleContext();
  }

  async processStep(step: TrajectoryStep): Promise<StrategyStepResult> {
    const formattedEntry = this.formatStep(step);
    this.recentTurns.push(formattedEntry);

    // If recent turns exceed window size, compact older turns
    if (this.recentTurns.length > this.windowSize) {
      const evictedTurn = this.recentTurns.shift()!;
      this.updateSummaryWithEvictedTurn(evictedTurn);
    }

    this.assembleContext();

    // If context exceeds token threshold, compact further
    let currentTokens = this.estimateTokenCount(this.currentContext);
    if (currentTokens > this.tokenThreshold && this.recentTurns.length > 2) {
      while (this.recentTurns.length > 2 && currentTokens > this.tokenThreshold) {
        const evicted = this.recentTurns.shift()!;
        this.updateSummaryWithEvictedTurn(evicted);
        this.assembleContext();
        currentTokens = this.estimateTokenCount(this.currentContext);
      }
    }

    return {
      compiledContextText: this.currentContext,
      contextTokens: currentTokens,
    };
  }

  evaluateRetention(injectedItems: ReadonlyArray<CriticalMemoryItem>): RetentionEvaluationResult {
    const retained: string[] = [];
    const lost: string[] = [];

    for (const item of injectedItems) {
      if (this.currentContext.includes(item.expectedPattern)) {
        retained.push(item.id);
      } else {
        lost.push(item.id);
      }
    }

    const totalInjected = injectedItems.length;
    const retainedCount = retained.length;
    const retentionRate = totalInjected > 0 ? retainedCount / totalInjected : 1.0;

    return {
      retentionRate,
      retainedCount,
      totalInjected,
      retained,
      lost,
    };
  }

  getCurrentContextText(): string {
    return this.currentContext;
  }

  private assembleContext(): void {
    const parts = [this.systemPrompt];
    if (this.summaryParagraph.length > 0) {
      parts.push(`--- SUMMARY OF PREVIOUS CONVERSATION ---\n${this.summaryParagraph}`);
    }
    if (this.recentTurns.length > 0) {
      parts.push(`--- RECENT INTERACTION WINDOW ---\n${this.recentTurns.join('\n\n')}`);
    }
    this.currentContext = parts.join('\n\n');
  }

  private updateSummaryWithEvictedTurn(_turnText: string): void {
    // Naive summary extraction typical of conversational compaction heuristics
    // Loses exact variable names, port numbers, schema details, and credentials
    const summaryLines = [
      'The agent previously explored the codebase, executed terminal commands, and reviewed tests.',
      'Various file edits and refactoring tasks were performed to improve system behavior.',
      'Recent logs were inspected to identify potential issues and confirm progress.',
    ];

    if (!this.summaryParagraph) {
      this.summaryParagraph = summaryLines.join(' ');
    } else {
      this.summaryParagraph = `${this.summaryParagraph} Additional operations were carried out.`;
    }
  }

  private formatStep(step: TrajectoryStep): string {
    const parts: string[] = [`[Iter ${step.iteration}] ${step.content}`];
    if (step.toolName) {
      parts.push(
        `Tool ${step.toolName}: ${step.toolOutput ? step.toolOutput.slice(0, 300) : 'Done'}`,
      );
    }
    return parts.join('\n');
  }

  private estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 3.8);
  }
}
