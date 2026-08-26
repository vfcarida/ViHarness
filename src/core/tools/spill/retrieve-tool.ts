// Pattern: Tool Output Retrieval Tool (ref: DeepSeek Harness)
/**
 * Retrieve Output Tool.
 *
 * Allows the agent model to selectively inspect line ranges from spilled tool outputs.
 */
import type { ToolDefinition, ToolResult } from '../../model/tool-types.js';
import { ToolCategory, ToolRiskLevel } from '../../model/tool-types.js';
import type { ToolCallId } from '../../types/identifiers.js';
import { type SpillStore, defaultSpillStore } from './spill-store.js';

export interface RetrieveOutputParams {
  readonly locator_id: string;
  readonly start_line: number;
  readonly end_line: number;
}

const inputSchema = {
  type: 'object',
  properties: {
    locator_id: {
      type: 'string',
      description:
        'The unique locator identifier returned when output was spilled (e.g. spill-session-1-call-1)',
    },
    start_line: {
      type: 'integer',
      description: 'The 1-indexed starting line number to retrieve',
      minimum: 1,
    },
    end_line: {
      type: 'integer',
      description: 'The 1-indexed ending line number to retrieve',
      minimum: 1,
    },
  },
  required: ['locator_id', 'start_line', 'end_line'],
};

export function createRetrieveOutputTool(
  spillStore: SpillStore = defaultSpillStore,
): ToolDefinition {
  return {
    name: 'retrieve_output',
    version: '1.0.0',
    description: 'Retrieve specific line ranges from previously spilled tool outputs',
    category: ToolCategory.READ,
    riskLevel: ToolRiskLevel.LOW,
    mutating: false,
    idempotent: true,
    defaultTimeoutMs: 5000,
    requiredPermissions: [],
    inputSchema,
    parameters: inputSchema,
    isConcurrencySafe: () => true,
    timeoutMs: 5000,
    execute: async (args: Record<string, unknown>, context?: any): Promise<ToolResult> => {
      const start = Date.now();
      const callId = (context?.callId || context?.correlationId || 'retrieve-0') as ToolCallId;
      const locatorId = String(args.locator_id || '');
      const startLine = Math.max(1, Number(args.start_line || 1));
      const endLine = Math.max(startLine, Number(args.end_line || startLine));

      try {
        const fullContent = spillStore.retrieve(locatorId);
        const lines = fullContent.split('\n');

        const totalLines = lines.length;
        const clampedStart = Math.min(startLine, totalLines);
        const clampedEnd = Math.min(endLine, totalLines);

        const sliced = lines.slice(clampedStart - 1, clampedEnd);

        return {
          toolCallId: callId,
          name: 'retrieve_output',
          success: true,
          output: [
            `--- Retrieved lines ${clampedStart}-${clampedEnd} of ${totalLines} from [${locatorId}] ---`,
            sliced.join('\n'),
          ].join('\n'),
          durationMs: Date.now() - start,
        };
      } catch (err: any) {
        return {
          toolCallId: callId,
          name: 'retrieve_output',
          success: false,
          output: `Failed to retrieve output: ${err.message}`,
          durationMs: Date.now() - start,
        };
      }
    },
  };
}

export const retrieveOutputTool = createRetrieveOutputTool();
