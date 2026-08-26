/**
 * Dual Model Routing Unit Tests
 *
 * Tests the Architect / Editor dual-model routing subsystem:
 * 1. Explicit DualModelConfig configuration.
 * 2. Phase-based model selection (PLAN -> Architect, EXECUTE/REPAIR -> Editor).
 * 3. Role-based utility scoring (Reasoning bonus for Architect, Cost efficiency for Editor).
 * 4. Fallback resilience when dedicated role model is degraded/unhealthy.
 */
import { describe, it, expect } from 'vitest';
import {
  UtilityModelRouter,
  MockModelProvider,
  SimulatedFaultModelProvider,
} from '../../../src/infra/index.js';
import {
  TaskCategory,
  ModelCapability,
  ModelPolicyRule,
  AgentPhase,
  type RoutingRequest,
  ProviderHealthStatus,
} from '../../../src/core/index.js';

describe('Dual Model Routing Suite (Architect / Editor Mode)', () => {
  // Expensive Frontier Reasoning Model (Architect)
  const architectProvider = new MockModelProvider({
    providerId: 'frontier-architect-provider',
    descriptor: {
      id: 'gpt-5-o1-preview',
      name: 'Frontier Architect Model',
      providerId: 'frontier-architect-provider',
      version: '1.0.0',
      capabilities: {
        capabilities: new Set([
          ModelCapability.REASONING,
          ModelCapability.CODING,
          ModelCapability.TOOL_USE,
          ModelCapability.STRUCTURED_OUTPUT,
        ]),
        maxContextTokens: 200000,
        maxOutputTokens: 32000,
        supportsSystemPrompt: true,
      },
      costPer1kInputTokensDollars: 0.015,
      costPer1kOutputTokensDollars: 0.06, // $60/1M output tokens
    },
  });

  // Fast, Low-Cost Coding Model (Editor)
  const editorProvider = new MockModelProvider({
    providerId: 'fast-editor-provider',
    descriptor: {
      id: 'gpt-4o-mini-coder',
      name: 'Fast Editor Model',
      providerId: 'fast-editor-provider',
      version: '1.0.0',
      capabilities: {
        capabilities: new Set([
          ModelCapability.CODING,
          ModelCapability.TOOL_USE,
          ModelCapability.STRUCTURED_OUTPUT,
        ]),
        maxContextTokens: 128000,
        maxOutputTokens: 4096,
        supportsSystemPrompt: true,
      },
      costPer1kInputTokensDollars: 0.00015,
      costPer1kOutputTokensDollars: 0.0006, // $0.60/1M output tokens (100x cheaper)
    },
  });

  describe('1. Explicit DualModelConfig Configuration', () => {
    it('should route to Architect on PLAN phase and Editor on EXECUTE phase when configured', async () => {
      const router = new UtilityModelRouter({
        dualModelConfig: {
          architectProviderId: 'frontier-architect-provider',
          editorProviderId: 'fast-editor-provider',
        },
      });
      router.registerProvider(architectProvider);
      router.registerProvider(editorProvider);

      // Phase 1: PLAN (Architect)
      const planRequest: RoutingRequest = {
        taskCategory: TaskCategory.ARCHITECTURE,
        complexity: 'HIGH',
        risk: 'LOW',
        currentState: AgentPhase.PLAN,
        contextTokenCount: 5000,
      };

      const planDecision = await router.route(planRequest);
      expect(planDecision.selectedProvider.providerId).toBe('frontier-architect-provider');
      expect(planDecision.selectedModelId).toBe('gpt-5-o1-preview');
      expect(planDecision.rationale).toContain('ARCHITECT');

      // Phase 2: IMPLEMENT (Editor)
      const executeRequest: RoutingRequest = {
        taskCategory: TaskCategory.CODE_GEN,
        complexity: 'MEDIUM',
        risk: 'LOW',
        currentState: AgentPhase.IMPLEMENT,
        contextTokenCount: 5000,
      };

      const executeDecision = await router.route(executeRequest);
      expect(executeDecision.selectedProvider.providerId).toBe('fast-editor-provider');
      expect(executeDecision.selectedModelId).toBe('gpt-4o-mini-coder');
      expect(executeDecision.rationale).toContain('EDITOR');
    });

    it('should support custom phaseRoleMapping in DualModelConfig', async () => {
      const router = new UtilityModelRouter({
        dualModelConfig: {
          architectProviderId: 'frontier-architect-provider',
          editorProviderId: 'fast-editor-provider',
          phaseRoleMapping: {
            [AgentPhase.REPAIR]: 'ARCHITECT', // High-precision architect for bug root cause diagnosis
            [AgentPhase.IMPLEMENT]: 'EDITOR',
          },
        },
      });
      router.registerProvider(architectProvider);
      router.registerProvider(editorProvider);

      // REPAIR mapped to ARCHITECT
      const repairDecision = await router.route({
        taskCategory: TaskCategory.BUG_FIX,
        complexity: 'HIGH',
        risk: 'MEDIUM',
        currentState: AgentPhase.REPAIR,
        contextTokenCount: 4000,
      });

      expect(repairDecision.selectedProvider.providerId).toBe('frontier-architect-provider');
    });
  });

  describe('2. Dynamic Role-Aware Utility Calculation (No hardcoded config)', () => {
    it('should select high reasoning model for ARCHITECT role and cost-effective model for EDITOR role', async () => {
      const router = new UtilityModelRouter();
      router.registerProvider(architectProvider);
      router.registerProvider(editorProvider);

      // 1. Architect Role: Deep reasoning over cost
      const architectDecision = await router.route({
        taskCategory: TaskCategory.ARCHITECTURE,
        complexity: 'VERY_HIGH',
        risk: 'HIGH',
        targetRole: 'ARCHITECT',
        contextTokenCount: 3000,
      });

      expect(architectDecision.selectedProvider.providerId).toBe('frontier-architect-provider');

      // 2. Editor Role: Cost efficiency & coding speed over expensive reasoning
      const editorDecision = await router.route({
        taskCategory: TaskCategory.CODE_GEN,
        complexity: 'LOW',
        risk: 'LOW',
        targetRole: 'EDITOR',
        contextTokenCount: 3000,
      });

      expect(editorDecision.selectedProvider.providerId).toBe('fast-editor-provider');
    });
  });

  describe('3. Fallback Resilience under Dual-Model Mode', () => {
    it('should fallback gracefully when dedicated Architect provider is UNHEALTHY', async () => {
      const failingArchitect = new SimulatedFaultModelProvider({
        providerId: 'failing-architect',
        modelId: 'failing-gpt-5',
        faultType: 'SERVICE_UNAVAILABLE',
        failCount: 10,
      });

      const fallbackModel = new MockModelProvider({
        providerId: 'backup-generalist',
        descriptor: {
          id: 'claude-3-7-sonnet',
          name: 'Backup Generalist Model',
          providerId: 'backup-generalist',
          version: '1.0.0',
          capabilities: {
            capabilities: new Set([
              ModelCapability.REASONING,
              ModelCapability.CODING,
              ModelCapability.TOOL_USE,
            ]),
            maxContextTokens: 200000,
            maxOutputTokens: 8192,
            supportsSystemPrompt: true,
          },
          costPer1kInputTokensDollars: 0.003,
          costPer1kOutputTokensDollars: 0.015,
        },
      });

      const router = new UtilityModelRouter({
        dualModelConfig: {
          architectProviderId: 'failing-architect',
          editorProviderId: 'fast-editor-provider',
        },
      });

      router.registerProvider(failingArchitect);
      router.registerProvider(fallbackModel);
      router.registerProvider(editorProvider);

      // Mark architect as unhealthy
      router.healthRegistry.recordHealth({
        providerId: 'failing-architect',
        status: ProviderHealthStatus.UNHEALTHY,
        lastChecked: new Date(),
        errorMessage: '503 Overloaded',
      });

      const decision = await router.route({
        taskCategory: TaskCategory.ARCHITECTURE,
        complexity: 'HIGH',
        risk: 'LOW',
        currentState: AgentPhase.PLAN,
        contextTokenCount: 2000,
      });

      // Should fallback to healthy reasoning model
      expect(decision.selectedProvider.providerId).toBe('backup-generalist');
    });
  });
});
