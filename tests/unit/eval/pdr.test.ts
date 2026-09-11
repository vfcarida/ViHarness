import { describe, it, expect } from 'vitest';
import {
  CrossRolloutBlackboard,
  RolloutDistiller,
  type RolloutFinding,
} from '../../../src/infra/eval/pdr/index.js';

describe('Parallel-Distill-Refine (PDR) Cross-Rollout Intelligence', () => {
  it('distills tool results and command outcomes into a structured finding', () => {
    const finding = RolloutDistiller.distill({
      rolloutIndex: 1,
      workspacePath: '/tmp/rollout-1',
      success: false,
      toolResults: [
        {
          toolName: 'edit_file',
          filePath: 'src/calculator.py',
        },
        {
          toolName: 'run_command',
          command: 'pytest tests/test_calc.py',
          exitCode: 1,
          output:
            'FAILED tests/test_calc.py::test_div\nAssertionError: expected 5 but got ZeroDivisionError\nwarning: deprecated feature used',
        },
        {
          toolName: 'run_command',
          command: 'pytest tests/test_add.py',
          exitCode: 0,
          output: '1 passed in 0.02s',
        },
      ],
    });

    expect(finding.rolloutIndex).toBe(1);
    expect(finding.success).toBe(false);
    expect(finding.modifiedFiles).toContain('src/calculator.py');
    expect(finding.failedCommands).toContain('pytest tests/test_calc.py');
    expect(finding.errorSnippets.some((e) => e.includes('AssertionError'))).toBe(true);
    expect(finding.compilerWarnings).toBe(1);
    expect(finding.testPassRate).toBe(0.5); // 1 pass out of 2 test attempts
    expect(finding.distilledSummary).toContain('Rollout #1 encountered failures');
  });

  it('handles empty tool results gracefully', () => {
    const finding = RolloutDistiller.distill({
      rolloutIndex: 2,
      workspacePath: '/tmp/rollout-2',
      success: true,
    });

    expect(finding.rolloutIndex).toBe(2);
    expect(finding.success).toBe(true);
    expect(finding.failedCommands).toEqual([]);
    expect(finding.errorSnippets).toEqual([]);
    expect(finding.testPassRate).toBe(1.0);
    expect(finding.distilledSummary).toContain('100% test pass rate');
  });

  it('CrossRolloutBlackboard aggregates findings and formats guidance prompt', () => {
    const blackboard = new CrossRolloutBlackboard();
    expect(blackboard.formatGuidancePrompt()).toBe('');

    const finding1: RolloutFinding = {
      rolloutIndex: 1,
      workspacePath: '/worktrees/rollout-1',
      success: false,
      failedCommands: ['python -m unittest tests.test_auth'],
      errorSnippets: ['TypeError: Cannot read properties of undefined'],
      modifiedFiles: ['src/auth/jwt.ts'],
      compilerWarnings: 2,
      testPassRate: 0.2,
      distilledSummary: 'Auth tokens rejected.',
    };

    blackboard.recordFinding(finding1);
    expect(blackboard.getFindings()).toHaveLength(1);

    const prompt = blackboard.formatGuidancePrompt();
    expect(prompt).toContain('[CROSS-ROLLOUT COLLECTIVE INTELLIGENCE (Parallel-Distill-Refine)]');
    expect(prompt).toContain('Rollout #1');
    expect(prompt).toContain('Pass Rate: 20%');
    expect(prompt).toContain('TypeError: Cannot read properties of undefined');
    expect(prompt).toContain('`python -m unittest tests.test_auth`');
    expect(prompt).toContain('src/auth/jwt.ts');
    expect(prompt).toContain('Compiler Warning Penalty: 2 warning(s) emitted');

    const report = blackboard.getReport();
    expect(report.totalRolloutsRecorded).toBe(1);
    expect(report.injectedGuidance).toBe(prompt);

    blackboard.clear();
    expect(blackboard.getFindings()).toHaveLength(0);
    expect(blackboard.formatGuidancePrompt()).toBe('');
  });
});
