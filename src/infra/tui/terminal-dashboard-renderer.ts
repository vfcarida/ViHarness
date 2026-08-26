/**
 * Terminal UI (TUI) Dashboard Renderer.
 *
 * Formats a clean, high-density ASCII/ANSI dashboard for real-time monitoring of agent execution:
 * - Active State Machine Phase & Transition Progress
 * - Four-Tier Context Budget (L0-L3) visual meters
 * - Token expenditure, cache hit ratio, and financial cost counter
 * - Recent tool executions, policy decisions, and verification evidence
 * - Loop fingerprinter state and anomaly status
 */
import { AgentPhase } from '../../core/model/state.js';
import { ContextTier } from '../../core/model/context.js';
import type { BalancedContextBudget } from '../compiler/context-budget-balancer.js';

export interface DashboardState {
  readonly executionId: string;
  readonly taskId: string;
  readonly currentPhase: AgentPhase | string;
  readonly sequenceNumber: number;
  readonly modelId: string;
  readonly providerId: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cachedTokens: number;
  readonly costDollars: number;
  readonly contextBudget?: BalancedContextBudget;
  readonly currentTierUsage?: Record<ContextTier, number>;
  readonly recentTools?: ReadonlyArray<{
    readonly name: string;
    readonly status: 'SUCCESS' | 'FAILURE' | 'DENIED' | 'PENDING';
    readonly durationMs: number;
  }>;
  readonly loopFingerprint?: {
    readonly stateHash: string;
    readonly stagnationCount: number;
    readonly isOscillating: boolean;
  };
}

export class TerminalDashboardRenderer {
  /**
   * Render complete formatted dashboard string for console output.
   */
  static render(state: DashboardState): string {
    const lines: string[] = [];
    const width = 76;
    const separator = '='.repeat(width);
    const subseparator = '-'.repeat(width);

    // 1. Header
    lines.push(separator);
    lines.push(
      ` VI-HARNESS AGENTIC DASHBOARD | Exec: ${state.executionId.slice(0, 12)} | Turn: #${state.sequenceNumber}`,
    );
    lines.push(` Model: ${state.providerId}/${state.modelId} | Phase: [${state.currentPhase}]`);
    lines.push(subseparator);

    // 2. Phase Track
    const phases = [
      AgentPhase.EXPLORE,
      AgentPhase.PLAN,
      AgentPhase.IMPLEMENT,
      AgentPhase.VERIFY,
      AgentPhase.DONE,
    ];
    const phaseTrack = phases
      .map((p) => (p === state.currentPhase ? `[>> ${p} <<]` : ` ${p} `))
      .join(' -> ');
    lines.push(` Phase Pipeline: ${phaseTrack}`);
    lines.push(subseparator);

    // 3. Four-Tier Context Budget Meters
    lines.push(' Context Hierarchy Allocations (L0 - L3):');
    if (state.contextBudget && state.currentTierUsage) {
      for (const tier of [
        ContextTier.L0_HOT,
        ContextTier.L1_WORKING,
        ContextTier.L2_EPISODIC,
        ContextTier.L3_REPOSITORY,
      ]) {
        const alloc = state.contextBudget.allocations[tier];
        const used = state.currentTierUsage[tier] ?? 0;
        const max = alloc?.maxTokens ?? 1000;
        const pct = Math.min(100, Math.round((used / Math.max(1, max)) * 100));
        const bar = this.renderProgressBar(pct, 20);
        lines.push(
          `   ${tier.padEnd(16)}: ${bar} ${String(pct).padStart(3)}% (${used}/${max} tokens)`,
        );
      }
    } else {
      lines.push('   (Dynamic context budget balancing active)');
    }
    lines.push(subseparator);

    // 4. Token & Financial Telemetry
    const totalTokens = state.promptTokens + state.completionTokens;
    const cacheHitPct =
      state.promptTokens > 0 ? Math.round((state.cachedTokens / state.promptTokens) * 100) : 0;
    lines.push(
      ` Telemetry: Tokens: ${totalTokens.toLocaleString()} (Prompt: ${state.promptTokens.toLocaleString()} | Output: ${state.completionTokens.toLocaleString()} | Cache Hit: ${cacheHitPct}%)`,
    );
    lines.push(` Cost Accrued: $${state.costDollars.toFixed(4)} USD`);
    lines.push(subseparator);

    // 5. Tool Activity
    if (state.recentTools && state.recentTools.length > 0) {
      lines.push(' Recent Tool Executions:');
      for (const t of state.recentTools.slice(-3)) {
        const icon = t.status === 'SUCCESS' ? '✓' : t.status === 'DENIED' ? '🚫' : '✗';
        lines.push(`   ${icon} [${t.status}] ${t.name.padEnd(20)} (${t.durationMs}ms)`);
      }
      lines.push(subseparator);
    }

    // 6. Anomaly & Fingerprint Monitor
    if (state.loopFingerprint) {
      const anomalyText = state.loopFingerprint.isOscillating
        ? '⚠️  OSCILLATION DETECTED'
        : state.loopFingerprint.stagnationCount > 1
          ? `⚠️  STAGNATION (Step ${state.loopFingerprint.stagnationCount})`
          : '✓ NOMINAL';
      lines.push(
        ` State Hash: ${state.loopFingerprint.stateHash.slice(0, 16)}... | Health: ${anomalyText}`,
      );
      lines.push(separator);
    } else {
      lines.push(separator);
    }

    return lines.join('\n');
  }

  private static renderProgressBar(percent: number, length: number): string {
    const filledLength = Math.max(0, Math.min(length, Math.round((percent / 100) * length)));
    const emptyLength = length - filledLength;
    return `[${'#'.repeat(filledLength)}${'-'.repeat(emptyLength)}]`;
  }
}
