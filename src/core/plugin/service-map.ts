// Pattern: Declaration-merged extensible Service Map (ref: DeepSeek Harness, Cordis)
/**
 * Declaration-Mergeable Service Map for Vi-Harness Capability Seams.
 *
 * Plugins extend this interface via TypeScript declaration merging:
 * ```typescript
 * declare module 'vi-harness' {
 *   interface ServiceMap {
 *     myCustomService: MyService;
 *   }
 * }
 * ```
 */
import type { ModelRouter } from '../interfaces/model-router.js';
import type { ToolRegistry } from '../interfaces/tool-registry.js';
import type { ToolExecutor } from '../interfaces/tool-executor.js';
import type { PolicyEngine } from '../interfaces/policy-engine.js';
import type { GitManager } from '../interfaces/git-manager.js';
import type { Logger } from '../interfaces/logger.js';
import type { Clock } from '../interfaces/clock.js';
import type { IdFactory } from '../types/identifiers.js';
import type { AgentRuntime } from '../interfaces/agent-runtime.js';
import type { GoalService } from '../goal/goal-service.js';

export interface ShellOpts {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
}

export interface ShellResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface ShellService {
  execute(command: string, opts?: ShellOpts): Promise<ShellResult>;
}

export interface FileSystemService {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  listDirectory(path: string): Promise<string[]>;
}

export interface SandboxService {
  executeIsolated<T>(task: () => Promise<T>): Promise<T>;
  isIsolated(): boolean;
}

export interface AgentRegistry {
  registerAgent(name: string, agent: any): void;
  getAgent(name: string): any | undefined;
  listAgents(): string[];
}

export interface SystemPromptAssembly {
  buildPrompt(context?: Record<string, unknown>): string;
}

export interface PluginStorageService {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface ServiceMap {
  llm: ModelRouter;
  tools: ToolRegistry;
  toolExecutor: ToolExecutor;
  sessions: any;
  compaction: any;
  shell: ShellService;
  fs: FileSystemService;
  sandbox: SandboxService;
  storage: PluginStorageService;
  goals: GoalService;
  experience: any;
  agents: AgentRegistry;
  agentLoop: AgentRuntime;
  systemPrompt: SystemPromptAssembly;
  repoMap: any;
  security: PolicyEngine;
  git: GitManager;
  logger: Logger;
  clock: Clock;
  idFactory: IdFactory;
  metrics: any;
}
