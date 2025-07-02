import { describe, it, expect, vi } from 'vitest';
import { parseResponsesStream } from './parseResponsesStream';

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

describe('parseResponsesStream - Tool Calls', () => {
  it('should parse complete tool calls with complex arguments', async () => {
    const chunks = [
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"complex_tool","arguments":"{\\"nested\\": {\\"arr"}}]}}]}\n\n',
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ay\\": [1, 2, 3], \\"obj\\": {\\"key\\": \\"value\\"}}, \\"flag\\": true}"}}]}}]}\n\n',
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    // Should have one message with tool calls
    const toolCallMessage = messages.find((m) => m.tool_calls);
    expect(toolCallMessage).toBeDefined();
    expect(toolCallMessage?.tool_calls).toHaveLength(1);
    expect(toolCallMessage?.tool_calls?.[0]).toEqual({
      id: 'call_abc',
      type: 'function',
      function: {
        name: 'complex_tool',
        arguments:
          '{"nested": {"array": [1, 2, 3], "obj": {"key": "value"}}, "flag": true}',
      },
    });
  });

  it('should handle multiple tool calls in a single response', async () => {
    const chunks = [
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"tool1","arguments":"{\\"a\\": 1}"}}]}}]}\n\n',
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_2","type":"function","function":{"name":"tool2","arguments":"{\\"b\\": 2}"}}]}}]}\n\n',
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    const toolCallMessage = messages.find((m) => m.tool_calls);
    expect(toolCallMessage?.tool_calls).toHaveLength(2);
    expect(toolCallMessage?.tool_calls?.[0]).toEqual({
      id: 'call_1',
      type: 'function',
      function: {
        name: 'tool1',
        arguments: '{"a": 1}',
      },
    });
    expect(toolCallMessage?.tool_calls?.[1]).toEqual({
      id: 'call_2',
      type: 'function',
      function: {
        name: 'tool2',
        arguments: '{"b": 2}',
      },
    });
  });

  it('should handle tool calls with empty arguments', async () => {
    const chunks = [
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_empty","type":"function","function":{"name":"no_args_tool"}}]}}]}\n\n',
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    const toolCallMessage = messages.find((m) => m.tool_calls);
    expect(toolCallMessage?.tool_calls?.[0]).toEqual({
      id: 'call_empty',
      type: 'function',
      function: {
        name: 'no_args_tool',
        arguments: '',
      },
    });
  });

  it('should handle tool calls with unicode and special characters', async () => {
    const chunks = [
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_unicode","type":"function","function":{"name":"unicode_tool","arguments":"{\\"text\\": \\"Hello 世界 🌍\\", \\"special\\": \\"\\\\n\\\\t\\\\r\\"}"}}]}}]}\n\n',
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    const toolCallMessage = messages.find((m) => m.tool_calls);
    expect(toolCallMessage?.tool_calls?.[0].function.arguments).toBe(
      '{"text": "Hello 世界 🌍", "special": "\\n\\t\\r"}',
    );
  });

  it('should handle interleaved content and tool calls', async () => {
    const chunks = [
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Let me search for that..."}}]}\n\n',
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_search","type":"function","function":{"name":"search","arguments":"{\\"query\\": \\"test\\"}"}}]}}]}\n\n',
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    // Should have content message and tool call message
    expect(
      messages.some((m) => m.content === 'Let me search for that...'),
    ).toBe(true);
    expect(messages.some((m) => m.tool_calls)).toBe(true);
  });

  it('should handle tool calls with very long arguments', async () => {
    const longValue = 'x'.repeat(1000);
    const chunks = [
      `data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_long","type":"function","function":{"name":"long_args","arguments":"{\\"data\\": \\""}}]}}]}\n\n`,
      `data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"${longValue}\\"}"}}]}}]}\n\n`,
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    const toolCallMessage = messages.find((m) => m.tool_calls);
    const args = JSON.parse(
      toolCallMessage?.tool_calls?.[0].function.arguments || '{}',
    );
    expect(args.data).toBe(longValue);
  });

  it('should handle malformed tool call indices gracefully', async () => {
    const chunks = [
      // Tool call without index - should be skipped
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"id":"call_no_index","type":"function","function":{"name":"tool"}}]}}]}\n\n',
      // Valid tool call
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_valid","type":"function","function":{"name":"valid_tool","arguments":"{}"}}]}}]}\n\n',
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    const toolCallMessage = messages.find((m) => m.tool_calls);
    // Should only have the valid tool call
    expect(toolCallMessage?.tool_calls).toHaveLength(1);
    expect(toolCallMessage?.tool_calls?.[0].id).toBe('call_valid');
  });
});

describe('parseResponsesStream - Multi-choice', () => {
  it('should warn and process only first choice when multiple choices are present', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const chunks = [
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Choice 0"}},{"index":1,"delta":{"content":"Choice 1"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    expect(consoleSpy).toHaveBeenCalledWith(
      '[parseResponsesStream] Multiple choices received (2), only processing index 0',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Choice 0');

    consoleSpy.mockRestore();
  });

  it('should handle single choice without warning', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const chunks = [
      'data: {"id":"resp-123","model":"gpt-4o","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Single choice"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Single choice');

    consoleSpy.mockRestore();
  });
});
