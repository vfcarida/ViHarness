/**
 * Enterprise Readiness Integration Test Suite.
 *
 * Verifies end-to-end enterprise software engineering capabilities:
 * 1. Cryptographic HMAC audit signing and verification.
 * 2. Causal trace distillation and automated outer-loop diagnostics.
 * 3. Dynamic context budget balancing across L0-L3 tiers.
 * 4. Speculative streaming tool parsing.
 * 5. Semantic subsumption in ContextGraph.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AuditIntegritySigner,
  TraceDistiller,
  HarnessDiagnosticEngine,
  ContextBudgetBalancer,
  StreamingToolParser,
  ContextGraph,
  MetaHarnessTraceLogger,
  PrefixCachingCompiler,
  ImpactedTestSelector,
  UuidV7IdFactory,
  SystemClock,
} from '../../src/infra/index.js';
import {
  ContextTier,
  ContextObjectType,
  ContextScope,
  AgentPhase,
  MessageRole,
} from '../../src/core/index.js';

describe('Enterprise Readiness Integration Suite', () => {
  it('executes full enterprise suite integrating cryptographic audit, causal diagnosis, budget balancing, and streaming parsing', () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new SystemClock();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-ent-suite-'));

    // 1. Cryptographic Audit Signing
    const signer = new AuditIntegritySigner({ secretKey: 'enterprise-hmac-key' });
    const auditRecord = {
      action: 'DEPLOY_PATCH',
      operator: 'vi-agent',
      target: 'src/payment/gateway.ts',
      timestamp: clock.now().toISOString(),
    };
    const signedAudit = signer.sign(auditRecord);
    expect(signer.verify(signedAudit)).toBe(true);

    // 2. Dynamic Context Budget Balancing
    const planBudget = ContextBudgetBalancer.balance(16000, 'PLAN');
    expect(planBudget.allocations[ContextTier.L3_REPOSITORY].maxTokens).toBe(6400);

    const repairBudget = ContextBudgetBalancer.balance(16000, 'REPAIR');
    expect(repairBudget.allocations[ContextTier.L0_HOT].maxTokens).toBe(7200);

    // 3. Semantic Graph Subsumption
    const graph = new ContextGraph();
    const obj1 = {
      id: idFactory.create<'Context'>(),
      tier: ContextTier.L1_WORKING,
      type: ContextObjectType.OBSERVATION,
      content: 'Database connection failed: Timeout after 5000ms',
      source: 'diagnostics',
      timestamp: clock.now(),
      importance: 0.8,
      confidence: 1.0,
      scope: ContextScope.TASK,
      dependencies: [],
      lastUsed: clock.now(),
      lastVerified: clock.now(),
      costTokens: 20,
      tags: ['db_timeout'],
      version: 1,
      active: true,
      metadata: { topic: 'database' },
    };

    const obj2 = {
      id: idFactory.create<'Context'>(),
      tier: ContextTier.L1_WORKING,
      type: ContextObjectType.OBSERVATION,
      content: 'Database connection failed: Timeout after 5000ms (duplicate attempt)',
      source: 'diagnostics',
      timestamp: clock.now(),
      importance: 0.7,
      confidence: 1.0,
      scope: ContextScope.TASK,
      dependencies: [],
      lastUsed: clock.now(),
      lastVerified: clock.now(),
      costTokens: 22,
      tags: ['db_timeout'],
      version: 1,
      active: true,
      metadata: { topic: 'database' },
    };

    graph.addNode(obj1);
    graph.addNode(obj2);
    expect(graph.getAllNodes().length).toBe(2);

    const cluster = graph.clusterByTopic('database');
    expect(cluster.length).toBe(2);

    // Subsume redundant obj2 into obj1
    const subsumeSuccess = graph.subsume(obj1.id, obj2.id);
    expect(subsumeSuccess).toBe(true);
    expect(graph.getAllNodes().length).toBe(1);
    expect(graph.hasNode(obj2.id)).toBe(false);

    // 4. Streaming Tool Parser
    const parser = new StreamingToolParser();
    const states = parser.feed(
      '{"name": "write_file", "input": {"path": "src/fix.ts", "content": "export const x = 1;"}}',
    );
    expect(states[0]!.isComplete).toBe(true);
    expect(states[0]!.parsedInput).toEqual({ path: 'src/fix.ts', content: 'export const x = 1;' });

    // 5. Causal Trace Logger & Diagnostic Distillation
    const traceLogger = new MetaHarnessTraceLogger({ outputDir: tempDir, writeToDisk: true });
    const executionId = idFactory.create<'Execution'>();
    const taskId = idFactory.create<'Task'>();

    traceLogger.recordIteration({
      traceId: 'tr_ent_1',
      executionId,
      taskId,
      iterationId: idFactory.create<'Iteration'>(),
      sequenceNumber: 1,
      phaseBefore: AgentPhase.EXPLORE,
      phaseAfter: AgentPhase.DONE,
      selectedProviderId: 'openai-frontier',
      selectedModelId: 'gpt-4o',
      targetRole: 'ARCHITECT',
      promptTokens: 2500,
      completionTokens: 400,
      cachedTokens: 2000,
      totalTokens: 2900,
      costDollars: 0.012,
      messages: [{ role: MessageRole.USER, content: 'Enterprise validation task' }],
      proposedToolCalls: [{ name: 'write_file', input: { path: 'src/fix.ts' }, id: 'c_ent_1' }],
      policyDecisions: [],
      executedToolResults: [
        { toolCallId: 'c_ent_1', success: true, output: 'written', durationMs: 45 },
      ],
      evidenceCreated: [],
      durationMs: 300,
      timestamp: new Date(),
    });

    const summary = traceLogger.finalizeExecution({
      executionId,
      taskId,
      goalDescription: 'Enterprise integration task',
      success: true,
      finalPhase: AgentPhase.DONE,
      startedAt: new Date(Date.now() - 400),
      finishedAt: new Date(),
    });

    const analysis = TraceDistiller.distill(traceLogger.getTraces(executionId), summary);
    expect(analysis.cacheHitRatio).toBe(0.8);
    expect(analysis.bottleneckIdentified).toBe('NONE');

    const report = HarnessDiagnosticEngine.diagnose(traceLogger.getTraces(executionId), summary);
    expect(report.overallHealth).toBe('OPTIMAL');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
