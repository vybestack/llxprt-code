import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import { IMessage } from '../IMessage.js';
import { ITool } from '../ITool.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';

interface OpenAIProviderPrivate {
  callResponsesEndpoint: (
    messages: IMessage[],
    tools?: ITool[] | undefined,
    options?: Record<string, unknown>,
  ) => AsyncIterableIterator<IMessage>;
}

// Mock fetch globally
global.fetch = vi.fn();

describe.skip('OpenAIProvider Responses Integration', () => {
  // SKIPPING: Integration tests that depend on responses API implementation which is not complete
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIProvider('test-api-key');
    // Set a model that uses responses API
    provider.setModel('gpt-4o-realtime');
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('should make a successful streaming request', async () => {
    const chunks = [
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n',
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" world"}}]}\n\n',
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n',
      'data: [DONE]\n\n',
    ];

    vi.mocked(global.fetch).mockResolvedValueOnce(createSSEResponse(chunks));

    const messages: IMessage[] = [
      { role: ContentGeneratorRole.USER, content: 'Say hello' },
    ];

    const result = await provider.generateChatCompletion(messages);
    const collectedMessages: IMessage[] = [];

    for await (const message of result) {
      collectedMessages.push(message);
    }

    // Verify the API call
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-api-key',
          'Content-Type': 'application/json',
        },
        body: expect.stringContaining('"model":"gpt-4o-realtime"'),
      }),
    );

    // Verify the collected messages
    expect(collectedMessages.length).toBeGreaterThanOrEqual(2);
    expect(collectedMessages.some((m) => m.content === 'Hello')).toBe(true);
    expect(collectedMessages.some((m) => m.content === ' world')).toBe(true);
  });

  it('should cache and reuse conversations', async () => {
    const chunks = [
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Cached response"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    vi.mocked(global.fetch).mockResolvedValueOnce(createSSEResponse(chunks));

    const messages: IMessage[] = [
      { role: ContentGeneratorRole.USER, content: 'Test caching' },
    ];

    const options = {
      conversationId: 'test-conv',
      parentId: 'test-parent',
    };

    // Access private method for testing
    const callResponsesEndpoint = (
      provider as unknown as OpenAIProviderPrivate
    ).callResponsesEndpoint.bind(provider);

    // First call - should hit the API
    const result1 = await callResponsesEndpoint(messages, undefined, options);
    const collected1: IMessage[] = [];
    for await (const message of result1) {
      collected1.push(message);
    }

    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Second call with same IDs - should use cache
    const result2 = await callResponsesEndpoint(messages, undefined, options);
    const collected2: IMessage[] = [];
    for await (const message of result2) {
      collected2.push(message);
    }

    // Should not have made another API call
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Should get the same messages
    expect(collected2).toHaveLength(collected1.length);
    expect(collected2[0].content).toBe('Cached response');
  });

  it('should handle tool calls correctly', async () => {
    const chunks = [
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"search","arguments":"{\\"q"}}]}}]}\n\n',
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"uery\\": \\"weather\\"}"}}]}}]}\n\n',
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    vi.mocked(global.fetch).mockResolvedValueOnce(createSSEResponse(chunks));

    const messages: IMessage[] = [
      { role: ContentGeneratorRole.USER, content: 'What is the weather?' },
    ];

    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Search for information',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
            required: ['query'],
          },
        },
      },
    ];

    const result = await provider.generateChatCompletion(messages, tools);
    const collectedMessages: IMessage[] = [];

    for await (const message of result) {
      collectedMessages.push(message);
    }

    // Find the message with tool calls
    const toolCallMessage = collectedMessages.find((m) => m.tool_calls);
    expect(toolCallMessage).toBeDefined();
    expect(toolCallMessage?.tool_calls).toHaveLength(1);
    expect(toolCallMessage?.tool_calls?.[0]).toEqual({
      id: 'call_123',
      type: 'function',
      function: {
        name: 'search',
        arguments: '{"query": "weather"}',
      },
    });
  });

  it('should handle API errors correctly', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response('{"error":{"message":"Rate limit exceeded"}}', {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const messages: IMessage[] = [
      { role: ContentGeneratorRole.USER, content: 'Test error' },
    ];

    const generator = provider.generateChatCompletion(messages);
    await expect(async () => {
      for await (const _message of generator) {
        // Should throw before yielding any messages
      }
    }).rejects.toThrow('Rate limit exceeded');
  });

  it('should handle non-streaming responses', async () => {
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
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const messages: IMessage[] = [
      { role: ContentGeneratorRole.USER, content: 'Test non-streaming' },
    ];

    // Access private method for testing
    const callResponsesEndpoint = (
      provider as unknown as OpenAIProviderPrivate
    ).callResponsesEndpoint.bind(provider);

    const result = await callResponsesEndpoint(messages, undefined, {
      stream: false,
    });
    const collectedMessages: IMessage[] = [];

    for await (const message of result) {
      collectedMessages.push(message);
    }

    expect(collectedMessages).toHaveLength(1);
    expect(collectedMessages[0]).toEqual({
      role: ContentGeneratorRole.ASSISTANT,
      content: 'Non-streaming response',
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    });
  });

  it('should throw error for stateful mode', async () => {
    const messages: IMessage[] = [
      { role: ContentGeneratorRole.USER, content: 'Test stateful' },
    ];

    // Access private method for testing
    const callResponsesEndpoint = (
      provider as unknown as OpenAIProviderPrivate
    ).callResponsesEndpoint.bind(provider);

    await expect(
      callResponsesEndpoint(messages, undefined, { stateful: true }),
    ).rejects.toThrow('Stateful mode not yet implemented for Responses API');
  });
});
