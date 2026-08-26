/**
 * Model Context Protocol (MCP) Client Adapter.
 *
 * Connects Vi-Harness to external MCP servers (e.g. Postgres MCP, GitHub MCP, Slack MCP),
 * translates MCP tool definitions into Vi-Harness Tool contracts, and integrates them into ToolRegistry.
 */
import type { Tool } from '../../core/interfaces/tool.js';
import type { ToolRegistry } from '../../core/interfaces/tool-registry.js';
import type { IdFactory } from '../../core/types/identifiers.js';
import { ToolCategory, ToolRiskLevel } from '../../core/model/tool-types.js';
import type { ToolInput, ToolResult, ToolExecutionContext } from '../../core/model/tool-types.js';
import type {
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpToolDefinition,
  McpCallToolResult,
} from './mcp-types.js';

export interface McpTransport {
  send(request: McpJsonRpcRequest): Promise<McpJsonRpcResponse>;
}

export interface McpClientAdapterOptions {
  readonly serverName: string;
  readonly transport: McpTransport;
  readonly toolRegistry: ToolRegistry;
  readonly idFactory: IdFactory;
}

export class McpClientAdapter {
  readonly serverName: string;
  private readonly transport: McpTransport;
  private readonly toolRegistry: ToolRegistry;
  private readonly idFactory: IdFactory;
  private requestIdCounter = 1;

  constructor(options: McpClientAdapterOptions) {
    this.serverName = options.serverName;
    this.transport = options.transport;
    this.toolRegistry = options.toolRegistry;
    this.idFactory = options.idFactory;
  }

  /**
   * Initialize connection, query remote MCP tools, and register them in Vi-Harness.
   */
  async syncTools(): Promise<ReadonlyArray<string>> {
    // 1. Initialize MCP connection
    const initResponse = await this.transport.send({
      jsonrpc: '2.0',
      id: this.requestIdCounter++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { roots: { listChanged: false } },
        clientInfo: { name: 'vi-harness-mcp-client', version: '0.1.0' },
      },
    });

    if (initResponse.error) {
      throw new Error(
        `MCP initialization failed for [${this.serverName}]: ${initResponse.error.message}`,
      );
    }

    // 2. Query available tools
    const listResponse = await this.transport.send({
      jsonrpc: '2.0',
      id: this.requestIdCounter++,
      method: 'tools/list',
    });

    if (listResponse.error) {
      throw new Error(
        `Failed to list tools from MCP server [${this.serverName}]: ${listResponse.error.message}`,
      );
    }

    const mcpTools = ((listResponse.result as { tools?: McpToolDefinition[] })?.tools ??
      []) as McpToolDefinition[];
    const registeredNames: string[] = [];

    for (const mcpTool of mcpTools) {
      const toolInstance = this.createToolProxy(mcpTool);
      this.toolRegistry.register(toolInstance);
      registeredNames.push(toolInstance.definition.name);
    }

    return registeredNames;
  }

  private createToolProxy(def: McpToolDefinition): Tool {
    const prefixedName = `mcp_${this.serverName}_${def.name}`;
    const idFactory = this.idFactory;
    const transport = this.transport;
    const originalToolName = def.name;

    return {
      definition: {
        name: prefixedName,
        version: '1.0.0',
        description: `[MCP: ${this.serverName}] ${def.description ?? 'External MCP Tool'}`,
        category: ToolCategory.EXECUTE,
        riskLevel: ToolRiskLevel.LOW,
        mutating: true,
        idempotent: false,
        defaultTimeoutMs: 30000,
        requiredPermissions: [],
        inputSchema: def.inputSchema as Record<string, unknown>,
      },
      async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolResult> {
        const startTime = Date.now();
        const callId = (context.correlationId ?? idFactory.create<'Action'>()) as any;
        try {
          const callResponse = await transport.send({
            jsonrpc: '2.0',
            id: callId,
            method: 'tools/call',
            params: {
              name: originalToolName,
              arguments: input as Record<string, unknown>,
            },
          });

          if (callResponse.error) {
            return {
              toolCallId: callId,
              name: prefixedName,
              output: `External MCP tool error: ${callResponse.error.message}`,
              success: false,
              durationMs: Date.now() - startTime,
              error: callResponse.error.message,
            };
          }

          const callResult = callResponse.result as McpCallToolResult | undefined;
          if (callResult?.isError) {
            const errorText = callResult.content.map((c) => c.text ?? '').join('\n');
            return {
              toolCallId: callId,
              name: prefixedName,
              output: errorText,
              success: false,
              durationMs: Date.now() - startTime,
              error: errorText,
            };
          }

          const textOutput = callResult?.content?.map((c) => c.text ?? '').join('\n') ?? 'SUCCESS';
          return {
            toolCallId: callId,
            name: prefixedName,
            output: textOutput,
            success: true,
            durationMs: Date.now() - startTime,
          };
        } catch (err: any) {
          return {
            toolCallId: callId,
            name: prefixedName,
            output: `Execution exception: ${err?.message ?? String(err)}`,
            success: false,
            durationMs: Date.now() - startTime,
            error: err?.message ?? String(err),
          };
        }
      },
    };
  }
}
