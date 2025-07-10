import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import { IMessage } from '../IMessage.js';
import { ContentGeneratorRole } from '../types.js';
import OpenAI from 'openai';

// Mock fetch globally
global.fetch = vi.fn();

// Mock OpenAI
vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [
                {
                  delta: {
                    content: 'Hello from legacy API',
                  },
                },
              ],
            };
            yield {
              choices: [{ delta: {} }],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
              },
            };
          },
        })),
      },
    },
    models: {
      list: vi.fn().mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          yield { id: 'gpt-4o' };
          yield { id: 'gpt-3.5-turbo' };
        },
      }),
    },
  }));

  return { default: MockOpenAI };
});

describe('OpenAIProvider generateChatCompletion switch logic', () => {
  let provider: OpenAIProvider;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    provider = new OpenAIProvider('test-key');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should use responses API for gpt-4o model', async () => {
    provider.setModel('gpt-4o');

    const chunks = [
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello from Responses API"}}]}\n\n',
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => {
          controller.enqueue(encoder.encode(chunk));
        });
        controller.close();
      },
    });

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );

    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'Hello',
      },
    ];

    const generator = provider.generateChatCompletion(messages);
    const results: IMessage[] = [];

    for await (const message of generator) {
      results.push(message);
    }

    // Should have used Responses API endpoint
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/responses'),
      expect.any(Object),
    );

    // Should have received content from Responses API
    expect(results.some((m) => m.content === 'Hello from Responses API')).toBe(
      true,
    );
  });

  it('should use legacy API for gpt-3.5-turbo model', async () => {
    provider.setModel('gpt-3.5-turbo');

    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'Hello',
      },
    ];

    const generator = provider.generateChatCompletion(messages);
    const results: IMessage[] = [];

    for await (const message of generator) {
      results.push(message);
    }

    // Should have received content from legacy API
    expect(results).toHaveLength(2);
    expect(results[0].content).toBe('Hello from legacy API');
    expect(results[1].usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });

  it('should use legacy API when OPENAI_RESPONSES_DISABLE is true', async () => {
    process.env.OPENAI_RESPONSES_DISABLE = 'true';
    provider.setModel('gpt-4o');

    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'Hello',
      },
    ];

    const generator = provider.generateChatCompletion(messages);
    const results: IMessage[] = [];

    for await (const message of generator) {
      results.push(message);
    }

    // Should have received content from legacy API
    expect(results).toHaveLength(2);
    expect(results[0].content).toBe('Hello from legacy API');
  });

  it('should pass tools to responses API when using gpt-4o', async () => {
    provider.setModel('gpt-4o');

    const chunks = [
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Using tool"}}]}\n\n',
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => {
          controller.enqueue(encoder.encode(chunk));
        });
        controller.close();
      },
    });

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );

    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'Hello',
      },
    ];

    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      },
    ];

    const generator = provider.generateChatCompletion(messages, tools);
    const results: IMessage[] = [];

    for await (const message of generator) {
      results.push(message);
    }

    // Should have used Responses API endpoint with tools
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/responses'),
      expect.objectContaining({
        body: expect.stringContaining('"tools"'),
      }),
    );

    // Should have received content
    expect(results.some((m) => m.content === 'Using tool')).toBe(true);
  });

  it('should pass tools to legacy API when using gpt-3.5-turbo', async () => {
    provider.setModel('gpt-3.5-turbo');

    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'Hello',
      },
    ];

    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      },
    ];

    const generator = provider.generateChatCompletion(messages, tools);
    const results: IMessage[] = [];

    for await (const message of generator) {
      results.push(message);
    }

    // Should have called legacy API with tools
    const mockOpenAI = vi.mocked(OpenAI);
    const instance = mockOpenAI.mock.results[0].value;
    expect(instance.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-3.5-turbo',
        tools: expect.any(Array),
        tool_choice: 'auto',
      }),
    );
  });
});
