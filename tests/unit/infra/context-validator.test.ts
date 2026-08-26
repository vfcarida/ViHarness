import { describe, it, expect } from 'vitest';
import { ContextValidator } from '../../../src/infra/compiler/context-validator.js';
import { ContextObjectType } from '../../../src/core/model/context-object.js';
import { ContextTier } from '../../../src/core/model/context.js';
import type { ContextObject } from '../../../src/core/model/context-object.js';
import type { ModelDescriptor } from '../../../src/core/model/model-io.js';
import { ModelCapability } from '../../../src/core/model/model-io.js';
import type { ContextBudget } from '../../../src/core/model/compiler-types.js';
import { HarnessError } from '../../../src/core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../../src/core/errors/error-codes.js';
import type { ContextId, TaskId } from '../../../src/core/types/identifiers.js';

describe('ContextValidator Unit Suite', () => {
  const modelDescriptor: ModelDescriptor = {
    id: 'test-model',
    name: 'Test Model',
    providerId: 'mock-prov',
    version: '1.0',
    capabilities: {
      capabilities: new Set([ModelCapability.REASONING]),
      maxContextTokens: 8000,
      maxOutputTokens: 2000,
      supportsSystemPrompt: true,
    },
    costPer1kInputTokensDollars: 0.001,
    costPer1kOutputTokensDollars: 0.002,
  };

  const budget: ContextBudget = {
    maxTokens: 4000,
    softLimitTokens: 3000,
    tierBudgets: {
      system: 800,
      task: 1000,
      observation: 1400,
      memory: 800,
    },
  };

  function createObj(
    id: string,
    isMustPreserve = false,
    type = ContextObjectType.OBSERVATION,
  ): ContextObject {
    return {
      id: id as ContextId,
      taskId: 'task-1' as TaskId,
      tier: isMustPreserve ? ContextTier.L0_IMMUTABLE_SYSTEM : ContextTier.L1_WORKING,
      type,
      content: `Content of ${id}`,
      tokenEstimate: 100,
      importance: 0.9,
      createdAt: new Date(),
      updatedAt: new Date(),
      sourceIteration: 1,
      tags: isMustPreserve ? ['must_preserve'] : [],
      metadata: {},
      isMustPreserve,
    };
  }

  it('1. Valid context: returns valid report with no errors or warnings when within limits', () => {
    const retained = [createObj('obj-1'), createObj('obj-2')];
    const candidates = [...retained];

    const report = ContextValidator.validate(retained, candidates, modelDescriptor, budget, 2000);
    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });

  it('2. Soft limit warning: generates warning when total tokens exceed budget.softLimitTokens', () => {
    const retained = [createObj('obj-1'), createObj('obj-2')];
    const candidates = [...retained];

    const report = ContextValidator.validate(retained, candidates, modelDescriptor, budget, 3500);
    expect(report.valid).toBe(true);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain('exceeds budget soft limit');
  });

  it('3. Exceeds model limit: errors when total tokens exceed model maxContextTokens', () => {
    const retained = [createObj('obj-1')];
    const candidates = [...retained];

    const report = ContextValidator.validate(retained, candidates, modelDescriptor, budget, 9500);
    expect(report.valid).toBe(false);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('exceeds model maxContextTokens');
  });

  it('4. Invariant check: errors when candidate marked MUST-PRESERVE is omitted from retained objects', () => {
    const regularObj = createObj('regular-1', false);
    const criticalSystemObj = createObj('must-preserve-1', true, ContextObjectType.SYSTEM_PROMPT);

    // Candidate pool has criticalSystemObj, but retained pool omitted it
    const candidates = [regularObj, criticalSystemObj];
    const retained = [regularObj];

    const report = ContextValidator.validate(retained, candidates, modelDescriptor, budget, 500);
    expect(report.valid).toBe(false);
    expect(
      report.errors.some(
        (e) => e.includes('Must-preserve object') && e.includes('must-preserve-1'),
      ),
    ).toBe(true);
  });

  it('5. validateOrThrow throws HarnessError on validation failure', () => {
    const regularObj = createObj('regular-1', false);
    const criticalObj = createObj('must-preserve-1', true, ContextObjectType.GOAL_SPECIFICATION);

    expect(() => {
      ContextValidator.validateOrThrow(
        [regularObj],
        [regularObj, criticalObj],
        modelDescriptor,
        budget,
        500,
      );
    }).toThrowError(HarnessError);

    try {
      ContextValidator.validateOrThrow(
        [regularObj],
        [regularObj, criticalObj],
        modelDescriptor,
        budget,
        500,
      );
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.CONTEXT_BUDGET_EXCEEDED);
      expect(err.category).toBe(ErrorCategory.CONTEXT);
    }
  });
});
