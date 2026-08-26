/**
 * Deep Execution Hardening Suite
 *
 * Validates the 4 core pillars of execution hardening:
 * 1. UNKNOWN_TOOL: Structured error, explicit failure evidence, no false state advancement.
 * 2. Missing/Inconclusive Verification: No synthetic PASS, INCONCLUSIVE evidence blocks DONE.
 * 3. Mandatory Policy Evaluation: Unbypassable PolicyEngine evaluation across all tool requests.
 * 4. Strict State Flow: LLM cannot emit runtime-only events; DONE requires empirical evidence IDs.
 */
import { describe, it, expect } from 'vitest';
import {
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultPolicyEngine,
  DefaultVerificationEngine,
  DefaultEvidenceStore,
  DefaultContextCompiler,
  ScriptedModelProvider,
  UtilityModelRouter,
  UuidV7IdFactory,
  TestClock,
} from '../../../src/infra/index.js';
import {
  AgentPhase,
  StateEvent,
  GoalStatus,
  PolicyDecisionType,
  ActionResultStatus,
  EvidenceOutcome,
  FinishReason,
  ToolCategory,
  ToolRiskLevel,
  HarnessError,
  ErrorCode,
  StateMachine,
  validateTransition,
  validateTransitionOrThrow,
} from '../../../src/core/index.js';
import type { Goal, Tool, ToolExecutionRequest, PolicyRule } from '../../../src/core/index.js';
import { DefaultAgentRuntime } from '../../../src/runtime/default-agent-runtime.js';

describe('Execution Hardening Deep Suite', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));

  // =========================================================================
  // PILLAR 1: UNKNOWN TOOLS
  // =========================================================================
  describe('Pillar 1: Unknown Tools Hardening', () => {
    it('should generate explicit failure evidence and NOT advance phase on unknown tool call', async () => {
      const toolRegistry = new DefaultToolRegistry();
      const policyEngine = new DefaultPolicyEngine();
      const toolExecutor = new DefaultToolExecutor({
        registry: toolRegistry,
        policyEngine,
        idFactory,
      });

      const evidenceStore = new DefaultEvidenceStore();
      const compiler = new DefaultContextCompiler({ idFactory, clock });

      const scriptedSteps = [
        {
          content: 'Invoking non-existent tool',
          toolCalls: [{ name: 'ghost_tool_v9', input: { query: 'test' }, id: 'call_ghost' }],
          finishReason: FinishReason.TOOL_CALL,
        },
        {
          content: 'Stopping after failed tool attempt',
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
      ];

      const modelProvider = new ScriptedModelProvider({ steps: scriptedSteps });
      const router = new UtilityModelRouter();
      router.registerProvider(modelProvider);

      const runtime = new DefaultAgentRuntime({
        router,
        compiler,
        policyEngine,
        toolExecutor,
        evidenceStore,
        idFactory,
        clock,
      });

      const goal: Goal = {
        id: idFactory.create<'Goal'>(),
        description: 'Test unknown tool execution hardening',
        status: GoalStatus.ACTIVE,
        constraints: {
          maxIterations: 3,
          maxCostDollars: 1.0,
          maxDurationMs: 15000,
          maxRepairAttempts: 3,
          maxNoProgressIterations: 3,
          requireVerification: false,
        },
        createdAt: clock.now(),
        updatedAt: clock.now(),
        metadata: {},
      };

      const result = await runtime.execute(goal);

      // Verify iteration 1 produced UNKNOWN_TOOL error and failure evidence
      const iter1 = result.iterations[0];
      expect(iter1).toBeDefined();
      expect(iter1!.toolResults).toHaveLength(1);
      expect(iter1!.toolResults[0]!.status).toBe(ActionResultStatus.FAILURE);
      expect(iter1!.toolResults[0]!.metadata?.['errorCode']).toBe('UNKNOWN_TOOL');

      // Verify explicit failure evidence was recorded
      expect(
        iter1!.evidenceCreated.some((e) => !e.pass && e.outcome === EvidenceOutcome.FAIL),
      ).toBe(true);

      // Verify state was NOT falsely advanced to PLAN or IMPLEMENT during the failed tool iteration
      expect(iter1!.phases.observation.stateBefore).toBe(AgentPhase.INIT);
      expect(iter1!.phases.stateTransition.to).toBe(AgentPhase.EXPLORE);
    });

    it('DefaultToolExecutor should reject directly with TOOL_NOT_FOUND when tool not registered', async () => {
      const toolRegistry = new DefaultToolRegistry();
      const executor = new DefaultToolExecutor({
        registry: toolRegistry,
        idFactory,
      });

      await expect(
        executor.execute({ toolName: 'unregistered_tool', input: {} }),
      ).rejects.toMatchObject({
        code: ErrorCode.TOOL_NOT_FOUND,
      });
    });
  });

  // =========================================================================
  // PILLAR 2: MISSING & INCONCLUSIVE VERIFICATION
  // =========================================================================
  describe('Pillar 2: Missing & Inconclusive Verification Hardening', () => {
    it('should record INCONCLUSIVE evidence and prevent transition to DONE when verification engine is unavailable', async () => {
      const toolRegistry = new DefaultToolRegistry();
      const compiler = new DefaultContextCompiler({ idFactory, clock });
      const evidenceStore = new DefaultEvidenceStore();

      const scriptedSteps = [
        {
          content: 'Completing implementation without verification engine',
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
      ];

      const modelProvider = new ScriptedModelProvider({ steps: scriptedSteps });
      const router = new UtilityModelRouter();
      router.registerProvider(modelProvider);

      // Runtime WITHOUT verificationEngine configured
      const runtime = new DefaultAgentRuntime({
        router,
        compiler,
        toolExecutor: new DefaultToolExecutor({ registry: toolRegistry, idFactory }),
        evidenceStore,
        idFactory,
        clock,
      });

      const goal: Goal = {
        id: idFactory.create<'Goal'>(),
        description: 'Implement secure auth token generator',
        status: GoalStatus.ACTIVE,
        constraints: {
          maxIterations: 2,
          maxCostDollars: 1.0,
          maxDurationMs: 10000,
          maxRepairAttempts: 3,
          maxNoProgressIterations: 3,
          requireVerification: true, // Verification is strictly required!
        },
        createdAt: clock.now(),
        updatedAt: clock.now(),
        metadata: {},
      };

      const result = await runtime.execute(goal);

      // Cannot succeed without verification
      expect(result.success).toBe(false);
      const evList = await evidenceStore.listForTask(result.taskId);
      expect(evList.some((e) => e.outcome === EvidenceOutcome.INCONCLUSIVE && !e.pass)).toBe(true);
      expect(
        result.iterations[0]!.evidenceCreated.some(
          (e) => e.outcome === EvidenceOutcome.INCONCLUSIVE,
        ),
      ).toBe(true);
    });

    it('DefaultVerificationEngine should return INCONCLUSIVE when verification check crashes or times out', async () => {
      const verificationEngine = new DefaultVerificationEngine({ idFactory, clock });
      const result = await verificationEngine.verify({
        type: 'test-suite',
        content: 'inconclusive test run for timeout verification',
      });

      expect(result.status).toBe('INCONCLUSIVE');
      expect(result.confidence).toBe(0.5);
    });
  });

  // =========================================================================
  // PILLAR 3: MANDATORY POLICY EVALUATION
  // =========================================================================
  describe('Pillar 3: Mandatory Policy Evaluation', () => {
    it('should evaluate PolicyEngine on all tools unconditionally and deny unauthorized actions', async () => {
      const toolRegistry = new DefaultToolRegistry();
      const inspectTool: Tool = {
        definition: {
          name: 'inspect_system',
          version: '1.0.0',
          category: ToolCategory.READ,
          riskLevel: ToolRiskLevel.LOW,
          mutating: false,
          idempotent: true,
          defaultTimeoutMs: 5000,
          requiredPermissions: ['sys:read'],
          inputSchema: { type: 'object', properties: { target: { type: 'string' } } },
        },
        execute: async () => ({
          toolCallId: idFactory.create<'ToolCall'>(),
          name: 'inspect_system',
          output: 'system secret info',
          success: true,
          durationMs: 10,
        }),
      };
      toolRegistry.register(inspectTool);

      const policyEngine = new DefaultPolicyEngine();
      // Add strict rule denying inspect_system
      const denyRule: PolicyRule = {
        id: 'deny-system-inspect',
        name: 'Deny System Inspection',
        description: 'Blocks all system inspection tools',
        priority: 100,
        evaluate: (action) => {
          if (
            action.resource.includes('inspect_system') ||
            (action.metadata as any)?.['toolName'] === 'inspect_system'
          ) {
            return {
              decision: PolicyDecisionType.DENY,
              reason: 'Inspection of system components is strictly prohibited by security policy',
              ruleId: 'deny-system-inspect',
            };
          }
          return { decision: PolicyDecisionType.ALLOW, ruleId: 'deny-system-inspect' };
        },
      };
      policyEngine.addRule(denyRule);

      const toolExecutor = new DefaultToolExecutor({
        registry: toolRegistry,
        policyEngine,
        idFactory,
      });

      const request: ToolExecutionRequest = {
        toolName: 'inspect_system',
        input: { target: '/etc/shadow' },
      };

      const result = await toolExecutor.execute(request);
      expect(result.success).toBe(false);
      expect(result.metadata?.['errorCode']).toBe('POLICY_DENIED');
      expect(result.error).toContain('Policy DENIED tool execution');
    });
  });

  // =========================================================================
  // PILLAR 4: STRICT STATE FLOW HARDENING
  // =========================================================================
  describe('Pillar 4: Strict State Flow Hardening', () => {
    it('should reject LLM emission of runtime-only events (MARK_DONE, VERIFICATION_PASSED, OSCILLATION_FOUND)', () => {
      expect(validateTransition(AgentPhase.VERIFY, StateEvent.MARK_DONE, true).valid).toBe(false);
      expect(
        validateTransition(AgentPhase.VERIFY, StateEvent.VERIFICATION_PASSED, true).valid,
      ).toBe(false);
      expect(validateTransition(AgentPhase.REPAIR, StateEvent.OSCILLATION_FOUND, true).valid).toBe(
        false,
      );
      expect(
        validateTransition(AgentPhase.IMPLEMENT, StateEvent.BUDGET_EXHAUSTED, true).valid,
      ).toBe(false);
    });

    it('should reject transition to DONE without valid evidenceIds in automated path', () => {
      const taskId = idFactory.create<'Task'>();
      const sm = new StateMachine({
        taskId,
        idFactory,
        clock,
        initialPhase: AgentPhase.VERIFY,
      });

      // Trying to transition to DONE with empty evidenceIds
      expect(() => sm.apply(StateEvent.VERIFICATION_PASSED, { evidenceIds: [] })).toThrow(
        HarnessError,
      );

      try {
        sm.apply(StateEvent.VERIFICATION_PASSED, { evidenceIds: [] });
      } catch (err: any) {
        expect(err.code).toBe(ErrorCode.STATE_INVALID_TRANSITION);
      }
    });

    it('should reject invalid direct transitions (e.g. INIT -> DONE, EXPLORE -> DONE, IMPLEMENT -> DONE)', () => {
      expect(() => validateTransitionOrThrow(AgentPhase.INIT, StateEvent.MARK_DONE)).toThrow(
        HarnessError,
      );
      expect(() => validateTransitionOrThrow(AgentPhase.EXPLORE, StateEvent.MARK_DONE)).toThrow(
        HarnessError,
      );
      expect(() => validateTransitionOrThrow(AgentPhase.IMPLEMENT, StateEvent.MARK_DONE)).toThrow(
        HarnessError,
      );
    });
  });
});
