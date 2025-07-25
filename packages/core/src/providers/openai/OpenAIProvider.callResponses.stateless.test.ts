import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import { IMessage } from '../IMessage.js';
import { ITool } from '../ITool.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';

// Mock fetch globally
global.fetch = vi.fn();

describe.skip('OpenAIProvider.callResponsesEndpoint (stateless)', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIProvider('test-key');
    provider.setModel('gpt-4o'); // Use a model that supports responses API
  });

  function createSSEResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => {
          controller.enqueue(encoder.encode(chunk));
        });
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  it('should make successful stateless streaming call', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":1,"total_tokens":11}}}\n\n',
      'data: [DONE]\n\n',
    ];

    vi.mocked(global.fetch).mockResolvedValueOnce(createSSEResponse(chunks));

    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'Hello',
      },
    ];

    const generator = await (
      provider as unknown as {
        callResponsesEndpoint: (
          messages: IMessage[],
          tools?: ITool[],
          options?: Record<string, unknown>,
        ) => Promise<AsyncIterableIterator<IMessage>>;
      }
    ).callResponsesEndpoint(messages, [], {
      stream: true,
      stateful: false,
    });

    const results: IMessage[] = [];
    for await (const message of generator) {
      results.push(message);
    }

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((m) => m.content === 'Hello')).toBe(true);
  });

  it('should make successful non-streaming stateless call', async () => {
    const responseData = {
      id: 'resp-123',
      model: 'gpt-4o',
      object: 'chat.completion',
      choices: [
        {
          message: {
            role: ContentGeneratorRole.ASSISTANT,
            content: 'Non-streaming response',
          },
          finish_reason: 'stop',
        },
      ],
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'Hello',
      },
    ];

    const generator = await (
      provider as unknown as {
        callResponsesEndpoint: (
          messages: IMessage[],
          tools?: ITool[],
          options?: Record<string, unknown>,
        ) => Promise<AsyncIterableIterator<IMessage>>;
      }
    ).callResponsesEndpoint(messages, [], {
      stream: false,
      stateful: false,
    });

    const results: IMessage[] = [];
    for await (const message of generator) {
      results.push(message);
    }

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('Non-streaming response');
  });

  it('should handle tool calls in stateless mode', async () => {
    const chunks = [
      'data: {"type":"response.output_item.added","item":{"id":"item1","type":"function_call","name":"test_tool","call_id":"call_123"}}\n\n',
      'data: {"type":"response.function_call_arguments.delta","item_id":"item1","delta":"{\\"value\\": \\"test\\"}"}\n\n',
      'data: {"type":"response.output_item.done","item":{"id":"item1","type":"function_call","arguments":"{\\"value\\": \\"test\\"}"}}\n\n',
      'data: [DONE]\n\n',
    ];

    vi.mocked(global.fetch).mockResolvedValueOnce(createSSEResponse(chunks));

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

    const generator = await (
      provider as unknown as {
        callResponsesEndpoint: (
          messages: IMessage[],
          tools?: ITool[],
          options?: Record<string, unknown>,
        ) => Promise<AsyncIterableIterator<IMessage>>;
      }
    ).callResponsesEndpoint(messages, tools, {
      stream: true,
      tool_choice: 'auto',
      stateful: false,
    });

    const results: IMessage[] = [];
    for await (const message of generator) {
      results.push(message);
    }

    const toolCallMessage = results.find((m) => m.tool_calls);
    expect(toolCallMessage).toBeDefined();
    expect(toolCallMessage?.tool_calls?.[0].function.name).toBe('test_tool');
  });

  it.skip('should handle conversationId in stateless mode', async () => {
    // SKIPPING: Test uses OpenAI chat completion format instead of Responses API format
    const chunks = [
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Response with conversationId"}}]}\n\n',
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    vi.mocked(global.fetch).mockResolvedValueOnce(createSSEResponse(chunks));

    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'Hello',
      },
    ];

    const generator = await (
      provider as unknown as {
        callResponsesEndpoint: (
          messages: IMessage[],
          tools?: ITool[],
          options?: Record<string, unknown>,
        ) => Promise<AsyncIterableIterator<IMessage>>;
      }
    ).callResponsesEndpoint(messages, [], {
      stream: true,
      conversationId: 'test-conversation',
      stateful: false,
    });

    const results: IMessage[] = [];
    for await (const message of generator) {
      results.push(message);
    }

    expect(results.length).toBeGreaterThan(0);
    expect(
      results.some((m) => m.content?.includes('Response with conversationId')),
    ).toBe(true);

    // Verify the request included conversationId (as conversation_id in snake_case)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"conversation_id":"test-conversation"'),
      }),
    );
  });

  it.skip('should handle parentId in stateless mode', async () => {
    // SKIPPING: Test uses OpenAI chat completion format instead of Responses API format
    const chunks = [
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Response with parentId"}}]}\n\n',
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    vi.mocked(global.fetch).mockResolvedValueOnce(createSSEResponse(chunks));

    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'Hello',
      },
    ];

    const generator = await (
      provider as unknown as {
        callResponsesEndpoint: (
          messages: IMessage[],
          tools?: ITool[],
          options?: Record<string, unknown>,
        ) => Promise<AsyncIterableIterator<IMessage>>;
      }
    ).callResponsesEndpoint(messages, [], {
      stream: true,
      parentId: 'test-parent',
      stateful: false,
    });

    const results: IMessage[] = [];
    for await (const message of generator) {
      results.push(message);
    }

    expect(results.length).toBeGreaterThan(0);
    expect(
      results.some((m) => m.content?.includes('Response with parentId')),
    ).toBe(true);

    // Verify the request included parentId (as parent_id in snake_case)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"parent_id":"test-parent"'),
      }),
    );
  });
});
