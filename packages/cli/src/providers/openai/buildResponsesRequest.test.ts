import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildResponsesRequest,
  ResponsesRequestParams,
} from './buildResponsesRequest';
import { ContentGeneratorRole } from '../types.js';

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
        'Either "prompt" or "messages" must be provided',
      );
    });

    it('should throw error when model is not provided', () => {
      const params: ResponsesRequestParams = {
        prompt: 'Hello',
      };

      expect(() => buildResponsesRequest(params)).toThrow(
        'Model is required for Responses API',
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
        'Too many tools provided. Maximum allowed is 16, but 17 were provided',
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
    it('should map conversationId to conversation_id', () => {
      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        prompt: 'Hello',
        conversationId: 'conv-123',
      };

      const result = buildResponsesRequest(params);

      expect(result.conversation_id).toBe('conv-123');
      expect(result.conversationId).toBeUndefined();
    });

    it('should map parentId to parent_id', () => {
      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        prompt: 'Hello',
        parentId: 'msg-456',
      };

      const result = buildResponsesRequest(params);

      expect(result.parent_id).toBe('msg-456');
      expect(result.parentId).toBeUndefined();
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
    it('should warn when conversationId is used with messages', () => {
      const params: ResponsesRequestParams = {
        model: 'gpt-4o',
        messages: [{ role: ContentGeneratorRole.USER, content: 'Hello' }],
        conversationId: 'conv-123',
      };

      buildResponsesRequest(params);

      expect(console.warn).toHaveBeenCalledWith(
        '[buildResponsesRequest] conversationId provided in stateful mode. Only the most recent messages will be sent to maintain context window.',
      );
    });

    it('should trim messages to last 2 when conversationId is used with more than 2 messages', () => {
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

      expect(result.input).toHaveLength(2);
      expect(result.input?.[0].content).toBe('Second response');
      expect(result.input?.[1].content).toBe('Third message');
      expect(console.warn).toHaveBeenCalledWith(
        '[buildResponsesRequest] Trimmed messages from 5 to 2 for stateful mode.',
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
          parentId: 'msg-456',
          stateful: true,
          stream: true,
        },
        expectedSnapshot: {
          model: 'gpt-4o',
          input: [{ role: ContentGeneratorRole.USER, content: 'Hello' }],
          conversation_id: 'conv-123',
          parent_id: 'msg-456',
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
