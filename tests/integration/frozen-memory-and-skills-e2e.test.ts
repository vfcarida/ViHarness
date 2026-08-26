/**
 * Frozen Memory Snapshot, Skills Catalog & Self-Improvement E2E Integration Suite (P007).
 *
 * Full Lifecycle Flow:
 * 1. Runtime starts execution and captures initial memory as frozen snapshot (Hermes).
 * 2. Model inspects skills catalog and loads a domain skill (DSH Self-Modification).
 * 3. Mid-execution memory additions do not corrupt active prompt cache prefix.
 * 4. Upon successful task completion, background SkillExtractor records learned pattern.
 * 5. Next execution session reflects the newly learned skill in its fresh frozen snapshot.
 */
import { describe, it, expect } from 'vitest';
import {
  DefaultContextCompiler,
  InMemoryMemoryStore,
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultSkillRegistry,
  createListSkillsTool,
  createLoadSkillTool,
  SkillExtractor,
  SkillCurator,
  ScriptedModelProvider,
  UuidV7IdFactory,
  TestClock,
} from '../../src/infra/index.js';
import { DefaultAgentRuntime } from '../../src/runtime/index.js';
import {
  type ModelRouter,
  type ToolExecutor,
  type Goal,
  DEFAULT_GOAL_CONSTRAINTS,
  ModelRole,
  ProviderHealthStatus,
  ModelCapability,
  AgentPhase,
  MemoryType,
  FinishReason,
} from '../../src/core/index.js';

describe('Frozen Memory Snapshot, Skills Catalog & Self-Improvement E2E Suite — P007', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));

  it('should execute end-to-end flow: frozen snapshot -> load skill -> self-improvement extraction', async () => {
    // 1. Setup Infrastructure
    const memoryStore = new InMemoryMemoryStore({ idFactory, clock });
    const skillRegistry = new DefaultSkillRegistry();
    const toolRegistry = new DefaultToolRegistry();

    // Register skill tools
    const listSkillsTool = createListSkillsTool(skillRegistry);
    const loadSkillTool = createLoadSkillTool(skillRegistry, skillRegistry);
    toolRegistry.register(listSkillsTool);
    toolRegistry.register(loadSkillTool);

    // Seed initial skill in registry
    skillRegistry.register({
      name: 'hexagonal_architecture_rules',
      description: 'Domain layer must not depend on infra',
      content: 'Core domain interfaces must never import from infra packages.',
      source: 'local',
      tags: ['architecture', 'invariants'],
    });

    // Seed initial durable memory in store
    await memoryStore.createRecord({
      type: MemoryType.FACT,
      content: 'Initial Policy: All API errors must return standard ProblemDetails JSON.',
      source: 'api_guidelines',
      confidence: 0.95,
      importance: 0.9,
      tags: ['api', 'standards'],
    });

    const compiler = new DefaultContextCompiler({ idFactory, clock, memoryStore });
    const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, idFactory });

    const scriptedProvider = new ScriptedModelProvider({
      providerId: 'mock-provider',
      descriptor: {
        providerId: 'mock-provider',
        modelId: 'mock-model',
        contextWindowTokens: 32000,
        costPerMillionInputTokens: 3.0,
        costPerMillionOutputTokens: 15.0,
        healthStatus: ProviderHealthStatus.HEALTHY,
        supportedRoles: ['GENERALIST'],
        capabilities: {
          toolCalling: true,
          streaming: false,
          structuredOutputs: true,
          vision: false,
          reasoningModel: false,
          contextBudgetTokens: 32000,
          maxContextTokens: 32000,
          supportedCapabilities: [ModelCapability.TOOLS],
        },
      },
      steps: [
        {
          content: 'Loading architecture skill for this task.',
          toolCalls: [
            {
              id: 'call_load_skill',
              name: 'load_skill',
              input: { name: 'hexagonal_architecture_rules' },
            },
          ],
          finishReason: FinishReason.TOOL_CALLS,
        },
        {
          content: 'Exploration complete. Preparing plan.',
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
        {
          content: 'Plan ready. Starting implementation.',
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
        {
          content: 'Implementation done. Verifying.',
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
        {
          content: 'Task verified and complete following hexagonal architecture rules.',
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
      ],
    });

    const mockRouter: ModelRouter = {
      async route() {
        return {
          selectedProvider: scriptedProvider,
          selectedModelId: 'mock-model',
          role: 'GENERALIST',
          estimatedCostDollars: 0.001,
          rationale: 'Mock execution',
        };
      },
    };

    const verificationEngine = {
      async verify() {
        return {
          status: 'PASSED' as any,
          summary: 'All checks passed',
          evidenceIds: [],
          taskId: idFactory.create<'Task'>(),
          verifiedAt: clock.now(),
          suiteId: 'suite-1',
          durationMs: 10,
          confidence: 1.0,
          scope: 'task',
          affectedFiles: [],
          checkExecutions: [],
        };
      },
    };

    const skillExtractor = new SkillExtractor({ memoryStore, idFactory, clock });
    const skillCurator = new SkillCurator({ memoryStore, clock });

    const runtime = new DefaultAgentRuntime({
      router: mockRouter,
      compiler,
      toolExecutor,
      verificationEngine,
      memoryStore,
      skillRegistry,
      skillExtractor,
      skillCurator,
      idFactory,
      clock,
    });

    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Implement user registration API endpoint adhering to domain rules',
      constraints: { ...DEFAULT_GOAL_CONSTRAINTS, maxIterations: 5, requireVerification: false },
      status: 'ACTIVE' as any,
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    // Execute first run
    const result = await runtime.execute(goal);

    expect(result.success).toBe(true);
    expect(result.status).toBe('COMPLETED');
    expect(skillRegistry.listMounted()).toContain('hexagonal_architecture_rules');

    // 2. Verify Background Self-Improvement Pattern Extraction
    const learnedPatterns = await memoryStore.retrieve({
      types: [MemoryType.PATTERN],
      limit: 10,
    });

    expect(learnedPatterns.length).toBeGreaterThanOrEqual(1);
    const pattern = learnedPatterns[0]!.record;
    expect(pattern.content).toContain('API_INTEGRATION');
    expect(pattern.content).toContain('load_skill');
    expect(pattern.tags).toContain('self_improvement');

    // 3. Verify Next Execution includes newly extracted pattern in its fresh frozen snapshot
    const nextGoal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Build user profile endpoint with API validation',
      constraints: { ...DEFAULT_GOAL_CONSTRAINTS },
      status: 'ACTIVE' as any,
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    const nextCompiler = new DefaultContextCompiler({ idFactory, clock, memoryStore });
    const nextCompiled = await nextCompiler.compile({
      goal: nextGoal,
      task: {
        id: idFactory.create<'Task'>(),
        goalId: nextGoal.id,
        description: nextGoal.description,
        status: 'ACTIVE' as any,
        priority: 1,
        createdAt: clock.now(),
        updatedAt: clock.now(),
        metadata: {},
      },
      currentState: {
        taskId: idFactory.create<'Task'>(),
        phase: AgentPhase.IMPLEMENT,
        repairCount: 0,
        iterationCount: 1,
        lastAction: null,
        lastOutcome: null,
        history: [],
        updatedAt: clock.now(),
      },
      targetModelDescriptor: {
        providerId: 'mock-provider',
        modelId: 'mock-model',
        contextWindowTokens: 32000,
        costPerMillionInputTokens: 3.0,
        costPerMillionOutputTokens: 15.0,
        healthStatus: ProviderHealthStatus.HEALTHY,
        supportedRoles: ['GENERALIST'],
        capabilities: {
          toolCalling: true,
          streaming: false,
          structuredOutputs: true,
          vision: false,
          reasoningModel: false,
          contextBudgetTokens: 32000,
          maxContextTokens: 32000,
          supportedCapabilities: [ModelCapability.TOOLS],
        },
      },
      budget: { maxTokens: 8000, softLimitTokens: 6000 },
    });

    // The fresh context includes both the original memory and the newly learned pattern
    const memoryContents = nextCompiled.compiledContext.entries.map((e) => e.content).join('\n');
    expect(memoryContents).toContain('ProblemDetails JSON');
    expect(memoryContents).toContain('API_INTEGRATION');
  });
});
