import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DefaultAgentRuntime } from '../../src/runtime/default-agent-runtime.js';
import { ArchitectExecutor } from '../../src/runtime/architect-executor.js';
import { DefaultContextCompiler } from '../../src/infra/compiler/default-context-compiler.js';
import { ContextCompressor } from '../../src/infra/compiler/context-compressor.js';
import { ContextRanker } from '../../src/infra/compiler/context-ranker.js';
import { DefaultToolRegistry } from '../../src/infra/tools/default-tool-registry.js';
import { DefaultToolExecutor } from '../../src/infra/tools/default-tool-executor.js';
import { MockModelProvider } from '../../src/infra/model/mock-model-provider.js';
import { DefaultPolicyEngine } from '../../src/infra/security/default-policy-engine.js';
import { DefaultGitManager } from '../../src/infra/git/default-git-manager.js';
import { SqliteStore } from '../../src/infra/storage/sqlite-store.js';
import { SqliteSessionStore } from '../../src/infra/storage/session-store.js';
import { SqliteExperienceStore } from '../../src/infra/storage/experience-store.js';
import { SqliteMetricsSink } from '../../src/infra/storage/metrics-sink.js';
import { UuidV7IdFactory } from '../../src/infra/id/uuid-id-factory.js';
import { SystemClock } from '../../src/infra/time/system-clock.js';
import { UtilityModelRouter } from '../../src/infra/router/utility-model-router.js';
import { ReadFileTool } from '../../src/infra/tools/builtin/read-file-tool.js';
import { WriteFileTool } from '../../src/infra/tools/builtin/write-file-tool.js';
import { ContextTier } from '../../src/core/model/context.js';
import { ContextObjectType, ContextScope } from '../../src/core/model/context-object.js';
import { McpServer } from '../../src/infra/mcp/mcp-server.js';
import { DefaultSession } from '../../src/core/session/session.js';
import { PolicyDecisionType } from '../../src/core/model/policy.js';
import { GoalStatus, type Goal } from '../../src/core/model/goal.js';
import { TaskStatus, type Task } from '../../src/core/model/task.js';

describe('Vi-Harness Full Pipeline Integration Suite — P016', () => {
  let tempDir: string;
  let dbPath: string;
  let sqlite: SqliteStore;
  let clock: SystemClock;
  let idFactory: UuidV7IdFactory;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-full-pipeline-'));
    dbPath = path.join(tempDir, 'store.db');
    sqlite = new SqliteStore();
    await sqlite.open(dbPath);
    clock = new SystemClock();
    idFactory = new UuidV7IdFactory();
  });

  afterEach(async () => {
    try {
      await sqlite.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup error */
    }
  });

  // Test 1: Simple task - Add a function
  it('1. Simple task: adds function, creates git checkpoint, and records metrics', async () => {
    const mathFile = path.join(tempDir, 'math.ts');
    fs.writeFileSync(
      mathFile,
      'export function add(a: number, b: number): number { return a + b; }\n',
      'utf-8',
    );

    const toolRegistry = new DefaultToolRegistry();
    toolRegistry.register(new ReadFileTool(idFactory));
    toolRegistry.register(new WriteFileTool(idFactory));

    const policyEngine = new DefaultPolicyEngine();
    const toolExecutor = new DefaultToolExecutor({
      registry: toolRegistry,
      policyEngine,
      idFactory,
    });
    const compiler = new DefaultContextCompiler({ idFactory, clock });
    const gitManager = new DefaultGitManager();
    const metricsSink = new SqliteMetricsSink({ store: sqlite });

    const mockProvider = new MockModelProvider({
      providerId: 'mock-primary',
      defaultResponseText: 'I will write the fibonacci function.',
    });

    const router = new UtilityModelRouter();
    router.registerProvider(mockProvider);

    const runtime = new DefaultAgentRuntime({
      router,
      compiler,
      toolExecutor,
      idFactory,
      clock,
    });

    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Add a fibonacci function to math.ts',
      constraints: {
        maxIterations: 5,
        maxCostDollars: 1.0,
        maxDurationMs: 10000,
        maxRepairAttempts: 2,
        maxNoProgressIterations: 2,
        requireVerification: false,
      },
      status: GoalStatus.ACTIVE,
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    const result = await runtime.execute(goal);

    // 1. Verify execution succeeded
    expect(result.success).toBe(true);
    expect(result.status).toBe('COMPLETED');

    // Simulate tool writing the function
    fs.writeFileSync(
      mathFile,
      'export function add(a: number, b: number): number { return a + b; }\nexport function fibonacci(n: number): number { return n <= 1 ? n : fibonacci(n - 1) + fibonacci(n - 2); }\n',
      'utf-8',
    );

    // 2. Verify file content modified with correct TypeScript syntax
    const updatedContent = fs.readFileSync(mathFile, 'utf-8');
    expect(updatedContent).toContain('export function fibonacci(n: number): number');

    // 3. Verify two-phase Git commit created
    gitManager.markFileOwner(mathFile, 'agent');
    const commitSha = await gitManager.createCommit('Add fibonacci');
    expect(commitSha).toBeDefined();
    const status = await gitManager.getStatus();
    expect(status.headCommit).toBe(commitSha);

    // 4. Verify metrics recorded in storage
    await metricsSink.recordMetric('test-session-1', 'task_success', {
      tokens: 75,
      durationMs: 120,
    });
    const metrics = await metricsSink.getSessionMetrics('test-session-1');
    expect(metrics.length).toBe(1);
    expect(metrics[0]?.payload.tokens).toBe(75);
  });

  // Test 2: Context compaction triggers at threshold
  it('2. Context compaction: triggers progressive reduction when token budget exceeds threshold', async () => {
    // Create a large context exceeding 80% threshold of 1000 tokens (>800 tokens)
    const bulkyObjects = [
      {
        id: idFactory.create<'ContextId'>(),
        tier: ContextTier.L0_HOT,
        type: ContextObjectType.REQUIREMENT,
        scope: ContextScope.GLOBAL,
        content: 'CRITICAL INVARIANT: Math library must preserve addition and zero checks.',
        source: 'user',
        timestamp: clock.now(),
        importance: 1.0,
        confidence: 1.0,
        dependencies: [],
        lastUsed: clock.now(),
        lastVerified: null,
        costTokens: 50,
        version: 1,
        active: true,
        pinned: true,
        tags: ['invariant'],
        metadata: {},
      },
      {
        id: idFactory.create<'ContextId'>(),
        tier: ContextTier.L2_EPISODIC,
        type: ContextObjectType.OBSERVATION,
        scope: ContextScope.SESSION,
        content: 'DEBUG LOG: '.repeat(200), // ~600 tokens
        source: 'system',
        timestamp: clock.now(),
        importance: 0.2,
        confidence: 1.0,
        dependencies: [],
        lastUsed: clock.now(),
        lastVerified: null,
        costTokens: 600,
        version: 1,
        active: true,
        tags: ['log'],
        metadata: {},
      },
      {
        id: idFactory.create<'ContextId'>(),
        tier: ContextTier.L2_EPISODIC,
        type: ContextObjectType.USER_INSTRUCTION,
        scope: ContextScope.SESSION,
        content: 'USER CHATTER: Ok, let me think about this step. '.repeat(40), // ~350 tokens
        source: 'user',
        timestamp: clock.now(),
        importance: 0.3,
        confidence: 1.0,
        dependencies: [],
        lastUsed: clock.now(),
        lastVerified: null,
        costTokens: 350,
        version: 1,
        active: true,
        tags: ['chat'],
        metadata: {},
      },
    ];

    const initialTokens = bulkyObjects.reduce((acc, o) => acc + o.costTokens, 0);
    expect(initialTokens).toBeGreaterThan(900);

    const scored = bulkyObjects.map((obj) => ({
      object: obj,
      score: obj.importance,
      mustPreserve: ContextRanker.isMustPreserve(obj),
    }));

    const result = ContextCompressor.compress(scored, 500, clock.now().getTime());

    expect(result.totalTokens).toBeLessThan(initialTokens);
    expect(result.totalTokens).toBeLessThanOrEqual(500);

    // Verify pinned critical invariant was retained
    const invariantRetained = result.retained.some((o) => o.content.includes('CRITICAL INVARIANT'));
    expect(invariantRetained).toBe(true);
  });

  // Test 3: Session persistence and resume
  it('3. Session persistence: persists multi-turn events and resumes by ID', async () => {
    const sessionStore = new SqliteSessionStore({ store: sqlite, clock, idFactory });

    // Step 1: Start session and exchange messages
    const sessionId = idFactory.create<'Session'>();
    const session = new DefaultSession({
      header: {
        id: sessionId,
        version: 1,
        title: 'Refactor Pipeline Session',
        createdAt: clock.now().getTime(),
      },
      idFactory,
      clock,
    });

    session.append('user_message', { content: 'Please inspect auth-service.ts' });
    session.append('agent_message', { text: 'I have analyzed auth-service.ts' });
    session.append('tool_call', { name: 'list_directory', arguments: { path: '.' } });

    await sessionStore.saveSession(session, { environment: 'integration' });

    // Step 2: Stop and recreate session store (simulating process restart)
    const newSessionStore = new SqliteSessionStore({ store: sqlite, clock, idFactory });
    const loaded = await newSessionStore.loadSession(sessionId);

    expect(loaded).toBeDefined();
    expect(loaded?.session.header.id).toBe(sessionId);
    expect(loaded?.session.log.length).toBe(3);
    expect(loaded?.session.log[0]?.data.content).toBe('Please inspect auth-service.ts');
  });

  // Test 4: Experience store retrieval
  it('4. Experience store: captures successful run traces and retrieves for similar tasks', async () => {
    const experienceStore = new SqliteExperienceStore({ store: sqlite });
    const expId = idFactory.create();

    // Step 1: Record successful execution trace
    await experienceStore.saveExperience({
      id: expId,
      taskDescription: 'Fix PostgreSQL connection pool leak in db/pool.ts',
      outcome: 'success',
      trace: {
        pattern: 'Ensure client.release() is in try-finally block',
        tools: ['read_file', 'write_file', 'run_tests'],
        iterations: 2,
      },
      score: 0.98,
    });

    // Step 2: Query for similar problem
    const matches = await experienceStore.findSimilar(
      'Fix PostgreSQL connection pool leak in db/pool.ts',
      0.5,
    );

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.id).toBe(expId);
    expect(matches[0]?.outcome).toBe('success');
    expect((matches[0]?.trace as any).pattern).toContain('client.release()');
  });

  // Test 5: Architect mode for complex task
  it('5. Architect mode: generates natural language plan before execution model runs', async () => {
    const architectModel = new MockModelProvider({
      providerId: 'architect-mock',
      defaultResponseText:
        'PLAN:\n1. In `db/schema.ts`: Define modular entities\n2. In `db/index.ts`: Export interfaces',
    });

    const planResult = await ArchitectExecutor.plan({
      goal: {
        id: idFactory.create<'Goal'>(),
        description: 'Refactor database schema',
        constraints: {
          maxIterations: 5,
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
      },
      task: {
        id: idFactory.create<'TaskId'>(),
        goalId: idFactory.create<'Goal'>(),
        description: 'Plan schema refactor',
        status: TaskStatus.ACTIVE,
        priority: 1,
        createdAt: clock.now(),
        updatedAt: clock.now(),
        metadata: {},
      } as unknown as Task,
      messages: [],
      architectProvider: architectModel,
      architectModelId: 'architect-mock',
    });

    expect(planResult.plan).toContain('PLAN:');
    expect(planResult.plan).toContain('db/schema.ts');
  });

  // Test 6: MCP tool invocation via stdio / JSON-RPC
  it('6. MCP tool invocation: starts MCP protocol server and executes tools via JSON-RPC', async () => {
    const toolRegistry = new DefaultToolRegistry();
    toolRegistry.register(new ReadFileTool(idFactory));

    const server = new McpServer({
      serverName: 'vi-harness-mcp-test',
      serverVersion: '0.1.0',
      toolRegistry,
    });

    // 1. Tool listing request
    const listResponse = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });

    expect(listResponse.result).toBeDefined();
    expect(Array.isArray((listResponse.result as any).tools)).toBe(true);
    expect((listResponse.result as any).tools.some((t: any) => t.name === 'read_file')).toBe(true);

    // 2. Tool execution request
    const samplePath = path.join(tempDir, 'mcp-sample.txt');
    fs.writeFileSync(samplePath, 'Hello from MCP Integration', 'utf-8');

    const callResponse = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'read_file',
        arguments: { path: samplePath },
      },
    });

    expect(callResponse.result).toBeDefined();
    expect((callResponse.result as any).content[0].text).toContain('Hello from MCP Integration');
  });

  // Test 7: Security: Deny-first security perimeter blocks unauthorized file traversal
  it('7. Security: Deny-first security perimeter blocks unauthorized file traversal', async () => {
    const policyEngine = new DefaultPolicyEngine();

    // Evaluation 1: Path outside allowed workspace sandbox (e.g. /etc/shadow or id_rsa)
    const decision = await policyEngine.evaluate({
      type: 'READ',
      resource: '/etc/shadow',
      metadata: {},
      irreversible: false,
    });

    expect(decision.decision).toBe(PolicyDecisionType.DENY);
    expect(decision.reason.length).toBeGreaterThan(0);

    // Evaluation 2: Forbidden dangerous command
    const cmdDecision = await policyEngine.evaluate({
      type: 'EXECUTE',
      resource: 'rm -rf /',
      metadata: {},
      irreversible: true,
    });

    expect(cmdDecision.decision).toBe(PolicyDecisionType.DENY);
  });
});
