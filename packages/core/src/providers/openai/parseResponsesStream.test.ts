import { describe, it, expect } from 'vitest';
import type { IContent } from '../../services/history/IContent.js';
import {
  parseResponsesStream,
  parseErrorResponse,
} from './parseResponsesStream.js';

function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < chunks.length) {
        const chunk = chunks[index++];
        controller.enqueue(encoder.encode(chunk));
      } else {
        controller.close();
      }
    },
  });
}

describe('parseResponsesStream', () => {
  it('should parse content chunks correctly', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: {"type":"response.output_text.delta","delta":" world"}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello' }],
    });
    expect(messages[1]).toEqual({
      speaker: 'ai',
      blocks: [{ type: 'text', text: ' world' }],
    });
  });

  it('should parse tool calls correctly', async () => {
    const chunks = [
      'data: {"type":"response.output_item.added","sequence_number":1,"output_index":0,"item":{"id":"fc_123","type":"function_call","status":"in_progress","arguments":"","call_id":"call_123","name":"search"}}\n\n',
      'data: {"type":"response.function_call_arguments.delta","sequence_number":2,"item_id":"fc_123","output_index":0,"delta":"{\\"query\\":\\"test\\"}"}\n\n',
      'data: {"type":"response.output_item.done","sequence_number":3,"output_index":0,"item":{"id":"fc_123","type":"function_call","status":"completed","arguments":"{\\"query\\":\\"test\\"}","call_id":"call_123","name":"search"}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    const toolCallMessage = messages.find((m) =>
      m.blocks.some((block) => block.type === 'tool_call'),
    );
    expect(toolCallMessage).toBeDefined();
    expect(toolCallMessage?.blocks[0]).toEqual({
      type: 'tool_call',
      id: 'call_123',
      name: 'search',
      parameters: { query: 'test' },
    });
  });

  it('should parse usage data correctly', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"Test response"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp-123","object":"response","model":"gpt-4o","status":"completed","usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    expect(messages.length).toBeGreaterThanOrEqual(2);
    const usageMessage = messages.find((m) => m.metadata?.usage);
    expect(usageMessage).toBeDefined();
    expect(usageMessage?.metadata?.usage).toEqual({
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
      cachedTokens: 0,
    });
  });

  it('should handle split chunks correctly', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delt',
      'a":"Hello world"}\n\ndata: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    expect(messages).toHaveLength(1);
    const textBlock = messages[0].blocks.find((b) => b.type === 'text');
    expect(textBlock).toBeDefined();
    expect((textBlock as { type: 'text'; text: string }).text).toBe(
      'Hello world',
    );
  });

  it('should skip invalid JSON chunks', async () => {
    const chunks = [
      'data: invalid json\n\n',
      'data: {"type":"response.output_text.delta","delta":"Valid"}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    expect(messages).toHaveLength(1);
    const textBlock = messages[0].blocks.find((b) => b.type === 'text');
    expect(textBlock).toBeDefined();
    expect((textBlock as { type: 'text'; text: string }).text).toBe('Valid');
  });
});

describe('parseErrorResponse', () => {
  it('should parse 409 conflict error', () => {
    const error = parseErrorResponse(
      409,
      '{"error":{"message":"Conversation already exists"}}',
      'Responses',
    );
    expect(error.message).toBe('Conflict: Conversation already exists');
  });

  it('should parse 410 gone error', () => {
    const error = parseErrorResponse(
      410,
      '{"error":{"message":"Conversation expired"}}',
      'Responses',
    );
    expect(error.message).toBe('Gone: Conversation expired');
  });

  it('should parse 429 rate limit error', () => {
    const error = parseErrorResponse(
      429,
      '{"error":{"message":"Too many requests"}}',
      'Responses',
    );
    expect(error.message).toBe('Rate limit exceeded: Too many requests');
  });

  it('should parse 5xx server errors', () => {
    const error500 = parseErrorResponse(
      500,
      '{"error":{"message":"Internal error"}}',
      'Responses',
    );
    expect(error500.message).toBe('Server error: Internal error');

    const error503 = parseErrorResponse(
      503,
      '{"error":{"message":"Service unavailable"}}',
      'Responses',
    );
    expect(error503.message).toBe('Server error: Service unavailable');
  });

  it('should handle invalid JSON in error response', () => {
    const error = parseErrorResponse(500, 'Not JSON', 'Responses');
    expect(error.message).toBe('Server error: Responses API error: 500');
  });

  it('should handle unknown status codes', () => {
    const error = parseErrorResponse(
      418,
      '{"error":{"message":"I am a teapot"}}',
      'Responses',
    );
    expect(error.message).toBe('I am a teapot');
  });

  it('should parse cached_tokens from response.completed usage data', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp-123","object":"response","model":"o3-mini","status":"completed","usage":{"input_tokens":100,"output_tokens":20,"total_tokens":120,"input_tokens_details":{"cached_tokens":50}}}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    expect(messages.length).toBeGreaterThanOrEqual(2);
    const usageMessage = messages.find((m) => m.metadata?.usage);
    expect(usageMessage).toBeDefined();
    expect(usageMessage?.metadata?.usage).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cachedTokens: 50,
    });
  });

  it('should default cachedTokens to 0 when not present in usage data', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp-123","object":"response","model":"o3-mini","status":"completed","usage":{"input_tokens":100,"output_tokens":20,"total_tokens":120}}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    expect(messages.length).toBeGreaterThanOrEqual(2);
    const usageMessage = messages.find((m) => m.metadata?.usage);
    expect(usageMessage).toBeDefined();
    expect(usageMessage?.metadata?.usage).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cachedTokens: 0,
    });
  });
});
