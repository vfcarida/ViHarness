/**
 * IDE-Grade Semantic Navigation Tools (LSP / AST Symbol Indexer).
 *
 * Provides high-precision code navigation without grep hallucination:
 * - find_definitions: Pinpoint symbol declarations across classes, functions, types, and interfaces
 * - find_references: Locate all symbol usages, calls, and imports with line numbers and context
 * - get_outline: Extract structural AST outline of a file without consuming large token budgets
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Tool } from '../../core/interfaces/tool.js';
import type {
  ToolInput,
  ToolResult,
  ToolDefinition,
  ToolExecutionContext,
} from '../../core/model/tool-types.js';
import { ToolCategory, ToolRiskLevel } from '../../core/model/tool-types.js';
import type { IdFactory, ToolCallId } from '../../core/types/identifiers.js';
import { SourceCodeIndexer } from '../syntax/source-code-indexer.js';
import { UuidV7IdFactory } from '../id/uuid-id-factory.js';

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
]);

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.cache',
  'coverage',
  'target',
  'vendor',
]);

function scanSourceFiles(dir: string, maxFiles = 2000): string[] {
  const results: string[] = [];

  const walk = (currentDir: string): void => {
    if (results.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) break;

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(path.join(currentDir, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SOURCE_EXTENSIONS.has(ext)) {
          results.push(path.join(currentDir, entry.name));
        }
      }
    }
  };

  walk(dir);
  return results;
}

export class FindDefinitionsTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'find_definitions',
    version: '1.0.0',
    description:
      'Locates the exact declaration (file path, line number, kind, and signature) of a symbol (class, function, interface, type, or method) across the workspace.',
    category: ToolCategory.READ,
    riskLevel: ToolRiskLevel.LOW,
    mutating: false,
    idempotent: true,
    defaultTimeoutMs: 15000,
    requiredPermissions: ['fs:read'],
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'The exact name of the symbol to find definition for (e.g. TddEnforcer, calculateTotal, Goal).',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of definitions to return (default: 10).',
        },
      },
      required: ['symbol'],
    },
  };

  constructor(
    private readonly workspacePath: string,
    private readonly idFactory: IdFactory = new UuidV7IdFactory(),
  ) {}

  async execute(input: ToolInput, _context: ToolExecutionContext): Promise<ToolResult> {
    const symbol = String(input['symbol'] ?? '').trim();
    const maxResults = Number(input['maxResults'] ?? 10);
    const callId: ToolCallId = this.idFactory.create<'ToolCall'>();
    const startTime = Date.now();

    if (!symbol) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: "Parameter 'symbol' is required.",
        durationMs: Date.now() - startTime,
        error: 'INVALID_ARGUMENT',
      };
    }

    const files = scanSourceFiles(this.workspacePath);
    const matches: Array<{
      filePath: string;
      relPath: string;
      kind: string;
      line: number;
      signature: string;
    }> = [];

    for (const file of files) {
      if (matches.length >= maxResults) break;

      try {
        const content = fs.readFileSync(file, 'utf-8');
        // Fast pre-filter
        if (!content.includes(symbol)) continue;

        const map = SourceCodeIndexer.parseFile(file, content);
        for (const s of map.symbols) {
          if (s.name === symbol) {
            matches.push({
              filePath: file,
              relPath: path.relative(this.workspacePath, file).replace(/\\/g, '/'),
              kind: s.kind,
              line: s.startLine,
              signature: s.signature,
            });
            if (matches.length >= maxResults) break;
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    if (matches.length === 0) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: true,
        output: `No definition found for symbol '${symbol}' in workspace.`,
        durationMs: Date.now() - startTime,
        metadata: { symbol, matchCount: 0 },
      };
    }

    const lines = [`Found ${matches.length} definition(s) for '${symbol}':`];
    for (const m of matches) {
      lines.push(`• [${m.kind}] ${m.relPath}:${m.line}`);
      if (m.signature) {
        lines.push(`  ${m.signature.trim()}`);
      }
    }

    return {
      toolCallId: callId,
      name: this.definition.name,
      success: true,
      output: lines.join('\n'),
      durationMs: Date.now() - startTime,
      metadata: { symbol, matchCount: matches.length, matches },
    };
  }
}

export class FindReferencesTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'find_references',
    version: '1.0.0',
    description:
      'Locates all usages, calls, and import references of a symbol across the workspace with line numbers and context snippets.',
    category: ToolCategory.READ,
    riskLevel: ToolRiskLevel.LOW,
    mutating: false,
    idempotent: true,
    defaultTimeoutMs: 15000,
    requiredPermissions: ['fs:read'],
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'The exact name of the symbol to find references for.',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of reference locations to return (default: 20).',
        },
      },
      required: ['symbol'],
    },
  };

  constructor(
    private readonly workspacePath: string,
    private readonly idFactory: IdFactory = new UuidV7IdFactory(),
  ) {}

  async execute(input: ToolInput, _context: ToolExecutionContext): Promise<ToolResult> {
    const symbol = String(input['symbol'] ?? '').trim();
    const maxResults = Number(input['maxResults'] ?? 20);
    const callId: ToolCallId = this.idFactory.create<'ToolCall'>();
    const startTime = Date.now();

    if (!symbol) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: "Parameter 'symbol' is required.",
        durationMs: Date.now() - startTime,
        error: 'INVALID_ARGUMENT',
      };
    }

    const files = scanSourceFiles(this.workspacePath);
    const symbolRegex = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const references: Array<{
      filePath: string;
      relPath: string;
      line: number;
      snippet: string;
    }> = [];

    for (const file of files) {
      if (references.length >= maxResults) break;

      try {
        const content = fs.readFileSync(file, 'utf-8');
        if (!symbolRegex.test(content)) continue;

        const relPath = path.relative(this.workspacePath, file).replace(/\\/g, '/');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          if (symbolRegex.test(line)) {
            references.push({
              filePath: file,
              relPath,
              line: i + 1,
              snippet: line.trim().slice(0, 100),
            });
            if (references.length >= maxResults) break;
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    if (references.length === 0) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: true,
        output: `No references found for symbol '${symbol}' in workspace.`,
        durationMs: Date.now() - startTime,
        metadata: { symbol, matchCount: 0 },
      };
    }

    const outLines = [`Found ${references.length} reference(s) to '${symbol}':`];
    for (const ref of references) {
      outLines.push(`• ${ref.relPath}:${ref.line}`);
      outLines.push(`  ↳ ${ref.snippet}`);
    }

    return {
      toolCallId: callId,
      name: this.definition.name,
      success: true,
      output: outLines.join('\n'),
      durationMs: Date.now() - startTime,
      metadata: { symbol, matchCount: references.length, references },
    };
  }
}

export class GetOutlineTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'get_outline',
    version: '1.0.0',
    description:
      'Extracts a high-level structural outline of classes, methods, functions, and interfaces declared in a file without loading the full file body.',
    category: ToolCategory.READ,
    riskLevel: ToolRiskLevel.LOW,
    mutating: false,
    idempotent: true,
    defaultTimeoutMs: 15000,
    requiredPermissions: ['fs:read'],
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the source file within the workspace.',
        },
      },
      required: ['path'],
    },
  };

  constructor(
    private readonly workspacePath: string,
    private readonly idFactory: IdFactory = new UuidV7IdFactory(),
  ) {}

  async execute(input: ToolInput, _context: ToolExecutionContext): Promise<ToolResult> {
    const rawPath = String(input['path'] ?? '').trim();
    const callId: ToolCallId = this.idFactory.create<'ToolCall'>();
    const startTime = Date.now();

    if (!rawPath) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: "Parameter 'path' is required.",
        durationMs: Date.now() - startTime,
        error: 'INVALID_ARGUMENT',
      };
    }

    const resolved = path.resolve(this.workspacePath, rawPath);
    if (!resolved.startsWith(path.resolve(this.workspacePath))) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: `Access outside workspace is denied: ${rawPath}`,
        durationMs: Date.now() - startTime,
        error: 'POLICY_DENIED',
      };
    }

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: `File not found: ${rawPath}`,
        durationMs: Date.now() - startTime,
        error: 'FILE_NOT_FOUND',
      };
    }

    try {
      const content = fs.readFileSync(resolved, 'utf-8');
      const symbolMap = SourceCodeIndexer.parseFile(resolved, content);
      const relPath = path.relative(this.workspacePath, resolved).replace(/\\/g, '/');

      const outLines = [
        `Outline for ${relPath} (${symbolMap.totalLines} lines, ${symbolMap.symbols.length} symbols):`,
      ];

      for (const s of symbolMap.symbols) {
        const exportedBadge = s.isExported ? 'export ' : '';
        const linesRange = s.startLine === s.endLine ? `line ${s.startLine}` : `lines ${s.startLine}-${s.endLine}`;
        outLines.push(`• [${s.kind}] ${exportedBadge}${s.name} (${linesRange})`);
        if (s.signature && s.signature !== s.name) {
          outLines.push(`  ${s.signature.trim()}`);
        }
      }

      return {
        toolCallId: callId,
        name: this.definition.name,
        success: true,
        output: outLines.join('\n'),
        durationMs: Date.now() - startTime,
        metadata: {
          path: relPath,
          symbolCount: symbolMap.symbols.length,
          totalLines: symbolMap.totalLines,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: `Failed to parse outline for ${rawPath}: ${message}`,
        durationMs: Date.now() - startTime,
        error: 'PARSE_FAILED',
      };
    }
  }
}

export class BatchFindSymbolsTool implements Tool {
  public readonly definition: ToolDefinition = {
    name: 'batch_find_symbols',
    version: '1.0.0',
    description:
      'Locate declarations for multiple symbols in a single turn across the workspace.',
    category: ToolCategory.READ,
    riskLevel: ToolRiskLevel.LOW,
    mutating: false,
    idempotent: true,
    defaultTimeoutMs: 30000,
    requiredPermissions: ['fs:read'],
    inputSchema: {
      type: 'object',
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of symbol names to search for (functions, classes, interfaces, types).',
        },
        max_matches_per_symbol: {
          type: 'number',
          description: 'Maximum matches per symbol to return (default: 5)',
        },
      },
      required: ['symbols'],
    },
  };

  constructor(
    private readonly workspacePath: string,
    private readonly idFactory?: IdFactory,
  ) {}

  async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const callId = (context?.correlationId ?? this.idFactory?.create<'ToolCall'>() ?? 'call-batch-defs') as ToolCallId;
    const rawSymbols = Array.isArray(input['symbols']) ? (input['symbols'] as unknown[]).map(String) : [];
    const maxMatchesPerSymbol = Math.max(1, Math.min(20, Number(input['max_matches_per_symbol']) || 5));

    if (rawSymbols.length === 0) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: 'Parameter "symbols" must be a non-empty array of symbol names.',
        durationMs: Date.now() - startTime,
        error: 'EMPTY_SYMBOLS',
      };
    }

    try {
      const files = scanSourceFiles(this.workspacePath);
      const symbolMap = new Map<string, Array<{ file: string; line: number; kind: string; signature?: string }>>();

      for (const s of rawSymbols) {
        symbolMap.set(s, []);
      }

      for (const filePath of files) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const fileMap = SourceCodeIndexer.parseFile(filePath, content);
          const relPath = path.relative(this.workspacePath, filePath).replace(/\\/g, '/');

          for (const s of fileMap.symbols) {
            if (symbolMap.has(s.name)) {
              const list = symbolMap.get(s.name);
              if (list && list.length < maxMatchesPerSymbol) {
                list.push({
                  file: relPath,
                  line: s.startLine,
                  kind: s.kind,
                  signature: s.signature,
                });
              }
            }
          }
        } catch {
          // ignore unreadable files
        }
      }

      const outLines: string[] = [
        `Batch Symbol Search Results (${rawSymbols.length} symbols searched across ${files.length} files):`,
      ];

      let totalMatches = 0;
      for (const [sym, matches] of symbolMap.entries()) {
        totalMatches += matches.length;
        if (matches.length === 0) {
          outLines.push(`\nSymbol '${sym}': 0 matches found.`);
        } else {
          outLines.push(`\nSymbol '${sym}' (${matches.length} match${matches.length > 1 ? 'es' : ''}):`);
          for (const m of matches) {
            outLines.push(`• [${m.kind}] ${m.file}:${m.line}`);
            if (m.signature) {
              outLines.push(`  ${m.signature.trim()}`);
            }
          }
        }
      }

      return {
        toolCallId: callId,
        name: this.definition.name,
        success: true,
        output: outLines.join('\n'),
        durationMs: Date.now() - startTime,
        metadata: {
          symbolsSearched: rawSymbols.length,
          totalMatches,
          filesScanned: files.length,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: `Batch symbol search failed: ${message}`,
        durationMs: Date.now() - startTime,
        error: 'SEARCH_FAILED',
      };
    }
  }
}

export class SearchCodeTool implements Tool {
  public readonly definition: ToolDefinition = {
    name: 'search_code',
    version: '1.0.0',
    description:
      'High-speed multi-pattern regex code search across workspace files with context-bounded line snippets.',
    category: ToolCategory.READ,
    riskLevel: ToolRiskLevel.LOW,
    mutating: false,
    idempotent: true,
    defaultTimeoutMs: 30000,
    requiredPermissions: ['fs:read'],
    inputSchema: {
      type: 'object',
      properties: {
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: 'One or more text queries or regex patterns to search for.',
        },
        file_pattern: {
          type: 'string',
          description: 'Optional file extension or pattern filter (e.g. ".ts", "*.py", "src/").',
        },
        max_matches: {
          type: 'number',
          description: 'Maximum total matches to return (default: 30)',
        },
        context_lines: {
          type: 'number',
          description: 'Surrounding context lines around matches (default: 1)',
        },
      },
      required: ['queries'],
    },
  };

  constructor(
    private readonly workspacePath: string,
    private readonly idFactory?: IdFactory,
  ) {}

  async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const callId = (context?.correlationId ?? this.idFactory?.create<'ToolCall'>() ?? 'call-search-code') as ToolCallId;
    const rawQueries = Array.isArray(input['queries']) ? (input['queries'] as unknown[]).map(String) : [];
    const filePattern = typeof input['file_pattern'] === 'string' ? input['file_pattern'].trim().toLowerCase() : undefined;
    const maxMatches = Math.max(1, Math.min(100, Number(input['max_matches']) || 30));
    const contextLines = typeof input['context_lines'] === 'number' ? Math.max(0, Math.min(5, input['context_lines'])) : 1;

    if (rawQueries.length === 0) {
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: 'Parameter "queries" must be a non-empty array of query strings.',
        durationMs: Date.now() - startTime,
        error: 'EMPTY_QUERIES',
      };
    }

    try {
      const regexes = rawQueries.map((q) => {
        try {
          return new RegExp(q, 'i');
        } catch {
          const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return new RegExp(escaped, 'i');
        }
      });

      const files = scanSourceFiles(this.workspacePath);
      const filteredFiles = filePattern
        ? files.filter((f) => {
            const rel = path.relative(this.workspacePath, f).replace(/\\/g, '/').toLowerCase();
            return rel.includes(filePattern) || path.extname(f).toLowerCase() === filePattern;
          })
        : files;

      const results: Array<{ file: string; line: number; query: string; snippet: string }> = [];

      for (const filePath of filteredFiles) {
        if (results.length >= maxMatches) break;

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');
          const relPath = path.relative(this.workspacePath, filePath).replace(/\\/g, '/');

          for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            if (results.length >= maxMatches) break;

            const line = lines[lineIdx] ?? '';
            for (let qIdx = 0; qIdx < regexes.length; qIdx++) {
              const reg = regexes[qIdx];
              if (reg && reg.test(line)) {
                const queryStr = rawQueries[qIdx] ?? '';
                const startCtx = Math.max(0, lineIdx - contextLines);
                const endCtx = Math.min(lines.length - 1, lineIdx + contextLines);
                const snippetLines: string[] = [];

                for (let c = startCtx; c <= endCtx; c++) {
                  const prefix = c === lineIdx ? '> ' : '  ';
                  snippetLines.push(`${prefix}${c + 1}: ${lines[c]}`);
                }

                results.push({
                  file: relPath,
                  line: lineIdx + 1,
                  query: queryStr,
                  snippet: snippetLines.join('\n'),
                });
                break;
              }
            }
          }
        } catch {
          // Skip unreadable files
        }
      }

      const outLines = [
        `Code Search Results (${results.length} matches across ${filteredFiles.length} files for ${rawQueries.length} queries):`,
      ];

      for (const m of results) {
        outLines.push(`\nMatch for "${m.query}" in ${m.file}:${m.line}:`);
        outLines.push(m.snippet);
      }

      if (results.length === 0) {
        outLines.push('No matches found for the specified queries.');
      }

      return {
        toolCallId: callId,
        name: this.definition.name,
        success: true,
        output: outLines.join('\n'),
        durationMs: Date.now() - startTime,
        metadata: {
          matchesCount: results.length,
          queriesSearched: rawQueries.length,
          filesScanned: filteredFiles.length,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        toolCallId: callId,
        name: this.definition.name,
        success: false,
        output: `Code search failed: ${message}`,
        durationMs: Date.now() - startTime,
        error: 'SEARCH_FAILED',
      };
    }
  }
}

export function createSemanticNavigationTools(
  workspacePath: string,
  idFactory?: IdFactory,
): Tool[] {
  return [
    new FindDefinitionsTool(workspacePath, idFactory),
    new FindReferencesTool(workspacePath, idFactory),
    new GetOutlineTool(workspacePath, idFactory),
    new BatchFindSymbolsTool(workspacePath, idFactory),
    new SearchCodeTool(workspacePath, idFactory),
  ];
}
