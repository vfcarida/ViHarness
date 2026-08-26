/**
 * Prefix Caching Prompt Compiler.
 *
 * Formats model prompt messages into explicit Static and Dynamic segments to
 * maximize provider-level Prompt Caching (Anthropic, OpenAI, DeepSeek).
 *
 * Keeps large invariant context (system rules, tool schemas, repo maps) in the
 * static prefix while placing per-iteration state (errors, tool outputs) at the suffix.
 */
import { MessageRole, type ModelMessage } from '../../core/model/model-io.js';
import type { PrefixCachingPayload, PromptCacheSegment } from '../../core/model/caching-types.js';

export interface PrefixCachingCompilerInput {
  readonly systemPrompt: string;
  readonly toolSchemasText?: string;
  readonly repoMapOutline?: string;
  readonly codingStandards?: string;
  readonly taskDescription: string;
  readonly currentPhase: string;
  readonly iterationNumber: number;
  readonly dynamicObservations?: ReadonlyArray<string>;
  readonly activeFileContents?: ReadonlyArray<{ readonly path: string; readonly content: string }>;
}

export class PrefixCachingCompiler {
  /**
   * Compiles input into structured static and dynamic segments.
   */
  static compile(input: PrefixCachingCompilerInput): PrefixCachingPayload {
    const segments: PromptCacheSegment[] = [];

    // 1. Static System Instructions & Standards
    let staticSystemText = input.systemPrompt.trim();
    if (input.codingStandards) {
      staticSystemText += `\n\n# Repository Coding Standards:\n${input.codingStandards.trim()}`;
    }
    if (input.toolSchemasText) {
      staticSystemText += `\n\n# Available Tools & Schemas:\n${input.toolSchemasText.trim()}`;
    }

    const staticSystemTokens = Math.ceil(staticSystemText.length / 4);
    segments.push({
      segmentType: 'STATIC',
      role: MessageRole.SYSTEM,
      content: staticSystemText,
      estimatedTokens: staticSystemTokens,
      cacheControl: { type: 'ephemeral' },
      tag: 'system_instructions',
    });

    // 2. Static Repo-Map / Architecture Outline (if provided)
    if (input.repoMapOutline && input.repoMapOutline.trim().length > 0) {
      const repoMapText = `# Repository Outline & Symbol Map:\n${input.repoMapOutline.trim()}`;
      const repoMapTokens = Math.ceil(repoMapText.length / 4);
      segments.push({
        segmentType: 'STATIC',
        role: MessageRole.SYSTEM,
        content: repoMapText,
        estimatedTokens: repoMapTokens,
        cacheControl: { type: 'ephemeral' },
        tag: 'repo_symbol_map',
      });
    }

    // 3. Dynamic Task & Current State Segment
    let dynamicText = `# Current Task & Iteration State:\nTask: ${input.taskDescription}\nPhase: ${input.currentPhase}\nIteration: ${input.iterationNumber}`;

    if (input.activeFileContents && input.activeFileContents.length > 0) {
      dynamicText += '\n\n# Active Focused Files:\n';
      for (const file of input.activeFileContents) {
        dynamicText += `\n--- File: ${file.path} ---\n${file.content}\n`;
      }
    }

    if (input.dynamicObservations && input.dynamicObservations.length > 0) {
      dynamicText += '\n\n# Recent Observations & Tool Results:\n';
      for (const obs of input.dynamicObservations) {
        dynamicText += `\n- ${obs}`;
      }
    }

    const dynamicTokens = Math.ceil(dynamicText.length / 4);
    segments.push({
      segmentType: 'DYNAMIC',
      role: MessageRole.USER,
      content: dynamicText,
      estimatedTokens: dynamicTokens,
      tag: 'dynamic_iteration_state',
    });

    // Calculate totals
    let totalStaticTokens = 0;
    let totalDynamicTokens = 0;

    for (const s of segments) {
      if (s.segmentType === 'STATIC') {
        totalStaticTokens += s.estimatedTokens;
      } else {
        totalDynamicTokens += s.estimatedTokens;
      }
    }

    const totalTokens = totalStaticTokens + totalDynamicTokens;
    const staticTokenRatio = totalTokens > 0 ? totalStaticTokens / totalTokens : 0;

    // Convert segments into standard ModelMessage array
    const formattedMessages: ModelMessage[] = segments.map((seg) => ({
      role: seg.role,
      content: seg.content,
      metadata: {
        segmentType: seg.segmentType,
        tag: seg.tag,
        cacheControl: seg.cacheControl,
      },
    }));

    return {
      segments,
      formattedMessages,
      totalStaticTokens,
      totalDynamicTokens,
      staticTokenRatio,
      compiledAt: new Date(),
    };
  }
}
