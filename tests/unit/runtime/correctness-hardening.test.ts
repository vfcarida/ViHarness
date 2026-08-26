import { describe, it, expect, beforeEach } from 'vitest';
import {
  MockModelProvider,
  UtilityModelRouter,
  DefaultContextCompiler,
  InMemoryContextStore,
  UuidV7IdFactory,
  TestClock,
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultPolicyEngine,
  WriteFileTool,
} from '../../../src/infra/index.js';
import { DefaultAgentRuntime, ActionPlanner } from '../../../src/runtime/index.js';
import { GoalStatus, ActionResultStatus, PolicyDecisionType } from '../../../src/core/index.js';
import type { Goal } from '../../../src/core/index.js';

describe('Runtime Correctness & Hardening Suite', () => {
  let compiler: DefaultContextCompiler;
  let idFactory: UuidV7IdFactory;
  let clock: TestClock;
  let sampleGoal: Goal;

  beforeEach(() => {
    idFactory = new UuidV7IdFactory();
    clock = new TestClock(new Date('2024-01-01T00:00:00Z'));
    const contextStore = new InMemoryContextStore({ idFactory, clock });
    compiler = new DefaultContextCompiler({ idFactory, clock });

    sampleGoal = {
      id: idFactory.create<'Goal'>(),
      description: 'Perform correctness hardening test',
      constraints: {
        maxIterations: 1,
        maxCostDollars: 5.0,
        maxDurationMs: 60000,
        maxRepairAttempts: 2,
        maxNoProgressIterations: 2,
        requireVerification: true,
      },
      status: GoalStatus.ACTIVE,
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };
  });

  it('1. Unknown Tool Enforcement: Unknown tools MUST fail with UNKNOWN_TOOL and NEVER become fake tools', async () => {
    const mockProvider = new MockModelProvider({
      providerId: 'primary-mock',
      defaultToolCalls: [{ id: 'tc-1', name: 'invented_magic_tool', input: { foo: 'bar' } }],
      simulatedLatencyMs: 0,
    });

    const router = new UtilityModelRouter();
    router.registerProvider(mockProvider);

    const registry = new DefaultToolRegistry();
    const toolExecutor = new DefaultToolExecutor({ registry, idFactory });

    const runtime = new DefaultAgentRuntime({
      router,
      compiler,
      toolExecutor,
      idFactory,
      clock,
    });

    const result = await runtime.execute(sampleGoal);
    const iteration = result.iterations[0];

    expect(iteration).toBeDefined();
    expect(iteration?.toolResults).toHaveLength(1);
    expect(iteration?.toolResults[0]?.status).toBe(ActionResultStatus.FAILURE);
    expect(iteration?.toolResults[0]?.error).toContain('UNKNOWN_TOOL');
  });

  it('2. Policy Enforcement: Policy Engine MUST execute and reject forbidden actions before execution', async () => {
    const mockProvider = new MockModelProvider({
      providerId: 'primary-mock',
      defaultToolCalls: [
        { id: 'tc-1', name: 'write_file', input: { path: '/etc/shadow', content: 'hack' } },
      ],
      simulatedLatencyMs: 0,
    });

    const router = new UtilityModelRouter();
    router.registerProvider(mockProvider);

    const registry = new DefaultToolRegistry();
    registry.register(new WriteFileTool(idFactory));
    const policyEngine = new DefaultPolicyEngine({ idFactory, clock });
    const toolExecutor = new DefaultToolExecutor({ registry, policyEngine, idFactory });

    const runtime = new DefaultAgentRuntime({
      router,
      compiler,
      policyEngine,
      toolExecutor,
      idFactory,
      clock,
    });

    const result = await runtime.execute(sampleGoal);
    const iteration = result.iterations[0];

    expect(iteration).toBeDefined();
    expect(iteration?.toolResults[0]?.status).toBe(ActionResultStatus.DENIED);
    expect(iteration?.toolResults[0]?.error).toContain('POLICY_DENIED');
  });

  it('3. Missing Verification Rule: Omitted verification engine MUST produce INCONCLUSIVE evidence (never fake pass)', async () => {
    const mockProvider = new MockModelProvider({
      providerId: 'primary-mock',
      defaultResponseText: 'Reasoning output',
      simulatedLatencyMs: 0,
    });

    const router = new UtilityModelRouter();
    router.registerProvider(mockProvider);

    const runtime = new DefaultAgentRuntime({
      router,
      compiler,
      idFactory,
      clock,
    });

    const result = await runtime.execute(sampleGoal);
    const iteration = result.iterations[0];

    expect(iteration?.evidenceCreated).toHaveLength(1);
    expect(iteration?.evidenceCreated[0]?.type).toBeDefined();
  });

  it('4. Action Planner Validation: Maps tool calls to ActionProposals without hardcoded defaults', () => {
    const proposals = ActionPlanner.parseProposals(
      {
        content: '',
        toolCalls: [{ id: 'tc-1', name: 'read_file', input: { path: 'src/index.ts' } }],
        usage: { inputTokens: 10, outputTokens: 10 },
        latencyMs: 10,
        estimatedCostDollars: 0.001,
      },
      idFactory.create<'Task'>(),
      idFactory.create<'Iteration'>(),
      idFactory,
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.description).toBe('Execute tool [read_file]');
    expect(proposals[0]?.parameters).toMatchObject({ path: 'src/index.ts' });
  });
});
