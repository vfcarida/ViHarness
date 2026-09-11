import { describe, it, expect } from 'vitest';
import {
  TddEnforcer,
  TddPhase,
} from '../../../src/infra/verification/tdd-enforcer.js';
import { parseSolveArgs } from '../../../src/cli/commands/solve.js';

describe('TddEnforcer K-Pass Flakiness & Determinism Verification Gate', () => {
  it('defaults to kPass=1 for backward-compatible single pass behavior', () => {
    const enforcer = new TddEnforcer();
    expect(enforcer.kPass).toBe(1);
    expect(enforcer.currentConsecutivePasses).toBe(0);
    expect(enforcer.isFlaky).toBe(false);

    // Red phase
    enforcer.recordAction({
      toolName: 'run_command',
      command: 'pytest tests/test_repro.py',
      exitCode: 1,
      output: 'FAILED - AssertionError',
    });
    expect(enforcer.currentPhase).toBe(TddPhase.REPRODUCER_CONFIRMED);

    // Green phase
    enforcer.recordAction({
      toolName: 'run_command',
      command: 'pytest tests/test_repro.py',
      exitCode: 0,
      output: '1 passed in 0.01s',
    });
    expect(enforcer.currentPhase).toBe(TddPhase.FIX_VERIFIED);
    expect(enforcer.evaluateCompletion().allowedToComplete).toBe(true);
  });

  it('enforces K consecutive passes before allowing completion (kPass=3)', () => {
    const enforcer = new TddEnforcer({ kPassRepeats: 3 });
    expect(enforcer.kPass).toBe(3);

    // Red phase
    enforcer.recordAction({
      toolName: 'run_command',
      command: 'npm test -- repro.test.ts',
      exitCode: 1,
      output: 'FAIL: Expected truthy got falsy',
    });
    expect(enforcer.currentPhase).toBe(TddPhase.REPRODUCER_CONFIRMED);

    // First pass (1/3)
    enforcer.recordAction({
      toolName: 'run_command',
      command: 'npm test -- repro.test.ts',
      exitCode: 0,
      output: 'PASS: 1 passed',
    });
    expect(enforcer.currentPhase).toBe(TddPhase.REPRODUCER_CONFIRMED);
    expect(enforcer.currentConsecutivePasses).toBe(1);
    let evalRes = enforcer.evaluateCompletion();
    expect(evalRes.allowedToComplete).toBe(false);
    expect(evalRes.feedbackMessage).toContain('Reproduction test passed 1/3 required consecutive run(s)');
    expect(evalRes.feedbackMessage).toContain('2 more time(s)');

    // Second pass (2/3)
    enforcer.recordAction({
      toolName: 'run_command',
      command: 'npm test -- repro.test.ts',
      exitCode: 0,
      output: 'PASS: 1 passed',
    });
    expect(enforcer.currentPhase).toBe(TddPhase.REPRODUCER_CONFIRMED);
    expect(enforcer.currentConsecutivePasses).toBe(2);
    evalRes = enforcer.evaluateCompletion();
    expect(evalRes.allowedToComplete).toBe(false);
    expect(evalRes.feedbackMessage).toContain('Reproduction test passed 2/3 required consecutive run(s)');
    expect(evalRes.feedbackMessage).toContain('1 more time(s)');

    // Third pass (3/3) -> FIX_VERIFIED!
    enforcer.recordAction({
      toolName: 'run_command',
      command: 'npm test -- repro.test.ts',
      exitCode: 0,
      output: 'PASS: 1 passed',
    });
    expect(enforcer.currentPhase).toBe(TddPhase.FIX_VERIFIED);
    expect(enforcer.currentConsecutivePasses).toBe(3);
    evalRes = enforcer.evaluateCompletion();
    expect(evalRes.allowedToComplete).toBe(true);
    expect(evalRes.phase).toBe(TddPhase.FIX_VERIFIED);
    expect(evalRes.consecutivePasses).toBe(3);
    expect(evalRes.requiredPasses).toBe(3);
  });

  it('detects flakiness and resets consecutive passes when an intermittent failure occurs', () => {
    const enforcer = new TddEnforcer({ kPassRepeats: 3 });

    // Red phase
    enforcer.recordAction({
      toolName: 'run_command',
      command: 'pytest tests/test_repro.py',
      exitCode: 1,
      output: 'FAILED',
    });

    // Pass 1 (1/3)
    enforcer.recordAction({
      toolName: 'run_command',
      command: 'pytest tests/test_repro.py',
      exitCode: 0,
      output: '1 passed',
    });
    expect(enforcer.currentConsecutivePasses).toBe(1);
    expect(enforcer.isFlaky).toBe(false);

    // Flaky failure on run 2!
    enforcer.recordAction({
      toolName: 'run_command',
      command: 'pytest tests/test_repro.py',
      exitCode: 1,
      output: 'FAILED - Race condition',
    });

    expect(enforcer.isFlaky).toBe(true);
    expect(enforcer.currentConsecutivePasses).toBe(0);
    expect(enforcer.currentPhase).toBe(TddPhase.REPRODUCER_CONFIRMED);

    const evalRes = enforcer.evaluateCompletion();
    expect(evalRes.allowedToComplete).toBe(false);
    expect(evalRes.flakinessDetected).toBe(true);
    expect(evalRes.feedbackMessage).toContain('[TDD-Agent Enforcer Flakiness Alert]');
    expect(evalRes.feedbackMessage).toContain('Test flakiness or intermittent failure detected');

    // Agent fixes race condition and achieves 3 consecutive passes
    for (let i = 1; i <= 3; i++) {
      enforcer.recordAction({
        toolName: 'run_command',
        command: 'pytest tests/test_repro.py',
        exitCode: 0,
        output: '1 passed',
      });
      expect(enforcer.currentConsecutivePasses).toBe(i);
    }

    expect(enforcer.currentPhase).toBe(TddPhase.FIX_VERIFIED);
    expect(enforcer.evaluateCompletion().allowedToComplete).toBe(true);
  });

  it('catches post-verification regressions and revokes FIX_VERIFIED', () => {
    const enforcer = new TddEnforcer({ kPassRepeats: 2 });

    // Red
    enforcer.recordAction({
      toolName: 'run_command',
      command: 'python repro.py',
      exitCode: 1,
    });

    // Green (2 passes)
    enforcer.recordAction({ toolName: 'run_command', command: 'python repro.py', exitCode: 0 });
    enforcer.recordAction({ toolName: 'run_command', command: 'python repro.py', exitCode: 0 });
    expect(enforcer.currentPhase).toBe(TddPhase.FIX_VERIFIED);

    // Subsequent run breaks
    enforcer.recordAction({
      toolName: 'run_command',
      command: 'python repro.py',
      exitCode: 1,
      output: 'FAILED',
    });

    expect(enforcer.currentPhase).toBe(TddPhase.REPRODUCER_CONFIRMED);
    expect(enforcer.isFlaky).toBe(true);
    expect(enforcer.evaluateCompletion().allowedToComplete).toBe(false);
  });

  it('includes K-Pass contract requirements when kPassRepeats > 1', () => {
    const singleContract = TddEnforcer.getGuidanceContract(1);
    expect(singleContract).toContain('It MUST now PASS with exit code 0.');

    const kPassContract = TddEnforcer.getGuidanceContract(3);
    expect(kPassContract).toContain('It MUST pass cleanly 3 consecutive times with exit code 0 to eliminate flakiness');
  });

  it('parses --tdd-k-pass CLI flag properly in solve command', () => {
    const parsed = parseSolveArgs(['-p', 'fix bug', '--tdd', '--tdd-k-pass', '4']);
    expect(parsed.tdd).toBe(true);
    expect(parsed.tddKPass).toBe(4);
  });
});
