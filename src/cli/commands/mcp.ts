#!/usr/bin/env node
/**
 * MCP Server CLI Command.
 *
 * Usage:
 *   vi-harness --mcp stdio
 *   vi-harness --mcp http --port 3100
 *   npx tsx src/cli/commands/mcp.ts [options]
 */
import { McpServer } from '../../infra/mcp/mcp-server.js';
import { StdioTransport } from '../../infra/mcp/transports/stdio-transport.js';
import { HttpTransport } from '../../infra/mcp/transports/http-transport.js';
import { DefaultToolRegistry } from '../../infra/tools/default-tool-registry.js';
import { DefaultToolExecutor } from '../../infra/tools/default-tool-executor.js';
import { WriteFileTool } from '../../infra/tools/builtin/write-file-tool.js';
import { ReadFileTool } from '../../infra/tools/builtin/read-file-tool.js';
import { ListDirectoryTool } from '../../infra/tools/builtin/list-directory-tool.js';
import { RunCommandTool } from '../../infra/tools/builtin/run-command-tool.js';
import { UuidV7IdFactory } from '../../infra/id/uuid-id-factory.js';

export interface McpCliArgs {
  transport: 'stdio' | 'http';
  port: number;
  host: string;
  apiKey?: string;
  help: boolean;
}

export function parseMcpArgs(args: string[]): McpCliArgs {
  const result: McpCliArgs = {
    transport: 'stdio',
    port: 3100,
    host: '127.0.0.1',
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--mcp' && i + 1 < args.length) {
      result.transport = args[++i]! as 'stdio' | 'http';
    } else if (arg === 'stdio' || arg === 'http') {
      result.transport = arg;
    } else if ((arg === '--port' || arg === '-p') && i + 1 < args.length) {
      result.port = parseInt(args[++i]!, 10) || 3100;
    } else if (arg === '--host' && i + 1 < args.length) {
      result.host = args[++i]!;
    } else if (arg === '--api-key' && i + 1 < args.length) {
      result.apiKey = args[++i]!;
    }
  }

  return result;
}

export async function runMcpCli(rawArgs: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseMcpArgs(rawArgs);

  if (args.help) {
    console.log(`
======================================================================
         Vi-Harness Model Context Protocol (MCP) Server CLI
======================================================================

Usage:
  vi-harness --mcp stdio
  vi-harness --mcp http --port 3100 [--api-key <key>]
`);
    return;
  }

  const idFactory = new UuidV7IdFactory();

  // Setup Tool Registry with standard builtin tools
  const toolRegistry = new DefaultToolRegistry();
  toolRegistry.register(new WriteFileTool(idFactory));
  toolRegistry.register(new ReadFileTool(idFactory));
  toolRegistry.register(new ListDirectoryTool(idFactory));
  toolRegistry.register(new RunCommandTool(idFactory));

  const toolExecutor = new DefaultToolExecutor({
    registry: toolRegistry,
    idFactory,
  });

  const server = new McpServer({
    serverName: 'vi-harness-mcp-server',
    serverVersion: '1.0.0',
    toolRegistry,
    toolExecutor,
  });

  if (args.transport === 'http') {
    const transport = new HttpTransport({
      port: args.port,
      host: args.host,
      apiKey: args.apiKey,
    });
    await server.listen(transport);
    console.error(
      `[MCP] Server listening on HTTP http://${args.host}:${args.port}/rpc (SSE: /sse)`,
    );
  } else {
    const transport = new StdioTransport();
    await server.listen(transport);
    console.error('[MCP] Server listening on stdio (line-delimited JSON-RPC 2.0)');
  }
}

if (process.argv[1]?.endsWith('mcp.ts') || process.argv[1]?.endsWith('mcp.js')) {
  runMcpCli().catch((err) => {
    console.error('[ERROR] MCP Server failed:', err);
    process.exit(1);
  });
}
