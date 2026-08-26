/**
 * Naive Transcript Accumulation Strategy.
 *
 * Simulates standard chat-based agent architectures that naively append every
 * message, tool call, reasoning thought, and raw output to a single unbounded transcript.
 *
 * Characteristics:
 * - Linear context growth $O(N)$
 * - Quadratic cumulative token consumption $O(N^2)$
 * - Context bloat and extreme token costs on long horizons
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

export class NaiveAccumulationStrategy implements ContextBenchmarkStrategy {
  readonly name: ContextStrategyType = 'NAIVE_ACCUMULATION';
  readonly displayName = '1. Naive Transcript Accumulation';

  private transcript: string[] = [];
  private currentContext: string = '';

  reset(): void {
    this.transcript = [
      'SYSTEM: You are an autonomous software engineering agent tasked with maintaining enterprise repositories.',
    ];
    this.currentContext = this.transcript.join('\n\n');
  }

  async processStep(step: TrajectoryStep): Promise<StrategyStepResult> {
    const formattedEntry = this.formatStep(step);
    this.transcript.push(formattedEntry);
    this.currentContext = this.transcript.join('\n\n');

    const contextTokens = this.estimateTokenCount(this.currentContext);
    return {
      compiledContextText: this.currentContext,
      contextTokens,
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

  private formatStep(step: TrajectoryStep): string {
    const parts: string[] = [
      `[Iter ${step.iteration} - ${step.role.toUpperCase()}] ${step.content}`,
    ];
    if (step.toolName) {
      parts.push(`TOOL_CALL: ${step.toolName}(${JSON.stringify(step.toolInput ?? {})})`);
    }
    if (step.toolOutput) {
      parts.push(`TOOL_OUTPUT: ${step.toolOutput}`);
    }
    return parts.join('\n');
  }

  private estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 3.8);
  }
}
