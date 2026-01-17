import { describe, it, expect } from 'vitest';
import { parseResponsesStream } from './parseResponsesStream.js';

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

describe('parseResponsesStream - Reasoning/Thinking Support', () => {
  it('should parse reasoning-only stream with delta and done events', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"Let me think about this..."}\n\n',
      'data: {"type":"response.reasoning_text.delta","sequence_number":2,"delta":" The user wants to know..."}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":3}\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    // Should have one thinking block message
    const thinkingMessage = messages.find((m) =>
      m.blocks.some((block) => block.type === 'thinking'),
    );
    expect(thinkingMessage).toBeDefined();
    expect(thinkingMessage?.speaker).toBe('ai');
    expect(thinkingMessage?.blocks).toHaveLength(1);
    expect(thinkingMessage?.blocks[0]).toEqual({
      type: 'thinking',
      thought: 'Let me think about this... The user wants to know...',
      sourceField: 'reasoning_content',
    });
  });

  it('should handle interleaved reasoning, text, and tool calls', async () => {
    const chunks = [
      // Reasoning starts
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"I need to search for this information."}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":2}\n\n',
      // Text content
      'data: {"type":"response.output_text.delta","delta":"Let me search for that..."}\n\n',
      // Tool call
      'data: {"type":"response.output_item.added","sequence_number":4,"output_index":1,"item":{"id":"fc_search","type":"function_call","status":"in_progress","arguments":"","call_id":"call_search","name":"search"}}\n\n',
      'data: {"type":"response.function_call_arguments.delta","sequence_number":5,"item_id":"fc_search","output_index":1,"delta":"{\\"query\\":\\"test\\"}"}\n\n',
      'data: {"type":"response.output_item.done","sequence_number":6,"output_index":1,"item":{"id":"fc_search","type":"function_call","status":"completed","arguments":"{\\"query\\":\\"test\\"}","call_id":"call_search","name":"search"}}\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    // Should have reasoning, text, and tool call messages
    expect(
      messages.some((m) => m.blocks.some((block) => block.type === 'thinking')),
    ).toBe(true);
    expect(
      messages.some((m) =>
        m.blocks.some(
          (block) =>
            block.type === 'text' &&
            (block as { type: 'text'; text: string }).text ===
              'Let me search for that...',
        ),
      ),
    ).toBe(true);
    expect(
      messages.some((m) =>
        m.blocks.some((block) => block.type === 'tool_call'),
      ),
    ).toBe(true);
  });

  it('should not yield thinking block for empty/whitespace-only reasoning', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"   "}\n\n',
      'data: {"type":"response.reasoning_text.delta","sequence_number":2,"delta":"\\n\\t"}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":3}\n\n',
      'data: {"type":"response.output_text.delta","delta":"Hello!"}\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    // Should not have thinking block, only text
    expect(
      messages.some((m) => m.blocks.some((block) => block.type === 'thinking')),
    ).toBe(false);
    expect(
      messages.some((m) => m.blocks.some((block) => block.type === 'text')),
    ).toBe(true);
  });

  it('should accumulate multiple reasoning deltas into single block', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"First chunk."}\n\n',
      'data: {"type":"response.reasoning_text.delta","sequence_number":2,"delta":" Second chunk."}\n\n',
      'data: {"type":"response.reasoning_text.delta","sequence_number":3,"delta":" Third chunk."}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":4}\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    const thinkingMessages = messages.filter((m) =>
      m.blocks.some((block) => block.type === 'thinking'),
    );
    // Should have exactly one thinking message with all deltas accumulated
    expect(thinkingMessages).toHaveLength(1);
    const thinkingBlock = thinkingMessages[0]?.blocks[0] as {
      type: 'thinking';
      thought: string;
    };
    expect(thinkingBlock.thought).toBe(
      'First chunk. Second chunk. Third chunk.',
    );
  });

  it('should handle reasoning with usage metadata', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"Thinking deeply..."}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":2}\n\n',
      'data: {"type":"response.output_text.delta","delta":"Here is my answer."}\n\n',
      'data: {"type":"response.completed","sequence_number":4,"response":{"id":"resp_123","object":"response","model":"gpt-5.2","status":"completed","usage":{"input_tokens":100,"output_tokens":50,"total_tokens":150}}}\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    // Should have thinking block, text, and usage
    expect(
      messages.some((m) => m.blocks.some((block) => block.type === 'thinking')),
    ).toBe(true);
    expect(
      messages.some((m) => m.blocks.some((block) => block.type === 'text')),
    ).toBe(true);
    const usageMessage = messages.find((m) => m.metadata?.usage);
    expect(usageMessage?.metadata?.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cachedTokens: 0,
    });
  });

  it('should handle reasoning_summary_text events separately from reasoning_text', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"Raw reasoning."}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":2}\n\n',
      'data: {"type":"response.reasoning_summary_text.delta","sequence_number":3,"delta":"Summary: Key insight."}\n\n',
      'data: {"type":"response.reasoning_summary_text.done","sequence_number":4,"text":"Summary: Key insight."}\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    const thinkingMessages = messages.filter((m) =>
      m.blocks.some((block) => block.type === 'thinking'),
    );
    // Should have two separate ThinkingBlocks
    expect(thinkingMessages).toHaveLength(2);
    const thoughts = thinkingMessages.map(
      (m) => (m.blocks[0] as { type: 'thinking'; thought: string }).thought,
    );
    expect(thoughts).toContain('Raw reasoning.');
    expect(thoughts).toContain('Summary: Key insight.');
  });

  it('should yield reasoning before response.completed', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"Reasoning content"}\n\n',
      'data: {"type":"response.completed","sequence_number":2,"response":{"id":"resp_123","object":"response","model":"gpt-5.2","status":"completed","usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    // Thinking should come before usage
    const thinkingIndex = messages.findIndex((m) =>
      m.blocks.some((block) => block.type === 'thinking'),
    );
    const usageIndex = messages.findIndex((m) => m.metadata?.usage);
    expect(thinkingIndex).toBeGreaterThanOrEqual(0);
    expect(usageIndex).toBeGreaterThanOrEqual(0);
    expect(thinkingIndex).toBeLessThan(usageIndex);
  });
});
