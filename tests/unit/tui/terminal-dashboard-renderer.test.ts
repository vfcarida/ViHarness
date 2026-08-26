/**
 * Terminal UI (TUI) Dashboard Renderer Unit Tests.
 *
 * Verifies phase pipeline formatting, four-tier context budget meters,
 * token accounting, tool execution table, and anomaly status display.
 */
import { describe, it, expect } from 'vitest';
import { TerminalDashboardRenderer, ContextBudgetBalancer } from '../../../src/infra/index.js';
import { AgentPhase, ContextTier } from '../../../src/core/index.js';

describe('TerminalDashboardRenderer', () => {
  it('renders a complete structured dashboard string with all gauges and telemetry', () => {
    const budget = ContextBudgetBalancer.balance(10000, AgentPhase.IMPLEMENT);

    const dashboardStr = TerminalDashboardRenderer.render({
      executionId: 'exec_test_123456789',
      taskId: 'task_abc_999',
      currentPhase: AgentPhase.IMPLEMENT,
      sequenceNumber: 4,
      modelId: 'gpt-4o',
      providerId: 'openai',
      promptTokens: 4200,
      completionTokens: 350,
      cachedTokens: 2100, // 50% hit ratio
      costDollars: 0.015,
      contextBudget: budget,
      currentTierUsage: {
        [ContextTier.L0_HOT]: 2000,
        [ContextTier.L1_WORKING]: 1000,
        [ContextTier.L2_EPISODIC]: 500,
        [ContextTier.L3_REPOSITORY]: 1200,
      },
      recentTools: [
        { name: 'read_file', status: 'SUCCESS', durationMs: 45 },
        { name: 'write_file', status: 'SUCCESS', durationMs: 60 },
      ],
      loopFingerprint: {
        stateHash: 'a1b2c3d4e5f67890abcdef1234567890',
        stagnationCount: 0,
        isOscillating: false,
      },
    });

    expect(dashboardStr).toContain('VI-HARNESS AGENTIC DASHBOARD');
    expect(dashboardStr).toContain('[>> IMPLEMENT <<]');
    expect(dashboardStr).toContain('L0_HOT');
    expect(dashboardStr).toContain('L3_REPOSITORY');
    expect(dashboardStr).toContain('Cache Hit: 50%');
    expect(dashboardStr).toContain('$0.0150 USD');
    expect(dashboardStr).toContain('read_file');
    expect(dashboardStr).toContain('Health: ✓ NOMINAL');
  });
});
