import { describe, it, expect, beforeEach } from 'vitest';
import {
  UtilityModelRouter,
  MockModelProvider,
  ModelHealthRegistry,
} from '../../../src/infra/index.js';
import {
  TaskCategory,
  ModelCapability,
  ProviderHealthStatus,
  HarnessError,
  ErrorCode,
} from '../../../src/core/index.js';
import type { RoutingRequest } from '../../../src/core/index.js';

describe('Model Router & Hot-Swapping', () => {
  let router: UtilityModelRouter;
  let healthRegistry: ModelHealthRegistry;

  // Candidate Providers
  let frontierReasoningProvider: MockModelProvider;
  let generalCodingProvider: MockModelProvider;
  let smallLocalProvider: MockModelProvider;
  let specializedReviewerProvider: MockModelProvider;

  beforeEach(() => {
    healthRegistry = new ModelHealthRegistry();
    router = new UtilityModelRouter({ healthRegistry, deterministic: true });

    // 1. Frontier Reasoning Model (e.g. o1-reasoner)
    frontierReasoningProvider = new MockModelProvider({
      providerId: 'frontier-reasoner-prov',
      descriptor: {
        id: 'o1-reasoner',
        name: 'Frontier Reasoner',
        costPer1kInputTokensDollars: 0.015,
        costPer1kOutputTokensDollars: 0.06,
        capabilities: {
          capabilities: new Set([
            ModelCapability.REASONING,
            ModelCapability.CODING,
            ModelCapability.LONG_CONTEXT,
          ]),
          maxContextTokens: 200000,
          maxOutputTokens: 16384,
          supportsSystemPrompt: true,
        },
      },
    });

    // 2. General Coding Model (e.g. gpt-4o)
    generalCodingProvider = new MockModelProvider({
      providerId: 'general-coding-prov',
      descriptor: {
        id: 'gpt-4o-coding',
        name: 'General Coding Model',
        costPer1kInputTokensDollars: 0.0025,
        costPer1kOutputTokensDollars: 0.01,
        capabilities: {
          capabilities: new Set([
            ModelCapability.REASONING,
            ModelCapability.CODING,
            ModelCapability.TOOL_USE,
            ModelCapability.STRUCTURED_OUTPUT,
            ModelCapability.STREAMING,
          ]),
          maxContextTokens: 128000,
          maxOutputTokens: 4096,
          supportsSystemPrompt: true,
        },
      },
    });

    // 3. Small Local Model (e.g. qwen-2.5-coder-7b)
    smallLocalProvider = new MockModelProvider({
      providerId: 'small-local-prov',
      descriptor: {
        id: 'qwen-coder-small',
        name: 'Small Local Coding Model',
        costPer1kInputTokensDollars: 0.0001,
        costPer1kOutputTokensDollars: 0.0002,
        capabilities: {
          capabilities: new Set([ModelCapability.CODING, ModelCapability.TOOL_USE]),
          maxContextTokens: 32000,
          maxOutputTokens: 2048,
          supportsSystemPrompt: true,
        },
      },
    });

    // 4. Specialized Reviewer (e.g. claude-3-5-sonnet)
    specializedReviewerProvider = new MockModelProvider({
      providerId: 'reviewer-prov',
      descriptor: {
        id: 'claude-reviewer',
        name: 'Specialized Reviewer',
        costPer1kInputTokensDollars: 0.003,
        costPer1kOutputTokensDollars: 0.015,
        capabilities: {
          capabilities: new Set([
            ModelCapability.REASONING,
            ModelCapability.CODING,
            ModelCapability.VISION,
            ModelCapability.STRUCTURED_OUTPUT,
          ]),
          maxContextTokens: 200000,
          maxOutputTokens: 8192,
          supportsSystemPrompt: true,
        },
      },
    });

    router.registerProvider(frontierReasoningProvider);
    router.registerProvider(generalCodingProvider);
    router.registerProvider(smallLocalProvider);
    router.registerProvider(specializedReviewerProvider);
  });

  it('should support Hot-Swapping across consecutive iterations of the same task', async () => {
    // Iteration 1: Architecture planning (requires heavy reasoning)
    const reqIter1: RoutingRequest = {
      taskCategory: TaskCategory.ARCHITECTURE,
      complexity: 'VERY_HIGH',
      risk: 'HIGH',
      contextTokenCount: 10000,
      iterationCount: 1,
    };
    const decision1 = await router.route(reqIter1);
    expect(decision1.selectedProvider.providerId).toBe('frontier-reasoner-prov');
    expect(decision1.selectedModelId).toBe('o1-reasoner');

    // Iteration 2: Code Generation (general coding)
    const reqIter2: RoutingRequest = {
      taskCategory: TaskCategory.CODE_GEN,
      complexity: 'MEDIUM',
      risk: 'MEDIUM',
      contextTokenCount: 15000,
      iterationCount: 2,
    };
    const decision2 = await router.route(reqIter2);
    expect(decision2.selectedProvider.providerId).toBe('general-coding-prov');
    expect(decision2.selectedModelId).toBe('gpt-4o-coding');

    // Iteration 3: Repetitive Test Repair (small cheap local model)
    const reqIter3: RoutingRequest = {
      taskCategory: TaskCategory.TEST_REPAIR,
      complexity: 'LOW',
      risk: 'LOW',
      contextTokenCount: 5000,
      isRepetitive: true,
      iterationCount: 3,
    };
    const decision3 = await router.route(reqIter3);
    expect(decision3.selectedProvider.providerId).toBe('small-local-prov');
    expect(decision3.selectedModelId).toBe('qwen-coder-small');

    // Iteration 4: Final Security Review (requires vision & structured review)
    const reqIter4: RoutingRequest = {
      taskCategory: TaskCategory.SECURITY_REVIEW,
      complexity: 'HIGH',
      risk: 'CRITICAL',
      contextTokenCount: 20000,
      requiredCapabilities: [ModelCapability.VISION],
      iterationCount: 4,
    };
    const decision4 = await router.route(reqIter4);
    expect(decision4.selectedProvider.providerId).toBe('reviewer-prov');
    expect(decision4.selectedModelId).toBe('claude-reviewer');
  });

  it('should exclude unhealthy providers (Provider Outage)', async () => {
    // Mark general coding provider as UNHEALTHY
    healthRegistry.recordHealth({
      providerId: 'general-coding-prov',
      status: ProviderHealthStatus.UNHEALTHY,
      lastChecked: new Date(),
    });

    const req: RoutingRequest = {
      taskCategory: TaskCategory.CODE_GEN,
      complexity: 'MEDIUM',
      risk: 'MEDIUM',
      contextTokenCount: 10000,
    };

    const decision = await router.route(req);
    // Should skip general-coding-prov and fall back to another suitable provider
    expect(decision.selectedProvider.providerId).not.toBe('general-coding-prov');
  });

  it('should enforce Capability Matching (e.g. context window & capability flags)', async () => {
    // Request requires context of 150,000 tokens
    const reqLongContext: RoutingRequest = {
      taskCategory: TaskCategory.EXPLORE,
      complexity: 'MEDIUM',
      risk: 'LOW',
      contextTokenCount: 150000, // Small model capacity is only 32,000
    };

    const decision = await router.route(reqLongContext);
    // Small model must be filtered out
    const candidates = decision.scores.map((s) => s.providerId);
    expect(candidates).not.toContain('small-local-prov');
  });

  it('should handle Cost-Aware & Budget Critical routing', async () => {
    const reqBudgetCritical: RoutingRequest = {
      taskCategory: TaskCategory.CODE_GEN,
      complexity: 'MEDIUM',
      risk: 'LOW',
      contextTokenCount: 10000,
      remainingBudgetDollars: 0.1, // Very low remaining budget
    };

    const decision = await router.route(reqBudgetCritical);
    // Cost penalty heavily weighted -> selects cheap small local model
    expect(decision.selectedProvider.providerId).toBe('small-local-prov');
  });

  it('should enforce Risk-Aware routing for CRITICAL risk tasks', async () => {
    const reqHighRisk: RoutingRequest = {
      taskCategory: TaskCategory.SECURITY_REVIEW,
      complexity: 'HIGH',
      risk: 'CRITICAL',
      contextTokenCount: 5000,
    };

    const decision = await router.route(reqHighRisk);
    // Small local model must be penalized heavily due to risk penalty
    expect(decision.selectedProvider.providerId).not.toBe('small-local-prov');
    expect(decision.selectedModelId).toMatch(/o1-reasoner|claude-reviewer|gpt-4o-coding/);
  });

  it('should produce identical routing decisions in Deterministic Mode', async () => {
    router.setDeterministicMode(true);

    const req: RoutingRequest = {
      taskCategory: TaskCategory.BUG_FIX,
      complexity: 'MEDIUM',
      risk: 'MEDIUM',
      contextTokenCount: 8000,
    };

    const decisionA = await router.route(req);
    const decisionB = await router.route(req);

    expect(decisionA.selectedProvider.providerId).toBe(decisionB.selectedProvider.providerId);
    expect(decisionA.selectedModelId).toBe(decisionB.selectedModelId);
    expect(decisionA.scores[0]?.totalUtility).toBe(decisionB.scores[0]?.totalUtility);
  });

  it('should throw HarnessError when no provider satisfies request', async () => {
    const impossibleReq: RoutingRequest = {
      taskCategory: TaskCategory.ARCHITECTURE,
      complexity: 'VERY_HIGH',
      risk: 'CRITICAL',
      contextTokenCount: 9999999, // Exceeds all model context windows
    };

    await expect(router.route(impossibleReq)).rejects.toThrow(HarnessError);
  });
});
