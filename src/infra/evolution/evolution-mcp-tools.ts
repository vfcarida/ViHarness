/**
 * Wave 6.5 — Native MCP Server Tools for the Evolution Plane (`evolution-mcp-tools.ts`).
 *
 * Exposes the Vi-Harness Evolution Plane as first-class Model Context Protocol (MCP)
 * `Tool` instances compatible with `ToolRegistry` and `McpServer` (`tools/list`, `tools/call`):
 * 1. `evolution_synthesize_manifest`: Zero-search `MemoHarness` synthesis from library memories
 * 2. `evolution_inspect_lineage`: Query experience library entries, negative evidence & snapshot hash
 * 3. `evolution_split_and_transfer`: Decompose `TransferableCore` vs `EcosystemMargin` & recombine
 * 4. `evolution_prepare_viforge_handoff`: Package DPO/GRPO/SPIN datasets + signed `ViForgeHandoffManifest`
 * 5. `evolution_ingest_checkpoint`: Ingest an updated `ViForge` model checkpoint $M_{t+1}$
 * 6. `evolution_leaderboard_and_canary`: Inspect Bradley-Terry leaderboard & canary rollout health
 */
import { createId } from '../../core/types/identifiers.js';
import type { Tool } from '../../core/interfaces/tool.js';
import type { ToolRegistry } from '../../core/interfaces/tool-registry.js';
import {
  ToolCategory,
  ToolRiskLevel,
  type ToolExecutionContext,
  type ToolInput,
  type ToolResult,
} from '../../core/model/tool-types.js';
import { EvolutionRpcDispatcher } from './evolution-rpc-dispatcher.js';
import { BradleyTerryHarnessRanker } from './bradley-terry-ranker.js';
import { CanaryDeploymentController } from './canary-deployment-controller.js';
import { HarnessManifestToolkit } from './manifest-toolkit.js';

export interface EvolutionMcpToolsOptions {
  readonly dispatcher?: EvolutionRpcDispatcher;
  readonly ranker?: BradleyTerryHarnessRanker;
  readonly canaryController?: CanaryDeploymentController;
}

function buildTool(params: {
  readonly name: string;
  readonly description: string;
  readonly category: ToolCategory;
  readonly riskLevel: ToolRiskLevel;
  readonly mutating: boolean;
  readonly inputSchema: Record<string, unknown>;
  readonly handler: (input: ToolInput) => Promise<unknown>;
}): Tool {
  return {
    definition: {
      name: params.name,
      version: '1.0.0',
      description: params.description,
      category: params.category,
      riskLevel: params.riskLevel,
      mutating: params.mutating,
      idempotent: !params.mutating,
      defaultTimeoutMs: 30_000,
      requiredPermissions: params.mutating ? ['workspace:write'] : ['workspace:read'],
      inputSchema: params.inputSchema,
    },
    async execute(
      input: ToolInput,
      context: ToolExecutionContext,
    ): Promise<ToolResult> {
      const start = Date.now();
      const toolCallId = createId<'ToolCall'>(
        context?.correlationId ?? `mcp_${params.name}_${start}`,
      );
      try {
        const result = await params.handler(input);
        return {
          toolCallId,
          name: params.name,
          output: JSON.stringify(result, null, 2),
          success: true,
          durationMs: Date.now() - start,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          toolCallId,
          name: params.name,
          output: JSON.stringify({ error: message }),
          success: false,
          durationMs: Date.now() - start,
          error: message,
        };
      }
    },
  };
}

/**
 * Creates the 6 canonical Evolution Plane MCP tools.
 */
export function createEvolutionMcpTools(
  options?: EvolutionMcpToolsOptions,
): ReadonlyArray<Tool> {
  const dispatcher = options?.dispatcher ?? new EvolutionRpcDispatcher();
  const ranker = options?.ranker ?? new BradleyTerryHarnessRanker();
  const canaryController =
    options?.canaryController ??
    new CanaryDeploymentController(
      HarnessManifestToolkit.createCanonicalBaselineManifest(),
    );

  return [
    buildTool({
      name: 'evolution_synthesize_manifest',
      description:
        'Synthesize a task-adapted HarnessManifest in O(1) zero-search mode from verified ExperienceLibrary memories.',
      category: ToolCategory.READ,
      riskLevel: ToolRiskLevel.LOW,
      mutating: false,
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task identifier' },
          prompt: { type: 'string', description: 'Task prompt or objective' },
          domain: { type: 'string', description: 'Target domain (e.g. typescript, python)' },
          language: { type: 'string', description: 'Target programming language' },
          modelFamily: { type: 'string', description: 'Target model family' },
        },
        required: [],
      },
      handler: (input) => dispatcher.handleSynthesizeManifest(input as any),
    }),

    buildTool({
      name: 'evolution_inspect_lineage',
      description:
        'Query the HarnessExperienceLibrary for active/stale entries, negative evidence, and snapshot hash.',
      category: ToolCategory.READ,
      riskLevel: ToolRiskLevel.LOW,
      mutating: false,
      inputSchema: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          language: { type: 'string' },
          modelFamily: { type: 'string' },
          includeNegativeEvidence: { type: 'boolean' },
          includeStale: { type: 'boolean' },
        },
        required: [],
      },
      handler: (input) => dispatcher.handleInspectLineage(input as any),
    }),

    buildTool({
      name: 'evolution_split_and_transfer',
      description:
        'Decompose a HarnessManifest into its TransferableCore and EcosystemMargin and optionally transfer it to a new model family.',
      category: ToolCategory.READ,
      riskLevel: ToolRiskLevel.LOW,
      mutating: false,
      inputSchema: {
        type: 'object',
        properties: {
          targetModelFamily: { type: 'string' },
          targetDomain: { type: 'string' },
          targetLanguage: { type: 'string' },
        },
        required: [],
      },
      handler: (input) => dispatcher.handleSplitAndTransfer(input as any),
    }),

    buildTool({
      name: 'evolution_prepare_viforge_handoff',
      description:
        'Export DPO/GRPO/SPIN preference trajectories and a signed ViForgeHandoffManifest for inner-loop model post-training.',
      category: ToolCategory.WRITE,
      riskLevel: ToolRiskLevel.MEDIUM,
      mutating: true,
      inputSchema: {
        type: 'object',
        properties: {
          outputDir: { type: 'string', description: 'Optional directory to write JSONL files' },
        },
        required: [],
      },
      handler: (input) => dispatcher.handlePrepareViForgeHandoff(input as any),
    }),

    buildTool({
      name: 'evolution_ingest_checkpoint',
      description:
        'Ingest an updated model checkpoint from ViForge, recombine TransferableCore + EcosystemMargin, and mark prior model experiences STALE.',
      category: ToolCategory.WRITE,
      riskLevel: ToolRiskLevel.MEDIUM,
      mutating: true,
      inputSchema: {
        type: 'object',
        properties: {
          previousModelFamily: { type: 'string' },
          newModelFamily: { type: 'string' },
          newModelCheckpointId: { type: 'string' },
          checkpointSha256: { type: 'string' },
        },
        required: ['previousModelFamily', 'newModelFamily', 'newModelCheckpointId'],
      },
      handler: (input) => dispatcher.handleIngestModelCheckpoint(input as any),
    }),

    buildTool({
      name: 'evolution_leaderboard_and_canary',
      description:
        'Inspect the longitudinal Bradley-Terry / Glicko-2 harness rating leaderboard, suggested active-learning matchups, and canary deployment status.',
      category: ToolCategory.READ,
      riskLevel: ToolRiskLevel.LOW,
      mutating: false,
      inputSchema: {
        type: 'object',
        properties: {
          maxSuggestions: { type: 'number' },
        },
        required: [],
      },
      handler: async (input) => ({
        leaderboard: ranker.getLeaderboard(),
        suggestedMatchups: ranker.suggestNextMatchups(
          typeof input['maxSuggestions'] === 'number' ? input['maxSuggestions'] : 3,
        ),
        canaryStatus: canaryController.getSnapshot(),
      }),
    }),
  ];
}

/**
 * Registers all 6 Evolution Plane tools into a `ToolRegistry`.
 */
export function registerEvolutionMcpTools(
  toolRegistry: ToolRegistry,
  options?: EvolutionMcpToolsOptions,
): ReadonlyArray<Tool> {
  const tools = createEvolutionMcpTools(options);
  for (const tool of tools) {
    if (!toolRegistry.getTool(tool.definition.name)) {
      toolRegistry.register(tool);
    }
  }
  return tools;
}
