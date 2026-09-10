import { describe, it, expect } from 'vitest';
import {
  SwePruner,
} from '../../../src/infra/compiler/swe-pruner.js';
import {
  ActionResultStatus,
  type ActionResult,
} from '../../../src/core/model/action.js';

describe('SwePruner (Temporal Tool Result Compaction)', () => {
  const pruner = new SwePruner({
    recentIterationsToKeepFull: 1,
    minCharThreshold: 300,
  });

  it('keeps recent iterations (N and N-1) completely uncompacted', () => {
    const largeOutput = 'line of code\n'.repeat(50); // > 500 chars

    const actionResult: ActionResult = {
      actionId: 'act-1',
      status: ActionResultStatus.SUCCESS,
      output: largeOutput,
      metadata: { toolName: 'read_file', path: 'src/app.ts' },
    };

    // Iteration 5 when current is 5 (current turn)
    expect(pruner.shouldCompact(5, 5, actionResult)).toBe(false);

    // Iteration 4 when current is 5 (immediately preceding turn)
    expect(pruner.shouldCompact(4, 5, actionResult)).toBe(false);
  });

  it('compacts older iterations (< N-1) when output exceeds character threshold and succeeded', () => {
    const largeOutput = 'code line item;\n'.repeat(40); // > 600 chars

    const actionResult: ActionResult = {
      actionId: 'act-old',
      status: ActionResultStatus.SUCCESS,
      output: largeOutput,
      metadata: { toolName: 'read_file', path: 'src/parser.ts' },
    };

    // Iteration 2 when current is 5 (age is 3 > recentIterationsToKeepFull 1)
    expect(pruner.shouldCompact(2, 5, actionResult)).toBe(true);

    const compacted = pruner.compactOutput(actionResult);
    expect(compacted).toContain('[Compacted read_file of \'src/parser.ts\'');
    expect(compacted).toContain('successfully inspected in earlier iteration');
    expect(compacted.length).toBeLessThan(180);
  });

  it('NEVER compacts failing tool results or error messages, preserving error memory intact', () => {
    const largeErrorOutput = 'Compiler Error:\n'.repeat(30) + 'undefined reference to symbol';

    const failedResult: ActionResult = {
      actionId: 'act-fail',
      status: ActionResultStatus.FAILURE,
      output: largeErrorOutput,
      error: 'COMPILATION_FAILED',
      metadata: { toolName: 'run_command', command: 'g++ main.cpp' },
    };

    // Even if from 10 iterations ago, errors must NEVER be compacted
    expect(pruner.shouldCompact(1, 10, failedResult)).toBe(false);

    const processed = SwePruner.processPriorToolResult({
      iterationSeq: 1,
      currentSeq: 10,
      actionResult: failedResult,
    });
    expect(processed.wasCompacted).toBe(false);
    expect(processed.output).toContain('undefined reference to symbol');
  });

  it('preserves small tool outputs below minCharThreshold without compacting', () => {
    const smallOutput = 'file created successfully';

    const smallResult: ActionResult = {
      actionId: 'act-small',
      status: ActionResultStatus.SUCCESS,
      output: smallOutput,
      metadata: { toolName: 'write_file', path: 'temp.txt' },
    };

    expect(pruner.shouldCompact(1, 8, smallResult)).toBe(false);
  });

  it('formats compact summaries accurately across different tools (list_directory, run_command, edit_file)', () => {
    const listResult: ActionResult = {
      actionId: 'act-list',
      status: ActionResultStatus.SUCCESS,
      output: 'file_entry.txt\n'.repeat(40),
      metadata: { toolName: 'list_directory', path: 'src/components' },
    };
    expect(pruner.compactOutput(listResult)).toContain('[Compacted list_directory for \'src/components\'');

    const cmdResult: ActionResult = {
      actionId: 'act-cmd',
      status: ActionResultStatus.SUCCESS,
      output: 'Build target successful\n'.repeat(30),
      metadata: { toolName: 'run_command', command: 'cmake --build build' },
    };
    expect(pruner.compactOutput(cmdResult)).toContain('[Compacted run_command \'cmake --build build\': command succeeded');

    const editResult: ActionResult = {
      actionId: 'act-edit',
      status: ActionResultStatus.SUCCESS,
      output: 'Replaced lines successfully\n'.repeat(30),
      metadata: { toolName: 'edit_file', targetFile: 'src/index.ts' },
    };
    expect(pruner.compactOutput(editResult)).toContain('[Compacted edit_file: modifications to \'src/index.ts\' applied successfully');
  });
});
