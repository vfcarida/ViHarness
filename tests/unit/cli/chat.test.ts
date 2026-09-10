/**
 * Interactive Chat / REPL Mode Unit Tests.
 *
 * Verifies:
 * 1. CLI argument parsing (defaults, flags, options).
 * 2. Help output.
 * 3. Human-in-the-loop interactive approval tool executor.
 * 4. Slash command routing and integration.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  parseChatArgs,
  printChatHelp,
  InteractiveApprovalToolExecutor,
  runChatCli,
} from '../../../src/cli/commands/chat.js';
import { runCli } from '../../../src/cli/index.js';
import type { ToolExecutor, ToolExecutionRequest } from '../../../src/core/interfaces/tool-executor.js';
import type { ToolResult } from '../../../src/core/model/tool-types.js';
import type { Tool } from '../../../src/core/interfaces/tool.js';

describe('Vi-Harness Interactive Chat / REPL Suite', () => {
  describe('1. Argument Parsing', () => {
    it('parses default options correctly', () => {
      const parsed = parseChatArgs([]);
      expect(parsed.cwd).toBe(process.cwd());
      expect(parsed.autoApprove).toBe(false);
      expect(parsed.promptCaching).toBe(true);
      expect(parsed.maxIterationsPerTurn).toBe(15);
      expect(parsed.help).toBe(false);
    });

    it('parses custom flags and flags combinations', () => {
      const parsed = parseChatArgs([
        '--cwd',
        './test-dir',
        '-m',
        'claude-3-7-sonnet',
        '-y',
        '--no-prompt-caching',
        '--max-iterations',
        '25',
      ]);

      expect(parsed.modelId).toBe('claude-3-7-sonnet');
      expect(parsed.autoApprove).toBe(true);
      expect(parsed.promptCaching).toBe(false);
      expect(parsed.maxIterationsPerTurn).toBe(25);
    });

    it('handles help flag', () => {
      const parsed = parseChatArgs(['--help']);
      expect(parsed.help).toBe(true);
    });
  });

  describe('2. Interactive Tool Approval Permission Gate', () => {
    const mockInnerExecutor: ToolExecutor = {
      register: () => {},
      getTool: () => undefined,
      listTools: () => [],
      execute: async (req: ToolExecutionRequest): Promise<ToolResult> => ({
        success: true,
        output: `Executed ${req.toolName ?? req.tool?.definition.name}`,
        durationMs: 10,
      }),
    };

    it('bypasses permission prompt for read-only tools', async () => {
      const askPrompt = vi.fn().mockResolvedValue('n'); // If asked, would reject
      const executor = new InteractiveApprovalToolExecutor({
        inner: mockInnerExecutor,
        autoApprove: false,
        askPrompt,
      });

      const readTool: Tool = {
        definition: {
          name: 'read_file',
          description: 'Read file',
          parameters: { type: 'object', properties: {} },
        },
        execute: async () => ({ success: true, output: '', durationMs: 0 }),
      };

      const result = await executor.execute({
        tool: readTool,
        input: { path: 'src/index.ts' },
      });

      expect(result.success).toBe(true);
      expect(askPrompt).not.toHaveBeenCalled();
    });

    it('prompts user and permits execution when user confirms with "y"', async () => {
      const askPrompt = vi.fn().mockResolvedValue('y');
      const executor = new InteractiveApprovalToolExecutor({
        inner: mockInnerExecutor,
        autoApprove: false,
        askPrompt,
      });

      const writeTool: Tool = {
        definition: {
          name: 'write_file',
          description: 'Write file',
          parameters: { type: 'object', properties: {} },
        },
        execute: async () => ({ success: true, output: '', durationMs: 0 }),
      };

      const result = await executor.execute({
        tool: writeTool,
        input: { path: 'src/index.ts', content: 'test' },
      });

      expect(askPrompt).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.output).toContain('Executed write_file');
    });

    it('prompts user and denies execution when user responds with "n"', async () => {
      const askPrompt = vi.fn().mockResolvedValue('n');
      const executor = new InteractiveApprovalToolExecutor({
        inner: mockInnerExecutor,
        autoApprove: false,
        askPrompt,
      });

      const editTool: Tool = {
        definition: {
          name: 'edit_file',
          description: 'Edit file',
          parameters: { type: 'object', properties: {} },
        },
        execute: async () => ({ success: true, output: '', durationMs: 0 }),
      };

      const result = await executor.execute({
        tool: editTool,
        input: { targetFile: 'src/main.ts' },
      });

      expect(askPrompt).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain('User declined permission');
      expect(result.metadata?.['errorCode']).toBe('USER_PERMISSION_DENIED');
    });

    it('auto-approves subsequent mutating tools when user selects "always"', async () => {
      const askPrompt = vi.fn().mockResolvedValue('always');
      const executor = new InteractiveApprovalToolExecutor({
        inner: mockInnerExecutor,
        autoApprove: false,
        askPrompt,
      });

      const cmdTool: Tool = {
        definition: {
          name: 'run_command',
          description: 'Run command',
          parameters: { type: 'object', properties: {} },
        },
        execute: async () => ({ success: true, output: '', durationMs: 0 }),
      };

      // 1st call asks user
      const res1 = await executor.execute({
        tool: cmdTool,
        input: { command: 'npm test' },
      });
      expect(res1.success).toBe(true);
      expect(askPrompt).toHaveBeenCalledTimes(1);

      // 2nd call should be auto-approved without prompting
      const res2 = await executor.execute({
        tool: cmdTool,
        input: { command: 'npm run build' },
      });
      expect(res2.success).toBe(true);
      expect(askPrompt).toHaveBeenCalledTimes(1); // Not called again
    });
  });

  describe('3. CLI Integration & Help', () => {
    it('prints chat help and exits 0', async () => {
      const exitCode = await runChatCli(['--help']);
      expect(exitCode).toBe(0);
    });

    it('routes "vi-harness chat --help" through main CLI runner', async () => {
      const exitCode = await runCli(['chat', '--help']);
      expect(exitCode).toBe(0);
    });

    it('routes "vi-harness repl --help" through main CLI runner', async () => {
      const exitCode = await runCli(['repl', '--help']);
      expect(exitCode).toBe(0);
    });
  });
});
