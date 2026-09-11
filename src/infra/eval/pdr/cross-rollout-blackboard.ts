/**
 * Cross-Rollout Shared Intelligence Blackboard.
 *
 * Maintains shared memory across parallel/sequential speculative rollouts (Parallel-Distill-Refine).
 * Prevents redundant exploration of failed hypotheses and synthesizes collective intelligence.
 */
import type { RolloutFinding, BlackboardReport } from './types.js';

export class CrossRolloutBlackboard {
  private readonly findings: RolloutFinding[] = [];

  /**
   * Records a distilled finding from a completed speculative rollout.
   */
  recordFinding(finding: RolloutFinding): void {
    this.findings.push(finding);
  }

  /**
   * Retrieves all recorded rollout findings.
   */
  getFindings(): ReadonlyArray<RolloutFinding> {
    return [...this.findings];
  }

  /**
   * Generates a concise guidance prompt for subsequent rollouts.
   */
  formatGuidancePrompt(): string {
    if (this.findings.length === 0) {
      return '';
    }

    const sections: string[] = [
      '\n[CROSS-ROLLOUT COLLECTIVE INTELLIGENCE (Parallel-Distill-Refine)]:',
      'Previous speculative rollouts on this exact task revealed the following distilled findings:',
    ];

    for (const finding of this.findings) {
      const statusIcon = finding.success ? '✅' : '❌';
      sections.push(
        `\n• Rollout #${finding.rolloutIndex} (${statusIcon} Pass Rate: ${(finding.testPassRate * 100).toFixed(0)}%):`,
      );

      if (finding.errorSnippets.length > 0) {
        sections.push(
          `  - Encountered Error Roots: ${finding.errorSnippets.slice(0, 3).map((e) => `"${e}"`).join(', ')}`,
        );
      }

      if (finding.failedCommands.length > 0) {
        sections.push(
          `  - Failed Command(s): ${finding.failedCommands.slice(0, 2).map((c) => `\`${c}\``).join(', ')}`,
        );
      }

      if (finding.modifiedFiles.length > 0) {
        sections.push(
          `  - Files Attempted: ${finding.modifiedFiles.slice(0, 4).join(', ')}`,
        );
      }

      if (finding.compilerWarnings > 0) {
        sections.push(
          `  - Compiler Warning Penalty: ${finding.compilerWarnings} warning(s) emitted. Ensure strict -Werror clean code.`,
        );
      }
    }

    sections.push(
      '\nDirective: Condition your approach on these prior discoveries. Avoid repeating dead ends, resolve identified root causes, and preserve non-broken functionality.',
    );

    return sections.join('\n');
  }

  /**
   * Generates a structured report of all findings.
   */
  getReport(): BlackboardReport {
    return {
      totalRolloutsRecorded: this.findings.length,
      findings: this.getFindings(),
      injectedGuidance: this.formatGuidancePrompt(),
    };
  }

  /**
   * Resets the blackboard for a new task session.
   */
  clear(): void {
    this.findings.length = 0;
  }
}
