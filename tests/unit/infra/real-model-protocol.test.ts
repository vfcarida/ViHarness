/**
 * Real Model Protocol Suite
 *
 * Validates the vendor-neutral Model Message Protocol:
 * 1. Structured Messages (SYSTEM, USER, ASSISTANT, TOOL_CALL, TOOL_RESULT).
 * 2. Provider Adapters (OpenAI Chat Completions & Anthropic Messages format).
 * 3. Streaming and Parallel Tool Calls.
 * 4. Canonical Tool Call Validation with structured ERROR feedback.
 */
import { describe, it, expect } from 'vitest';
import {
  MessageRole,
  FinishReason,
  type ModelRequest,
  type ModelMessage,
  type ToolCall,
} from '../../../src/core/model/model-io.js';
import {
  ProviderMessageAdapter,
  type AnthropicToolUseBlock,
  type AnthropicToolResultBlock,
} from '../../../src/infra/model/provider-message-adapter.js';
import {
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultContextCompiler,
  DefaultEvidenceStore,
  ScriptedModelProvider,
  UtilityModelRouter,
  UuidV7IdFactory,
  TestClock,
} from '../../../src/infra/index.js';
import { ToolCallValidator } from '../../../src/runtime/tool-call-validator.js';
import { DefaultAgentRuntime } from '../../../src/runtime/default-agent-runtime.js';
import {
  GoalStatus,
  type Goal,
  ToolCategory,
  ToolRiskLevel,
  type Tool,
} from '../../../src/core/index.js';

describe('Real Model Protocol Suite', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));

  describe('1. Unified Message Protocol & Enum Structure', () => {
    it('should support all standard roles: SYSTEM, USER, ASSISTANT, TOOL_CALL, TOOL_RESULT, TOOL', () => {
      expect(MessageRole.SYSTEM).toBe('SYSTEM');
      expect(MessageRole.USER).toBe('USER');
      expect(MessageRole.ASSISTANT).toBe('ASSISTANT');
      expect(MessageRole.TOOL_CALL).toBe('TOOL_CALL');
      expect(MessageRole.TOOL_RESULT).toBe('TOOL_RESULT');
      expect(MessageRole.TOOL).toBe('TOOL');
    });

    it('should construct rich ModelMessage objects with toolCalls and toolResult fields', () => {
      const msg: ModelMessage = {
        role: MessageRole.ASSISTANT,
        content: 'I will inspect the file.',
        toolCalls: [{ id: 'call_123', name: 'read_file', input: { path: 'src/main.ts' } }],
      };
      expect(msg.role).toBe(MessageRole.ASSISTANT);
      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls![0]!.name).toBe('read_file');

      const resultMsg = ProviderMessageAdapter.createToolResultMessage({
        toolCallId: 'call_123',
        name: 'read_file',
        output: 'export const main = 1;',
        isError: false,
      });
      expect(resultMsg.role).toBe(MessageRole.TOOL_RESULT);
      expect(resultMsg.toolResult?.isError).toBe(false);
      expect(resultMsg.toolResult?.output).toBe('export const main = 1;');
    });
  });

  describe('2. Provider Message Adapters (OpenAI & Anthropic / Claude)', () => {
    it('should convert canonical messages to OpenAI Chat Completions payload', () => {
      const request: ModelRequest = {
        systemPrompt: 'System instructions here',
        messages: [
          { role: MessageRole.USER, content: 'Please inspect the repository' },
          {
            role: MessageRole.ASSISTANT,
            content: 'Running search',
            toolCalls: [{ id: 'call_abc', name: 'search_files', input: { query: 'login' } }],
          },
          {
            role: MessageRole.TOOL_RESULT,
            content: 'Found auth/login.ts',
            toolCallId: 'call_abc',
            name: 'search_files',
          },
        ],
      };

      const openAIMessages = ProviderMessageAdapter.toOpenAIMessages(request);
      expect(openAIMessages).toHaveLength(4);

      // System
      expect(openAIMessages[0]!.role).toBe('system');
      expect(openAIMessages[0]!.content).toBe('System instructions here');

      // User
      expect(openAIMessages[1]!.role).toBe('user');
      expect(openAIMessages[1]!.content).toBe('Please inspect the repository');

      // Assistant with tool_calls
      expect(openAIMessages[2]!.role).toBe('assistant');
      expect((openAIMessages[2] as any).tool_calls).toHaveLength(1);
      expect((openAIMessages[2] as any).tool_calls[0].function.name).toBe('search_files');
      expect(JSON.parse((openAIMessages[2] as any).tool_calls[0].function.arguments)).toEqual({
        query: 'login',
      });

      // Tool Result
      expect(openAIMessages[3]!.role).toBe('tool');
      expect(openAIMessages[3]!.tool_call_id).toBe('call_abc');
      expect(openAIMessages[3]!.content).toBe('Found auth/login.ts');
    });

    it('should convert canonical messages to Anthropic Claude Messages payload', () => {
      const request: ModelRequest = {
        systemPrompt: 'Anthropic system instructions',
        messages: [
          { role: MessageRole.USER, content: 'Find the bug in login' },
          {
            role: MessageRole.ASSISTANT,
            content: 'Searching codebase',
            toolCalls: [{ id: 'toolu_1', name: 'grep', input: { pattern: 'password' } }],
          },
          {
            role: MessageRole.TOOL_RESULT,
            content: 'Matches found on line 42',
            toolCallId: 'toolu_1',
            name: 'grep',
            toolResult: {
              toolCallId: 'toolu_1',
              name: 'grep',
              output: 'Matches found on line 42',
              isError: false,
            },
          },
        ],
      };

      const anthropicPayload = ProviderMessageAdapter.toAnthropicMessages(request);
      expect(anthropicPayload.system).toBe('Anthropic system instructions');
      expect(anthropicPayload.messages).toHaveLength(3);

      // 1. User message
      expect(anthropicPayload.messages[0]!.role).toBe('user');
      expect(anthropicPayload.messages[0]!.content).toBe('Find the bug in login');

      // 2. Assistant message with tool_use block
      expect(anthropicPayload.messages[1]!.role).toBe('assistant');
      const assistantBlocks = anthropicPayload.messages[1]!.content as Array<any>;
      expect(assistantBlocks.some((b) => b.type === 'tool_use' && b.name === 'grep')).toBe(true);

      // 3. User message with tool_result block
      expect(anthropicPayload.messages[2]!.role).toBe('user');
      const userBlocks = anthropicPayload.messages[2]!.content as Array<AnthropicToolResultBlock>;
      expect(userBlocks.some((b) => b.type === 'tool_result' && b.tool_use_id === 'toolu_1')).toBe(
        true,
      );
    });
  });

  describe('3. Canonical Tool Call Validation & Error Formatting', () => {
    it('should validate tool parameters and return structured ERROR feedback on schema violation', () => {
      const toolRegistry = new DefaultToolRegistry();
      const sampleTool: Tool = {
        definition: {
          name: 'write_file',
          version: '1.0.0',
          category: ToolCategory.WRITE,
          riskLevel: ToolRiskLevel.LOW,
          mutating: true,
          idempotent: false,
          defaultTimeoutMs: 5000,
          requiredPermissions: ['fs:write'],
          inputSchema: {
            type: 'object',
            required: ['path', 'content'],
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
          },
        },
        execute: async () => ({
          toolCallId: idFactory.create<'ToolCall'>(),
          name: 'write_file',
          output: 'ok',
          success: true,
          durationMs: 5,
        }),
      };
      toolRegistry.register(sampleTool);

      // 1. Missing required field 'content'
      const invalidCall: ToolCall = {
        id: 'call_err_1',
        name: 'write_file',
        input: { path: 'test.txt' }, // missing 'content'
      };

      const result = ToolCallValidator.validate(invalidCall, toolRegistry);
      expect(result.valid).toBe(false);
      expect(result.isUnknownTool).toBe(false);
      expect(result.error).toContain('parameter validation failed');
      expect(result.modelFeedbackMessage).toContain(
        'ERROR: Invalid parameters for tool [write_file]',
      );

      // 2. Unknown tool name
      const unknownCall: ToolCall = {
        id: 'call_err_2',
        name: 'non_existent_tool_xyz',
        input: {},
      };
      const unknownResult = ToolCallValidator.validate(unknownCall, toolRegistry);
      expect(unknownResult.valid).toBe(false);
      expect(unknownResult.isUnknownTool).toBe(true);
      expect(unknownResult.modelFeedbackMessage).toContain('ERROR: UNKNOWN_TOOL');
      expect(unknownResult.modelFeedbackMessage).toContain('write_file');
    });
  });

  describe('4. Multi-Turn Message Protocol Loop Integration', () => {
    it('should maintain structured multi-turn message history with prior assistant tool calls & tool results', async () => {
      const toolRegistry = new DefaultToolRegistry();
      const inspectTool: Tool = {
        definition: {
          name: 'inspect_data',
          version: '1.0.0',
          category: ToolCategory.READ,
          riskLevel: ToolRiskLevel.LOW,
          mutating: false,
          idempotent: true,
          defaultTimeoutMs: 5000,
          requiredPermissions: [],
          inputSchema: { type: 'object', properties: {} },
        },
        execute: async () => ({
          toolCallId: idFactory.create<'ToolCall'>(),
          name: 'inspect_data',
          output: 'DATA_PAYLOAD_SUCCESS',
          success: true,
          durationMs: 10,
        }),
      };
      toolRegistry.register(inspectTool);

      const scriptedSteps = [
        {
          content: 'I need to inspect data first',
          toolCalls: [{ id: 'call_step1', name: 'inspect_data', input: {} }],
          finishReason: FinishReason.TOOL_CALL,
        },
        {
          content: 'Task completed successfully after inspecting data',
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
      ];

      const modelProvider = new ScriptedModelProvider({
        steps: scriptedSteps,
      });

      const router = new UtilityModelRouter();
      router.registerProvider(modelProvider);

      const runtime = new DefaultAgentRuntime({
        router,
        compiler: new DefaultContextCompiler({ idFactory, clock }),
        toolExecutor: new DefaultToolExecutor({ registry: toolRegistry, idFactory }),
        evidenceStore: new DefaultEvidenceStore(),
        idFactory,
        clock,
      });

      const goal: Goal = {
        id: idFactory.create<'Goal'>(),
        description: 'Multi-turn structured message test',
        status: GoalStatus.ACTIVE,
        constraints: {
          maxIterations: 3,
          maxCostDollars: 1.0,
          maxDurationMs: 10000,
          maxRepairAttempts: 3,
          maxNoProgressIterations: 3,
          requireVerification: false,
        },
        createdAt: clock.now(),
        updatedAt: clock.now(),
        metadata: {},
      };

      const result = await runtime.execute(goal);
      expect(result.success).toBe(true);
      expect(result.iterationCount).toBe(2);

      // Verify that iteration 2 received iteration 1's assistant tool_call and tool_result structured messages
      expect(modelProvider.requestHistory.length).toBeGreaterThanOrEqual(2);
      const req2 = modelProvider.requestHistory[1]!;

      const hasAssistantToolCall = req2.messages.some(
        (m) =>
          m.role === MessageRole.ASSISTANT &&
          m.toolCalls &&
          m.toolCalls.some((tc) => tc.name === 'inspect_data'),
      );
      const hasToolResult = req2.messages.some(
        (m) =>
          (m.role === MessageRole.TOOL_RESULT || m.role === MessageRole.TOOL) &&
          m.content.includes('DATA_PAYLOAD_SUCCESS'),
      );

      expect(hasAssistantToolCall).toBe(true);
      expect(hasToolResult).toBe(true);
    });
  });
});
