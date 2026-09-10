import { describe, it, expect, vi } from 'vitest';
import {
  BedrockConverseProvider,
  signBedrockRequest,
} from '../../../src/infra/model/bedrock-provider.js';
import {
  MessageRole,
  FinishReason,
  ProviderHealthStatus,
  type ModelRequest,
} from '../../../src/core/model/model-io.js';
import { ErrorCode } from '../../../src/core/errors/error-codes.js';

describe('AWS Bedrock Converse Model Provider', () => {
  describe('AWS SigV4 Signing (signBedrockRequest)', () => {
    it('generates standard AWS4-HMAC-SHA256 authorization headers', () => {
      const url = new URL('https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-5-sonnet-20241022-v2:0/converse');
      const body = JSON.stringify({ messages: [{ role: 'user', content: [{ text: 'ping' }] }] });

      const headers = signBedrockRequest({
        method: 'POST',
        url,
        body,
        region: 'us-east-1',
        service: 'bedrock',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      });

      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-Amz-Date']).toMatch(/^\d{8}T\d{6}Z$/);
      expect(headers['Authorization']).toContain('AWS4-HMAC-SHA256');
      expect(headers['Authorization']).toContain('Credential=AKIAIOSFODNN7EXAMPLE/');
      expect(headers['Authorization']).toContain('/us-east-1/bedrock/aws4_request');
      expect(headers['Authorization']).toContain('SignedHeaders=content-type;host;x-amz-date');
      expect(headers['Authorization']).toContain('Signature=');
    });

    it('includes session token when provided for temporary credentials (STS / IAM Roles)', () => {
      const url = new URL('https://bedrock-runtime.us-west-2.amazonaws.com/model/amazon.nova-pro-v1:0/converse');
      const body = '{}';

      const headers = signBedrockRequest({
        method: 'POST',
        url,
        body,
        region: 'us-west-2',
        service: 'bedrock',
        accessKeyId: 'ASIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        sessionToken: 'FwoGZXIvYXdzEBcaDEXAMPLETOKEN',
      });

      expect(headers['X-Amz-Security-Token']).toBe('FwoGZXIvYXdzEBcaDEXAMPLETOKEN');
      expect(headers['Authorization']).toContain('x-amz-security-token');
    });
  });

  describe('Converse API Request & Response Lifecycle', () => {
    it('successfully executes a conversation and parses text response', async () => {
      let capturedBody: any = null;
      let capturedHeaders: any = null;

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async (_url, init) => {
        capturedBody = JSON.parse(init.body as string);
        capturedHeaders = init.headers;

        return {
          ok: true,
          status: 200,
          json: async () => ({
            output: {
              message: {
                role: 'assistant',
                content: [{ text: 'The answer is 42.' }],
              },
            },
            stopReason: 'end_turn',
            usage: {
              inputTokens: 25,
              outputTokens: 8,
              totalTokens: 33,
            },
            metrics: {
              latencyMs: 340,
            },
          }),
        } as any;
      });

      const provider = new BedrockConverseProvider({
        region: 'us-east-1',
        accessKeyId: 'AKIA_TEST',
        secretAccessKey: 'SECRET_TEST',
        customFetch: mockFetch,
      });

      const request: ModelRequest = {
        messages: [
          { role: MessageRole.SYSTEM, content: 'You are a helpful assistant.' },
          { role: MessageRole.USER, content: 'What is the answer?' },
        ],
        temperature: 0.2,
      };

      const response = await provider.complete(request);

      expect(response.content).toBe('The answer is 42.');
      expect(response.finishReason).toBe(FinishReason.STOP);
      expect(response.usage.inputTokens).toBe(25);
      expect(response.usage.outputTokens).toBe(8);
      expect(response.latencyMs).toBe(340);
      expect(response.toolCalls).toHaveLength(0);

      // Verify request payload conversion
      expect(capturedBody.system).toEqual([{ text: 'You are a helpful assistant.' }]);
      expect(capturedBody.messages).toEqual([
        { role: 'user', content: [{ text: 'What is the answer?' }] },
      ]);
      expect(capturedBody.inferenceConfig.temperature).toBe(0.2);
      expect(capturedHeaders['Authorization']).toContain('AWS4-HMAC-SHA256');
    });

    it('parses tool calls and sends tool results', async () => {
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            output: {
              message: {
                role: 'assistant',
                content: [
                  { text: 'I will inspect the file.' },
                  {
                    toolUse: {
                      toolUseId: 'call_12345',
                      name: 'read_file',
                      input: { path: 'src/index.ts' },
                    },
                  },
                ],
              },
            },
            stopReason: 'tool_use',
            usage: { inputTokens: 50, outputTokens: 30 },
          }),
        } as any;
      });

      const provider = new BedrockConverseProvider({
        apiKey: 'custom-bearer-token',
        baseUrl: 'https://bedrock.proxy.internal/api/v1',
        customFetch: mockFetch,
      });

      const request: ModelRequest = {
        messages: [{ role: MessageRole.USER, content: 'Read src/index.ts' }],
        tools: [
          {
            name: 'read_file',
            description: 'Read file contents',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        ],
      };

      const response = await provider.complete(request);

      expect(response.content).toBe('I will inspect the file.');
      expect(response.finishReason).toBe(FinishReason.TOOL_CALL);
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0]!.id).toBe('call_12345');
      expect(response.toolCalls[0]!.name).toBe('read_file');
      expect(response.toolCalls[0]!.input).toEqual({ path: 'src/index.ts' });
    });
  });

  describe('Error Classification', () => {
    it('maps ThrottlingException to MODEL_RATE_LIMITED', async () => {
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ __type: 'ThrottlingException', message: 'Rate exceeded' }),
      } as any);

      const provider = new BedrockConverseProvider({
        accessKeyId: 'AKIA_TEST',
        secretAccessKey: 'SECRET_TEST',
        customFetch: mockFetch,
      });

      await expect(
        provider.complete({ messages: [{ role: MessageRole.USER, content: 'hi' }] }),
      ).rejects.toMatchObject({
        code: ErrorCode.MODEL_RATE_LIMITED,
      });
    });

    it('maps AccessDeniedException to MODEL_UNAVAILABLE', async () => {
      const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ __type: 'AccessDeniedException', message: 'User is not authorized' }),
      } as any);

      const provider = new BedrockConverseProvider({
        accessKeyId: 'AKIA_TEST',
        secretAccessKey: 'SECRET_TEST',
        customFetch: mockFetch,
      });

      await expect(
        provider.complete({ messages: [{ role: MessageRole.USER, content: 'hi' }] }),
      ).rejects.toMatchObject({
        code: ErrorCode.MODEL_UNAVAILABLE,
      });
    });
  });

  describe('Health Checks & Utility', () => {
    it('reports UNHEALTHY if neither AWS credentials nor API key are configured', async () => {
      const provider = new BedrockConverseProvider({
        accessKeyId: undefined,
        secretAccessKey: undefined,
        apiKey: undefined,
      });

      const health = await provider.getHealth();
      expect(health.status).toBe(ProviderHealthStatus.UNHEALTHY);
      expect(health.errorMessage).toContain('Missing AWS credentials');
    });

    it('reports HEALTHY when AWS credentials are provided', async () => {
      const provider = new BedrockConverseProvider({
        accessKeyId: 'AKIA_KEY',
        secretAccessKey: 'SECRET_KEY',
      });

      const health = await provider.getHealth();
      expect(health.status).toBe(ProviderHealthStatus.HEALTHY);
    });

    it('estimates token counts accurately', async () => {
      const provider = new BedrockConverseProvider();
      const count = await provider.countTokens('Hello world this is a test for token counting.');
      expect(count).toBeGreaterThan(5);
      expect(count).toBeLessThan(20);
    });
  });
});
