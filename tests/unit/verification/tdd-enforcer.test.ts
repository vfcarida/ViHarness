import { describe, it, expect } from 'vitest';
import {
  TddEnforcer,
  TddPhase,
} from '../../../src/infra/verification/tdd-enforcer.js';

describe('TddEnforcer (Autonomous Red-Green TDD Watchdog)', () => {
  it('starts in INITIAL phase and rejects premature completion before reproduction', () => {
    const enforcer = new TddEnforcer();

    expect(enforcer.currentPhase).toBe(TddPhase.INITIAL);

    const evalResult = enforcer.evaluateCompletion();
    expect(evalResult.allowedToComplete).toBe(false);
    expect(evalResult.phase).toBe(TddPhase.INITIAL);
    expect(evalResult.feedbackMessage).toContain('[TDD-Agent Enforcer Notice]');
    expect(evalResult.feedbackMessage).toContain('You MUST first create or run a reproduction script');
  });

  it('transitions to REPRODUCER_CONFIRMED when a reproducer test fails initially (Red phase)', () => {
    const enforcer = new TddEnforcer();

    // Agent executes a reproduction test which fails
    enforcer.recordAction({
      toolName: 'run_command',
      command: 'python repro_issue_42.py',
      exitCode: 1,
      output: 'AssertionError: expected value 100 but got 0',
    });

    expect(enforcer.currentPhase).toBe(TddPhase.REPRODUCER_CONFIRMED);
    expect(enforcer.lastReproCommand).toBe('python repro_issue_42.py');

    // Attempting to complete immediately after reproducer fails is still rejected (fix not verified)
    const evalResult = enforcer.evaluateCompletion();
    expect(evalResult.allowedToComplete).toBe(false);
    expect(evalResult.phase).toBe(TddPhase.REPRODUCER_CONFIRMED);
    expect(evalResult.feedbackMessage).toContain('Reproduction test was confirmed failing');
    expect(evalResult.feedbackMessage).toContain('not yet been verified to PASS');
  });

  it('transitions to FIX_VERIFIED and permits completion when reproducer subsequently passes (Green phase)', () => {
    const enforcer = new TddEnforcer();

    // 1. Red phase: reproduction script fails
    enforcer.recordAction({
      toolName: 'run_command',
      command: 'pytest tests/test_repro.py',
      exitCode: 1,
      output: 'FAILED tests/test_repro.py::test_repro - AssertionError',
    });
    expect(enforcer.currentPhase).toBe(TddPhase.REPRODUCER_CONFIRMED);

    // 2. Edit phase: agent fixes production code
    enforcer.recordAction({
      toolName: 'edit_file',
      filePath: 'src/calculator.py',
    });

    // 3. Green phase: reproducer re-executed and now succeeds
    enforcer.recordAction({
      toolName: 'run_command',
      command: 'pytest tests/test_repro.py',
      exitCode: 0,
      output: '1 passed in 0.05s',
    });

    expect(enforcer.currentPhase).toBe(TddPhase.FIX_VERIFIED);

    const evalResult = enforcer.evaluateCompletion();
    expect(evalResult.allowedToComplete).toBe(true);
    expect(evalResult.phase).toBe(TddPhase.FIX_VERIFIED);
    expect(evalResult.feedbackMessage).toBeUndefined();
    expect(evalResult.reproCommand).toBe('pytest tests/test_repro.py');
  });

  it('ignores non-test commands like ls or cat', () => {
    const enforcer = new TddEnforcer();

    enforcer.recordAction({
      toolName: 'run_command',
      command: 'ls -la',
      exitCode: 0,
      output: 'file1.txt file2.txt',
    });

    expect(enforcer.currentPhase).toBe(TddPhase.INITIAL);
  });

  it('provides comprehensive TDD contract guidance for task prompts', () => {
    const contract = TddEnforcer.getGuidanceContract();
    expect(contract).toContain('[AUTONOMOUS TEST-DRIVEN DEVELOPMENT (TDD) CONTRACT]');
    expect(contract).toContain('Step 1 (Reproduce / RED)');
    expect(contract).toContain('Step 2 (Fix / GREEN)');
    expect(contract).toContain('Step 3 (Verify)');
    expect(contract).toContain('Step 4 (Regression)');
  });
});
