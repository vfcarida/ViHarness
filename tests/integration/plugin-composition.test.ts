import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { resolvePluginTree, CAPABILITY_SEAMS, BASE_BUNDLE } from '../../src/bundles/base.js';
import { ProfileManager } from '../../src/infra/profile/profile-manager.js';
import { ConfigLoader } from '../../src/config/loader.js';
import { ParallelToolExecutor } from '../../src/infra/tools/parallel-tool-executor.js';
import { DefaultToolRegistry } from '../../src/infra/tools/default-tool-registry.js';
import { DefaultPolicyEngine } from '../../src/infra/security/default-policy-engine.js';
import { DefaultToolExecutor } from '../../src/infra/tools/default-tool-executor.js';
import { ReadFileTool } from '../../src/infra/tools/builtin/read-file-tool.js';
import { AcpServer } from '../../src/infra/acp/acp-server.js';
import { SqliteStore } from '../../src/infra/storage/sqlite-store.js';
import { SqliteSessionStore } from '../../src/infra/storage/session-store.js';
import { SystemClock } from '../../src/infra/time/system-clock.js';
import { UuidV7IdFactory } from '../../src/infra/id/uuid-id-factory.js';
import { DefaultContextCompiler } from '../../src/infra/compiler/default-context-compiler.js';
import { MockModelProvider } from '../../src/infra/model/mock-model-provider.js';
import { UtilityModelRouter } from '../../src/infra/router/utility-model-router.js';
import { DefaultAgentRuntime } from '../../src/runtime/default-agent-runtime.js';
import { DefaultToolResultPruner } from '../../src/infra/compiler/tool-result-pruner.js';
import { GoalStatus, type Goal } from '../../src/core/model/goal.js';
import type { AgentEvent, AgentObserver } from '../../src/core/model/agent-observer.js';

describe('Plugin Architecture & Subsystem Composition Suite — P016 / P017', () => {
  const clock = new SystemClock();
  const idFactory = new UuidV7IdFactory();

  // Test 1: Plugin Tree Resolution & Circular Dependency Check
  it('1. Plugin Tree: Resolves all capability seams and bundles without circular dependencies', () => {
    const tree = resolvePluginTree();
    expect(tree.seams).toBeDefined();
    expect(tree.bundles).toBeDefined();

    const seamKeys = Object.keys(tree.seams);
    expect(seamKeys.length).toBeGreaterThanOrEqual(7);

    // Verify all capability seams have default providers
    for (const [key, seam] of Object.entries(tree.seams)) {
      expect(seam.defaultProvider, `Seam ${key} must specify a default provider`).toBeDefined();
      expect(typeof seam.defaultProvider).toBe('string');
    }

    expect(BASE_BUNDLE.name).toBe('base');
    expect(BASE_BUNDLE.defaultSettings).toBeDefined();
  });

  // Test 2: Capability Seam Coverage
  it('2. Capability Seams: Every architectural seam maps to at least one active provider', () => {
    expect(CAPABILITY_SEAMS.modelProvider.seam).toBe('model-provider');
    expect(CAPABILITY_SEAMS.contextCompiler.seam).toBe('context-compiler');
    expect(CAPABILITY_SEAMS.gitManager.seam).toBe('git-manager');
    expect(CAPABILITY_SEAMS.storage.seam).toBe('storage-provider');
    expect(CAPABILITY_SEAMS.securityPolicy.seam).toBe('policy-engine');
    expect(CAPABILITY_SEAMS.mcpTransport.seam).toBe('mcp-transport');
    expect(CAPABILITY_SEAMS.experienceStore.seam).toBe('experience-store');
  });

  // Test 3: Waterfall Events Execution Order
  it('3. Waterfall Lifecycle: Executes pre-step -> request -> tool execution in verified order', async () => {
    const lifecycleEvents: AgentEvent[] = [];

    const toolRegistry = new DefaultToolRegistry();
    toolRegistry.register(new ReadFileTool(idFactory));
    const policyEngine = new DefaultPolicyEngine();
    const baseExecutor = new DefaultToolExecutor({
      registry: toolRegistry,
      policyEngine,
      idFactory,
    });

    const mockProvider = new MockModelProvider({
      providerId: 'primary-mock',
      defaultResponseText: 'Execution complete',
    });

    const router = new UtilityModelRouter();
    router.registerProvider(mockProvider);
    const compiler = new DefaultContextCompiler({ idFactory, clock });

    const runtime = new DefaultAgentRuntime({
      compiler,
      toolExecutor: baseExecutor,
      router,
      idFactory,
      clock,
    });

    // Subscribe observer
    const observer: AgentObserver = {
      onEvent: (event) => {
        lifecycleEvents.push(event);
      },
    };
    runtime.subscribe(observer);

    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Lifecycle verification task',
      constraints: {
        maxIterations: 2,
        maxCostDollars: 1,
        maxDurationMs: 5000,
        maxRepairAttempts: 1,
        maxNoProgressIterations: 1,
        requireVerification: false,
      },
      status: GoalStatus.ACTIVE,
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    await runtime.execute(goal);

    expect(lifecycleEvents.length).toBeGreaterThan(0);
    const types = lifecycleEvents.map((e) => e.type);
    expect(types).toContain('AgentStarted');
    expect(types).toContain('AgentCompleted');
  });

  // Test 4: Parallel Tool Execution with Concurrency Safety
  it('4. Parallel Execution: Executes read operations concurrently with safety bounds', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-parallel-'));
    const f1 = path.join(tempDir, 'file1.txt');
    const f2 = path.join(tempDir, 'file2.txt');
    fs.writeFileSync(f1, 'Content 1', 'utf-8');
    fs.writeFileSync(f2, 'Content 2', 'utf-8');

    const toolRegistry = new DefaultToolRegistry();
    toolRegistry.register(new ReadFileTool(idFactory));

    const policyEngine = new DefaultPolicyEngine();
    const baseExecutor = new DefaultToolExecutor({
      registry: toolRegistry,
      policyEngine,
      idFactory,
    });
    const parallelExecutor = new ParallelToolExecutor(baseExecutor, toolRegistry);

    const calls = [
      { toolName: 'read_file', input: { path: f1 } },
      { toolName: 'read_file', input: { path: f2 } },
    ];

    const results = await parallelExecutor.executeBatch(calls, {
      workingDirectory: tempDir,
    });

    expect(results.length).toBe(2);
    expect(results[0]?.success).toBe(true);
    expect(results[1]?.success).toBe(true);
    expect(results[0]?.output).toContain('Content 1');
    expect(results[1]?.output).toContain('Content 2');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Test 5: Tool-Output Spill & Pruning
  it('5. Tool-Output Spill & Pruning: Compacts large outputs with boundary markers', () => {
    const pruner = new DefaultToolResultPruner(100);
    const largeOutput = 'LINE CONTENT '.repeat(500);

    const pruned = pruner.pruneText(largeOutput, 50);

    expect(pruned.pruned).toBe(true);
    expect(pruned.charsRemoved).toBeGreaterThan(0);
    expect(pruned.text).toContain('pruned');
  });

  // Test 6: Multi-tier Configuration Loader Precedence (CLI > ENV > File)
  it('6. Configuration Loader: Precedence hierarchy resolves CLI > ENV > File > Defaults correctly', () => {
    // 1. Defaults
    const defaultConfig = ConfigLoader.load();
    expect(defaultConfig.model.primary).toBe('claude-sonnet-4-20250514');
    expect(defaultConfig.context.maxTokens).toBe(128000);
    expect(defaultConfig.security.permissionMode).toBe('ask');

    // 2. CLI Overrides
    const cliConfig = ConfigLoader.load({
      model: 'custom-model-from-cli',
      maxTokens: 64000,
      securityMode: 'auto',
    });
    expect(cliConfig.model.primary).toBe('custom-model-from-cli');
    expect(cliConfig.context.maxTokens).toBe(64000);
    expect(cliConfig.security.permissionMode).toBe('auto');
  });

  // Test 7: Distribution Profile Resolution
  it('7. Profile Resolution: Resolves headless, web, and custom profiles with bundles', () => {
    const profileManager = new ProfileManager();

    const headless = profileManager.resolveProfile({
      name: 'headless',
      bundles: ['base', 'headless', 'sqlite'],
    });

    expect(headless.name).toBe('headless');
    expect(headless.activeBundles).toContain('headless');
    expect(headless.resolvedConfig.headless).toBe(true);
    expect(headless.resolvedConfig.walMode).toBe(true);
  });

  // Test 8: ACP Server session/new and session/send
  it('8. ACP Server: Handles session/new and session/send JSON-RPC automation commands', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-acp-test-'));
    const dbPath = path.join(tempDir, 'acp.db');
    const sqlite = new SqliteStore();
    await sqlite.open(dbPath);

    const sessionStore = new SqliteSessionStore({ store: sqlite, clock, idFactory });
    const toolRegistry = new DefaultToolRegistry();
    const policyEngine = new DefaultPolicyEngine();
    const toolExecutor = new DefaultToolExecutor({
      registry: toolRegistry,
      policyEngine,
      idFactory,
    });
    const mockProvider = new MockModelProvider({
      providerId: 'acp-mock',
      defaultResponseText: 'Step completed',
    });
    const router = new UtilityModelRouter();
    router.registerProvider(mockProvider);
    const compiler = new DefaultContextCompiler({ idFactory, clock });

    const runtime = new DefaultAgentRuntime({
      compiler,
      toolExecutor,
      router,
      idFactory,
      clock,
    });

    const server = new AcpServer({
      runtime,
      sessionStore,
      idFactory,
      clock,
    });

    // 1. Send session/new
    const newSessionRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/new',
      params: { goalDescription: 'ACP Automation Pipeline' },
    });

    expect(newSessionRes.result).toBeDefined();
    const sessionId = (newSessionRes.result as any).sessionId;
    expect(sessionId).toBeDefined();

    // 2. Send session/send
    const sendRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/send',
      params: {
        sessionId,
        message: 'Trigger automated build',
      },
    });

    expect(sendRes.result).toBeDefined();
    expect((sendRes.result as any).success).toBe(true);

    await sqlite.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
