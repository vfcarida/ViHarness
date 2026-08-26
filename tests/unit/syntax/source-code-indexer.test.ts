/**
 * Source Code Indexer & Symbol Map Unit Tests.
 *
 * Tests:
 * 1. Multi-language symbol parsing (TypeScript, Python, Go).
 * 2. Repository-wide symbol map generation and compact rendering.
 * 3. Dynamic Context Manager (/drop, /add, /focus) and non-dropping invariant guarantees.
 */
import { describe, it, expect } from 'vitest';
import { SourceCodeIndexer, DynamicContextManager } from '../../../src/infra/index.js';
import {
  SymbolKind,
  ContextObjectType,
  ContextTier,
  ContextScope,
  type ContextObject,
} from '../../../src/core/index.js';

describe('Source Code Indexer & Symbol Map Suite (Prompt 5)', () => {
  describe('1. TypeScript / JavaScript Parsing', () => {
    it('should extract classes, interfaces, types, enums, functions, and class methods', () => {
      const tsCode = `
import { Router } from './router.js';
import type { Goal } from './goal.js';

export interface CodeBlock {
  language: string;
  code: string;
}

export type SymbolName = string | number;

export enum Status {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
}

export class TaskExecutor {
  public async executeTask(goal: Goal): Promise<boolean> {
    return true;
  }

  private validate(data: unknown): void {}
}

export async function computeScore(x: number, y: number): Promise<number> {
  return x + y;
}
`;

      const fileMap = SourceCodeIndexer.parseFile('src/task-executor.ts', tsCode);
      expect(fileMap.language).toBe('typescript');
      expect(fileMap.imports).toHaveLength(2);
      expect(fileMap.exports).toContain('CodeBlock');
      expect(fileMap.exports).toContain('SymbolName');
      expect(fileMap.exports).toContain('Status');
      expect(fileMap.exports).toContain('TaskExecutor');
      expect(fileMap.exports).toContain('computeScore');

      const symbols = fileMap.symbols;
      expect(
        symbols.find((s) => s.name === 'CodeBlock' && s.kind === SymbolKind.INTERFACE),
      ).toBeDefined();
      expect(
        symbols.find((s) => s.name === 'SymbolName' && s.kind === SymbolKind.TYPE_ALIAS),
      ).toBeDefined();
      expect(symbols.find((s) => s.name === 'Status' && s.kind === SymbolKind.ENUM)).toBeDefined();
      expect(
        symbols.find((s) => s.name === 'TaskExecutor' && s.kind === SymbolKind.CLASS),
      ).toBeDefined();
      expect(
        symbols.find((s) => s.name === 'executeTask' && s.kind === SymbolKind.METHOD),
      ).toBeDefined();
      expect(
        symbols.find((s) => s.name === 'computeScore' && s.kind === SymbolKind.FUNCTION),
      ).toBeDefined();

      expect(fileMap.outline).toContain('interface CodeBlock');
      expect(fileMap.outline).toContain('class TaskExecutor');
      expect(fileMap.outline).toContain('executeTask');
    });
  });

  describe('2. Python & Go Parsing', () => {
    it('should extract Python classes, functions, and methods', () => {
      const pyCode = `
import os
from typing import List

class AgentRuntime:
    def __init__(self, name: str):
        self.name = name

    def run(self, task: str) -> bool:
        return True

def standalone_helper(x: int) -> int:
    return x * 2
`;

      const fileMap = SourceCodeIndexer.parseFile('backend/runtime.py', pyCode);
      expect(fileMap.language).toBe('python');
      expect(
        fileMap.symbols.find((s) => s.name === 'AgentRuntime' && s.kind === SymbolKind.CLASS),
      ).toBeDefined();
      expect(
        fileMap.symbols.find((s) => s.name === 'run' && s.kind === SymbolKind.METHOD),
      ).toBeDefined();
      expect(
        fileMap.symbols.find(
          (s) => s.name === 'standalone_helper' && s.kind === SymbolKind.FUNCTION,
        ),
      ).toBeDefined();
    });

    it('should extract Go structs, methods, and functions', () => {
      const goCode = `
package main

import "fmt"

type ServerConfig struct {
    Port int
}

func (s *ServerConfig) Start() error {
    return nil
}

func MainHandler(w int) {
}
`;

      const fileMap = SourceCodeIndexer.parseFile('cmd/server.go', goCode);
      expect(fileMap.language).toBe('go');
      expect(
        fileMap.symbols.find((s) => s.name === 'ServerConfig' && s.kind === SymbolKind.CLASS),
      ).toBeDefined();
      expect(
        fileMap.symbols.find((s) => s.name === 'Start' && s.kind === SymbolKind.METHOD),
      ).toBeDefined();
      expect(
        fileMap.symbols.find((s) => s.name === 'MainHandler' && s.kind === SymbolKind.FUNCTION),
      ).toBeDefined();
    });
  });

  describe('3. Repository-Wide Symbol Map & Compact Rendering', () => {
    it('should build a repository map and render within token constraints', () => {
      const files = new Map<string, string>([
        ['src/auth/service.ts', 'export class AuthService { login(): void {} }'],
        ['src/auth/jwt.ts', 'export function verifyToken(t: string): boolean { return true; }'],
        ['src/db/client.ts', 'export class DatabaseClient { connect(): void {} }'],
      ]);

      const repoMap = SourceCodeIndexer.buildRepoMap(files);
      expect(repoMap.totalFiles).toBe(3);
      expect(repoMap.totalSymbols).toBe(3);

      const rendered = SourceCodeIndexer.renderRepoMap(repoMap, {
        maxTokens: 500,
        focusFiles: ['src/auth/service.ts'],
      });

      expect(rendered).toContain('File: src/auth/service.ts');
      expect(rendered).toContain('AuthService');
      expect(rendered).toContain('File: src/auth/jwt.ts');
      expect(rendered).toContain('verifyToken');
    });
  });

  describe('4. Dynamic Context Manager & Slash Commands', () => {
    it('should handle /drop, /add, /focus and filter out dropped files while preserving invariants', () => {
      const manager = new DynamicContextManager(['src/app.ts', 'src/large-logs.ts']);

      expect(manager.getState().activeFiles.has('src/app.ts')).toBe(true);
      expect(manager.getState().activeFiles.has('src/large-logs.ts')).toBe(true);

      // 1. Drop a file
      manager.parseCommand('/drop src/large-logs.ts');
      expect(manager.getState().droppedFiles.has('src/large-logs.ts')).toBe(true);
      expect(manager.getState().activeFiles.has('src/large-logs.ts')).toBe(false);

      // 2. Filter context objects
      const now = new Date();
      const mockObjects: ContextObject[] = [
        {
          id: 'ctx-1' as any,
          tier: ContextTier.L2_PROJECT,
          type: ContextObjectType.FILE,
          content: 'HUGE RAW LOGS...',
          source: 'file',
          timestamp: now,
          importance: 0.5,
          confidence: 1.0,
          scope: ContextScope.GLOBAL,
          dependencies: [],
          lastUsed: now,
          lastVerified: now,
          costTokens: 10000,
          tags: ['file'],
          version: 1,
          active: true,
          metadata: { filePath: 'src/large-logs.ts' },
        },
        {
          id: 'ctx-2' as any,
          tier: ContextTier.L3_REPOSITORY,
          type: ContextObjectType.DECISION,
          content: 'CRITICAL INVARIANT: Never bypass security policy.',
          source: 'user',
          timestamp: now,
          importance: 1.0,
          confidence: 1.0,
          scope: ContextScope.GLOBAL,
          dependencies: [],
          lastUsed: now,
          lastVerified: now,
          costTokens: 20,
          tags: ['must_preserve', 'decision'],
          version: 1,
          active: true,
          metadata: {},
        },
        {
          id: 'ctx-3' as any,
          tier: ContextTier.L2_PROJECT,
          type: ContextObjectType.FILE,
          content: 'export function app() {}',
          source: 'file',
          timestamp: now,
          importance: 0.8,
          confidence: 1.0,
          scope: ContextScope.GLOBAL,
          dependencies: [],
          lastUsed: now,
          lastVerified: now,
          costTokens: 50,
          tags: ['file'],
          version: 1,
          active: true,
          metadata: { filePath: 'src/app.ts' },
        },
      ];

      const filtered = manager.filterContextObjects(mockObjects);
      expect(filtered).toHaveLength(2);
      expect(filtered.find((o) => o.id === 'ctx-1')).toBeUndefined(); // Dropped file was removed
      expect(filtered.find((o) => o.id === 'ctx-2')).toBeDefined(); // Critical invariant preserved!
      expect(filtered.find((o) => o.id === 'ctx-3')).toBeDefined(); // Active file preserved!

      // 3. Re-add dropped file
      manager.parseCommand('/add src/large-logs.ts');
      expect(manager.getState().droppedFiles.has('src/large-logs.ts')).toBe(false);
      expect(manager.getState().activeFiles.has('src/large-logs.ts')).toBe(true);

      const reFiltered = manager.filterContextObjects(mockObjects);
      expect(reFiltered).toHaveLength(3);
    });
  });

  describe('5. PageRank Graph Ranking & Dynamic Token Budget (P003)', () => {
    it('should build a cross-file reference graph and compute PageRank symbol importance scores', () => {
      const files = new Map<string, string>();

      // File A: Core database pool (referenced heavily by B, C, D)
      files.set(
        'src/db/pool.ts',
        `
export interface PoolConfig {
  maxConnections: number;
}

export class DatabasePool {
  public acquire(): Connection { return new Connection(); }
  public release(conn: Connection): void {}
}
`,
      );

      // File B: User service (references DatabasePool)
      files.set(
        'src/services/user-service.ts',
        `
import { DatabasePool } from '../db/pool.js';

export class UserService {
  constructor(private pool: DatabasePool) {}
  public getUser(id: string) {
    const conn = this.pool.acquire();
    return { id };
  }
}
`,
      );

      // File C: Order service (references DatabasePool and UserService)
      files.set(
        'src/services/order-service.ts',
        `
import { DatabasePool } from '../db/pool.js';
import { UserService } from './user-service.js';

export class OrderService {
  constructor(private pool: DatabasePool, private userService: UserService) {}
  public createOrder() {
    const conn = this.pool.acquire();
  }
}
`,
      );

      // File D: Isolated utility (not referenced anywhere)
      files.set(
        'src/utils/math.ts',
        `
export function calculateFibonacci(n: number): number {
  return n <= 1 ? n : calculateFibonacci(n - 1) + calculateFibonacci(n - 2);
}
`,
      );

      const repoMap = SourceCodeIndexer.buildRepoMap(files);

      // 1. Verify Reference Graph structure
      expect(repoMap.referenceGraph).toBeDefined();
      const graph = repoMap.referenceGraph!;
      expect(graph.nodes.size).toBe(4);
      expect(graph.edges.length).toBeGreaterThanOrEqual(3);

      // Edges pointing to DatabasePool from user-service and order-service
      const poolEdges = graph.edges.filter((e) => e.symbolName === 'DatabasePool');
      expect(poolEdges.length).toBe(2);

      // 2. Verify PageRank symbol scoring
      expect(repoMap.symbolRanks).toBeDefined();
      const ranks = repoMap.symbolRanks!;

      const poolScore = ranks.get('DatabasePool') ?? 0;
      const userServiceScore = ranks.get('UserService') ?? 0;
      const mathScore = ranks.get('calculateFibonacci') ?? 0;

      // DatabasePool is referenced the most -> highest rank
      expect(poolScore).toBeGreaterThan(userServiceScore);
      // UserService is referenced by OrderService -> higher rank than isolated math utility
      expect(userServiceScore).toBeGreaterThan(mathScore);
      // Math utility has non-zero base rank, but lowest in the codebase
      expect(mathScore).toBeGreaterThan(0);
    });

    it('should render compressed Aider-format repo map prioritizing top-ranked symbols within token budget', () => {
      const files = new Map<string, string>();

      files.set(
        'src/core/engine.ts',
        `
export class ExecutionEngine {
  public start(): void {}
  public step(): void {}
  public stop(): void {}
}
`,
      );

      files.set(
        'src/app.ts',
        `
import { ExecutionEngine } from './core/engine.js';

export class Application {
  constructor(private engine: ExecutionEngine) {}
  public run() { this.engine.start(); }
}
`,
      );

      const repoMap = SourceCodeIndexer.buildRepoMap(files);
      const rendered = SourceCodeIndexer.renderRepoMap(repoMap, {
        maxTokens: 500,
        rankedSymbolsOnly: true,
      });

      expect(rendered).toContain('ExecutionEngine');
      expect(rendered).toContain('Application');
      expect(rendered).toContain('File: src/core/engine.ts');
    });

    it('should dynamically scale repo map token budget between 40% (no active files) and 10% (active files)', async () => {
      const { DefaultContextCompiler } =
        await import('../../../src/infra/compiler/default-context-compiler.js');
      const { SystemClock } = await import('../../../src/infra/time/system-clock.js');
      const { UuidV7IdFactory } = await import('../../../src/infra/id/uuid-id-factory.js');
      const { ModelCapability } = await import('../../../src/core/model/model-io.js');
      const { TaskStatus } = await import('../../../src/core/model/task.js');

      const idFactory = new UuidV7IdFactory();
      const clock = new SystemClock();
      const compiler = new DefaultContextCompiler({ idFactory, clock });

      const files = new Map<string, string>();
      for (let i = 1; i <= 50; i++) {
        files.set(
          `src/module_${i}.ts`,
          `
import { Helper } from './helper.js';
export class ServiceModule${i} {
  public execute(): void {}
  public validate(data: unknown): boolean { return true; }
  public transform(data: unknown): unknown { return data; }
}
`,
        );
      }
      const repoMap = SourceCodeIndexer.buildRepoMap(files);

      const targetModelDescriptor = {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        capabilities: {
          capabilities: [ModelCapability.CHAT],
          maxContextTokens: 128000,
          maxOutputTokens: 4096,
          supportsToolCalling: true,
          supportsStreaming: true,
          supportsStructuredOutput: true,
          supportsVision: true,
        },
      };

      const baseRequest = {
        goal: {
          id: idFactory.create<'Goal'>(),
          description: 'Refactor services',
          status: 'ACTIVE' as any,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        task: {
          id: idFactory.create<'Task'>(),
          goalId: idFactory.create<'Goal'>(),
          description: 'Refactor',
          status: TaskStatus.IN_PROGRESS,
          priority: 1,
          dependencies: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        currentState: 'IMPLEMENTING' as any,
        targetModelDescriptor,
        budget: {
          maxTokens: 4000,
          softLimitTokens: 3500,
          hardLimitTokens: 4000,
          maxOutputTokens: 1000,
        },
        repoSymbolMap: repoMap,
      };

      // Case A: 0 active files in context -> expands up to 40% of 4000 = 1600 tokens
      const resultNoFiles = await compiler.compile({
        ...baseRequest,
        currentFiles: [],
      });

      const repoMapEntryNoFiles = resultNoFiles.retainedObjects.find((o) =>
        o.tags.includes('repo_map'),
      );
      expect(repoMapEntryNoFiles).toBeDefined();
      const tokensNoFiles = repoMapEntryNoFiles!.costTokens;

      // Case B: Active files in context -> contracts to 10% of 4000 = 400 tokens
      const resultWithFiles = await compiler.compile({
        ...baseRequest,
        currentFiles: ['src/module_1.ts', 'src/module_2.ts'],
      });

      const repoMapEntryWithFiles = resultWithFiles.retainedObjects.find((o) =>
        o.tags.includes('repo_map'),
      );
      expect(repoMapEntryWithFiles).toBeDefined();
      const tokensWithFiles = repoMapEntryWithFiles!.costTokens;

      // The budget contracts when files are being actively edited
      expect(tokensNoFiles).toBeGreaterThan(tokensWithFiles);
      expect(tokensWithFiles).toBeLessThanOrEqual(400);
    });
  });
});
