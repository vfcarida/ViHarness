/**
 * Trajectory Distillation to Fine-Tuning (SFT) & Preference Optimization (DPO) Dataset Exporter.
 *
 * Distills verified Vi-Harness execution traces into high-quality training pairs:
 * - SFT (Supervised Fine-Tuning): Multi-turn agent conversations with tool calls, results, and step resolutions.
 * - DPO (Direct Preference Optimization): Triples of (prompt, chosen, rejected) derived from corrected failed iterations.
 */
import type { IterationTraceRecord } from '../../core/model/trace-types.js';
import { ActionResultStatus } from '../../core/model/action.js';

export interface SftTrainingExample {
  readonly id: string;
  readonly messages: ReadonlyArray<{
    readonly role: 'system' | 'user' | 'assistant' | 'tool';
    readonly content: string;
    readonly tool_calls?: ReadonlyArray<{
      readonly id: string;
      readonly type: 'function';
      readonly function: {
        readonly name: string;
        readonly arguments: string;
      };
    }>;
    readonly tool_call_id?: string;
  }>;
}

export interface DpoTrainingExample {
  readonly id: string;
  readonly prompt: string;
  readonly chosen: string;
  readonly rejected: string;
  readonly metadata?: Record<string, unknown>;
}

export class TrajectoryDatasetExporter {
  /**
   * Export an execution trajectory as an OpenAI / Hugging Face compatible SFT JSONL string.
   */
  static exportSft(records: ReadonlyArray<IterationTraceRecord>): string {
    if (records.length === 0) return '';

    const examples: SftTrainingExample[] = [];
    const executionId = records[0]!.executionId;

    const messages: Array<{
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
      tool_call_id?: string;
    }> = [];

    // Base system instruction
    messages.push({
      role: 'system',
      content:
        'You are an autonomous software engineering agent operating as a stateful, evidence-driven state machine.',
    });

    for (const rec of records) {
      // 1. Add input messages from the iteration
      for (const m of rec.messages) {
        if (m.role === 'USER') {
          messages.push({ role: 'user', content: m.content });
        }
      }

      // 2. Add assistant proposed tool calls
      if (rec.proposedToolCalls.length > 0) {
        const formattedToolCalls = rec.proposedToolCalls.map((p) => ({
          id: p.id,
          type: 'function' as const,
          function: {
            name: p.name,
            arguments: JSON.stringify(p.input),
          },
        }));

        messages.push({
          role: 'assistant',
          content: `Proceeding with phase [${rec.phaseAfter}]. Proposing tool execution.`,
          tool_calls: formattedToolCalls,
        });

        // 3. Add tool execution results
        for (const res of rec.executedToolResults) {
          const toolCallId = String(res.metadata?.['toolCallId'] ?? res.actionId);
          messages.push({
            role: 'tool',
            content: res.output,
            tool_call_id: toolCallId,
          });
        }
      }
    }

    examples.push({
      id: `sft_${executionId}`,
      messages,
    });

    return examples.map((e) => JSON.stringify(e)).join('\n');
  }

  /**
   * Extract DPO preference pairs (prompt, chosen, rejected) from self-correction inflection points.
   */
  static exportDpo(records: ReadonlyArray<IterationTraceRecord>): string {
    const dpoTriples: DpoTrainingExample[] = [];

    for (let i = 0; i < records.length - 1; i++) {
      const current = records[i]!;
      const next = records[i + 1]!;

      // Check if current iteration had a failed tool or policy rejection, and next iteration succeeded
      const hasFailure =
        current.executedToolResults.some((r) => r.status === ActionResultStatus.FAILURE) ||
        current.policyDecisions.some((p) => String(p.decision) === 'DENY');
      const nextSucceeded = next.executedToolResults.every(
        (r) => r.status === ActionResultStatus.SUCCESS,
      );

      if (
        hasFailure &&
        nextSucceeded &&
        current.proposedToolCalls.length > 0 &&
        next.proposedToolCalls.length > 0
      ) {
        const promptText = current.messages.map((m) => `${m.role}: ${m.content}`).join('\n');
        const rejectedProposal = JSON.stringify(current.proposedToolCalls);
        const chosenProposal = JSON.stringify(next.proposedToolCalls);

        dpoTriples.push({
          id: `dpo_${current.executionId}_step${current.sequenceNumber}`,
          prompt: promptText,
          chosen: chosenProposal,
          rejected: rejectedProposal,
          metadata: {
            failedIteration: current.sequenceNumber,
            correctedIteration: next.sequenceNumber,
          },
        });
      }
    }

    return dpoTriples.map((t) => JSON.stringify(t)).join('\n');
  }
}
