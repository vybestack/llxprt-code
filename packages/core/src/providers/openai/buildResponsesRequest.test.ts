import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildResponsesRequest,
  ResponsesRequestParams,
  ResponsesRequest,
} from './buildResponsesRequest.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';

describe('buildResponsesRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('Basic Functionality', () => {
    it('should build request with prompt', () => {
      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        prompt: 'Hello world',
        stream: true,
      };

      const result = buildResponsesRequest(params);

      expect(result).toEqual({
        model: 'gpt-4o',
        prompt: 'Hello world',
        stream: true,
      });
    });

    it('should build request with messages', () => {
      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        messages: [
          { role: ContentGeneratorRole.USER, content: 'Hello' },
          { role: ContentGeneratorRole.ASSISTANT, content: 'Hi there!' },
        ],
        stream: false,
      };

      const result = buildResponsesRequest(params);

      expect(result).toEqual({
        model: 'gpt-4o',
        input: [
          { role: ContentGeneratorRole.USER, content: 'Hello' },
          { role: ContentGeneratorRole.ASSISTANT, content: 'Hi there!' },
        ],
        stream: false,
      });
    });
  });

  describe('Validation', () => {
    it('should throw error when both prompt and messages are provided', () => {
      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        prompt: 'Hello',
        messages: [{ role: ContentGeneratorRole.USER, content: 'Hi' }],
      };

      expect(() => buildResponsesRequest(params)).toThrow(
        'Cannot specify both "prompt" and "messages"',
      );
    });

    it('should throw error when neither prompt nor messages are provided', () => {
      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
      };

      expect(() => buildResponsesRequest(params)).toThrow(
        'Either "prompt" or "messages" must be provided.',
      );
    });

    it('should throw error when model is not provided', () => {
      const params: ResponsesRequestParams = {
        prompt: 'Hello',
      };

      expect(() => buildResponsesRequest(params)).toThrow(
        'Model is required for Responses API.',
      );
    });

    it('should throw error when too many tools are provided', () => {
      const tools = Array(17).fill({
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
        },
      });

      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        prompt: 'Hello',
        tools,
      };

      expect(() => buildResponsesRequest(params)).toThrow(
        'Too many tools provided. Maximum allowed is 16, but 17 were provided.',
      );
    });

    it('should throw error when tools JSON exceeds 32KB', () => {
      // Create a large tool that exceeds 32KB when serialized
      const largeDescription = 'x'.repeat(33 * 1024); // 33KB of 'x'
      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'large_tool',
            description: largeDescription,
            parameters: { type: 'object', properties: {} },
          },
        },
      ];

      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        prompt: 'Hello',
        tools,
      };

      expect(() => buildResponsesRequest(params)).toThrow(
        /Tools JSON size exceeds 32KB limit/,
      );
    });
  });

  describe('Field Mapping', () => {
    it('should map conversationId and parentId correctly', () => {
      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        prompt: 'Hello',
        conversationId: 'conv-123',
        parentId: 'msg-456',
      };

      const result = buildResponsesRequest(params);

      expect(result.previous_response_id).toBe('msg-456');
      expect(result.store).toBe(true);
      // Check that these properties are not set on the result
      const resultWithExtra = result as ResponsesRequest & {
        conversation_id?: string;
        conversationId?: string;
        parentId?: string;
      };
      expect(resultWithExtra.conversation_id).toBeUndefined();
      expect(resultWithExtra.conversationId).toBeUndefined();
      expect(resultWithExtra.parentId).toBeUndefined();
    });

    it('should only set store when conversationId is present without parentId', () => {
      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        prompt: 'Hello',
        conversationId: 'conv-123',
      };

      const result = buildResponsesRequest(params);

      expect(result.previous_response_id).toBeUndefined();
      expect(result.store).toBeUndefined();
      // Check that these properties are not set on the result
      const resultWithExtra = result as ResponsesRequest & {
        conversation_id?: string;
        conversationId?: string;
        parentId?: string;
      };
      expect(resultWithExtra.conversation_id).toBeUndefined();
      expect(resultWithExtra.conversationId).toBeUndefined();
      expect(resultWithExtra.parentId).toBeUndefined();
    });

    it('should include all standard OpenAI parameters', () => {
      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        prompt: 'Hello',
        temperature: 0.7,
        max_tokens: 1000,
        top_p: 0.9,
        frequency_penalty: 0.5,
        presence_penalty: 0.5,
        stop: ['\n', 'END'],
        n: 2,
        logprobs: true,
        top_logprobs: 5,
        response_format: { type: 'json_object' },
        seed: 12345,
        logit_bias: { '50256': -100 },
        user: 'user-123',
      };

      const result = buildResponsesRequest(params);

      expect(result).toMatchObject({
        model: 'gpt-4o',
        prompt: 'Hello',
        temperature: 0.7,
        max_tokens: 1000,
        top_p: 0.9,
        frequency_penalty: 0.5,
        presence_penalty: 0.5,
        stop: ['\n', 'END'],
        n: 2,
        logprobs: true,
        top_logprobs: 5,
        response_format: { type: 'json_object' },
        seed: 12345,
        logit_bias: { '50256': -100 },
        user: 'user-123',
      });
    });
  });

  describe('Stateful Mode', () => {
    it('should handle conversationId with messages', () => {
      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        messages: [{ role: ContentGeneratorRole.USER, content: 'Hello' }],
        conversationId: 'conv-123',
      };

      const result = buildResponsesRequest(params);

      // The implementation doesn't warn, just processes the request
      expect(result.input).toHaveLength(1);
      expect(result.input?.[0]).toEqual({
        role: ContentGeneratorRole.USER,
        content: 'Hello',
      });
    });

    it('should keep recent messages when conversationId is used with more than 2 messages', () => {
      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        messages: [
          { role: ContentGeneratorRole.USER, content: 'First message' },
          { role: ContentGeneratorRole.ASSISTANT, content: 'First response' },
          { role: ContentGeneratorRole.USER, content: 'Second message' },
          { role: ContentGeneratorRole.ASSISTANT, content: 'Second response' },
          { role: ContentGeneratorRole.USER, content: 'Third message' },
        ],
        conversationId: 'conv-123',
      };

      const result = buildResponsesRequest(params);

      // The implementation keeps the last few messages, starting from the last user message
      expect(result.input).toHaveLength(3);
      // Type guard to check if message has content property
      const msg0 = result.input?.[0];
      const msg1 = result.input?.[1];
      const msg2 = result.input?.[2];
      expect(msg0 && 'content' in msg0 ? msg0.content : undefined).toBe(
        'Second message',
      );
      expect(msg1 && 'content' in msg1 ? msg1.content : undefined).toBe(
        'Second response',
      );
      expect(msg2 && 'content' in msg2 ? msg2.content : undefined).toBe(
        'Third message',
      );
    });

    it('should not trim messages when conversationId is used with 2 or fewer messages', () => {
      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        messages: [
          { role: ContentGeneratorRole.USER, content: 'Hello' },
          { role: ContentGeneratorRole.ASSISTANT, content: 'Hi there!' },
        ],
        conversationId: 'conv-123',
      };

      const result = buildResponsesRequest(params);

      expect(result.input).toHaveLength(2);
      expect(console.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('Trimmed messages'),
      );
    });

    it('should not warn when conversationId is used with prompt', () => {
      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        prompt: 'Hello',
        conversationId: 'conv-123',
      };

      buildResponsesRequest(params);

      expect(console.warn).not.toHaveBeenCalled();
    });

    it('should include stateful flag when provided', () => {
      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        prompt: 'Hello',
        stateful: true,
      };

      const result = buildResponsesRequest(params);

      expect(result.stateful).toBe(true);
    });
  });

  describe('Tools and Tool Choice', () => {
    it('should strip tool_calls from messages', () => {
      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        messages: [
          { role: ContentGeneratorRole.USER, content: 'Get the weather' },
          {
            role: ContentGeneratorRole.ASSISTANT,
            content: "I'll check the weather for you.",
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location": "London"}',
                },
              },
            ],
          },
        ],
      };

      const result = buildResponsesRequest(params);

      expect(result.input).toHaveLength(3); // 2 messages + 1 function_call
      expect(result.input?.[1]).toEqual({
        role: ContentGeneratorRole.ASSISTANT,
        content: "I'll check the weather for you.",
      });
      expect(
        (result.input?.[1] as Record<string, unknown>).tool_calls,
      ).toBeUndefined();

      // Check that function_call was extracted
      expect(result.input?.[2]).toEqual({
        type: 'function_call',
        call_id: 'call_123',
        name: 'get_weather',
        arguments: '{"location": "London"}',
      });
    });

    it('should include tools and tool_choice when provided', () => {
      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'get_weather',
            description: 'Get weather information',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
              required: ['location'],
            },
          },
        },
      ];

      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        prompt: 'What is the weather?',
        tools,
        tool_choice: 'auto',
      };

      const result = buildResponsesRequest(params);

      expect(result.tools).toEqual(tools);
      expect(result.tool_choice).toBe('auto');
    });

    it('should not include tool_choice if tools are not provided', () => {
      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        prompt: 'Hello',
        tool_choice: 'auto',
      };

      const result = buildResponsesRequest(params);

      expect(result.tool_choice).toBeUndefined();
    });
  });

  describe('Matrix Test Scenarios', () => {
    const testCases: Array<{
      name: string;
      params: ResponsesRequestParams;
      expectedSnapshot: Record<string, unknown>;
    }> = [
      {
        name: 'minimal prompt request',
        params: {
          model: 'gpt-4o',
          prompt: 'Hello',
        },
        expectedSnapshot: {
          model: 'gpt-4o',
          prompt: 'Hello',
        },
      },
      {
        name: 'minimal messages request',
        params: {
          model: 'gpt-4o',
          messages: [{ role: ContentGeneratorRole.USER, content: 'Hello' }],
        },
        expectedSnapshot: {
          model: 'gpt-4o',
          input: [{ role: ContentGeneratorRole.USER, content: 'Hello' }],
        },
      },
      {
        name: 'full stateless request',
        params: {
          model: 'gpt-4o',
          prompt: 'Hello',
          stream: true,
          temperature: 0.8,
          max_tokens: 500,
          tools: [
            {
              type: 'function',
              function: {
                name: 'test',
                description: 'Test function',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
          tool_choice: 'auto',
        },
        expectedSnapshot: {
          model: 'gpt-4o',
          prompt: 'Hello',
          stream: true,
          temperature: 0.8,
          max_tokens: 500,
          tools: [
            {
              type: 'function',
              function: {
                name: 'test',
                description: 'Test function',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
          tool_choice: 'auto',
        },
      },
      {
        name: 'full stateful request',
        params: {
          model: 'gpt-4o',
          messages: [{ role: ContentGeneratorRole.USER, content: 'Hello' }],
          conversationId: 'conv-123',
          parentId: 'parent123',
          stateful: true,
          stream: true,
        },
        expectedSnapshot: {
          model: 'gpt-4o',
          input: [{ role: ContentGeneratorRole.USER, content: 'Hello' }],
          previous_response_id: 'parent123',
          store: true,
          stateful: true,
          stream: true,
        },
      },
    ];

    testCases.forEach(({ name, params, expectedSnapshot }) => {
      it(`should correctly build ${name}`, () => {
        const result = buildResponsesRequest(params);
        expect(result).toEqual(expectedSnapshot);
      });
    });
  });
});
