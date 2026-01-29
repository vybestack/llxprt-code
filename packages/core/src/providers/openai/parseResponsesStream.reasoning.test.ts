import { describe, it, expect } from 'vitest';
import type { IContent } from '../../services/history/IContent.js';

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
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const thoughts = messages.flatMap((message) =>
      message.blocks
        .filter((block) => block.type === 'thinking')
        .map((block) => block.thought),
    );
    const lastThought = thoughts[thoughts.length - 1] ?? '';
    expect(lastThought).toBe(
      'Let me think about this... The user wants to know...',
    );
  });

  it('should handle interleaved reasoning, text, and tool calls', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"I need to search for this information."}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":2}\n\n',
      'data: {"type":"response.output_text.delta","delta":"Let me search for that..."}\n\n',
      'data: {"type":"response.output_item.added","sequence_number":4,"output_index":1,"item":{"id":"fc_search","type":"function_call","status":"in_progress","arguments":"","call_id":"call_search","name":"search"}}\n\n',
      'data: {"type":"response.function_call_arguments.delta","sequence_number":5,"item_id":"fc_search","output_index":1,"delta":"{\\"query\\":\\"test\\"}"}\n\n',
      'data: {"type":"response.output_item.done","sequence_number":6,"output_index":1,"item":{"id":"fc_search","type":"function_call","status":"completed","arguments":"{\\"query\\":\\"test\\"}","call_id":"call_search","name":"search"}}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const hasThinking = messages.some((m) =>
      m.blocks.some((block) => block.type === 'thinking'),
    );
    expect(hasThinking).toBe(true);
    const hasExpectedText = messages.some((m) =>
      m.blocks
        .filter(
          (block): block is { type: 'text'; text: string } =>
            block.type === 'text',
        )
        .some((block) => block.text === 'Let me search for that...'),
    );
    expect(hasExpectedText).toBe(true);
    const hasToolCall = messages.some((m) =>
      m.blocks.some((block) => block.type === 'tool_call'),
    );
    expect(hasToolCall).toBe(true);
  });

  it('should not yield thinking block for empty/whitespace-only reasoning', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"   "}\n\n',
      'data: {"type":"response.reasoning_text.delta","sequence_number":2,"delta":"\\n\\t"}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":3}\n\n',
      'data: {"type":"response.output_text.delta","delta":"Hello!"}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const hasThinking = messages.some((m) =>
      m.blocks.some((block) => block.type === 'thinking'),
    );
    expect(hasThinking).toBe(false);
    const hasText = messages.some((m) =>
      m.blocks.some((block) => block.type === 'text'),
    );
    expect(hasText).toBe(true);
  });

  it('should keep streaming reasoning deltas spaced correctly', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"First"}\n\n',
      'data: {"type":"response.reasoning_text.delta","sequence_number":2,"delta":"chunk"}\n\n',
      'data: {"type":"response.reasoning_text.delta","sequence_number":3,"delta":"next"}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":4}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const thoughts = messages.flatMap((message) =>
      message.blocks
        .filter((block) => block.type === 'thinking')
        .map((block) => block.thought),
    );
    const lastThought = thoughts[thoughts.length - 1] ?? '';
    expect(lastThought).toBe('First chunk next');
  });

  it('should handle reasoning with usage metadata', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"Thinking deeply..."}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":2}\n\n',
      'data: {"type":"response.output_text.delta","delta":"Here is my answer."}\n\n',
      'data: {"type":"response.completed","sequence_number":4,"response":{"id":"resp_123","object":"response","model":"gpt-5.2","status":"completed","usage":{"input_tokens":100,"output_tokens":50,"total_tokens":150}}}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const hasThinking = messages.some((m) =>
      m.blocks.some((block) => block.type === 'thinking'),
    );
    expect(hasThinking).toBe(true);
    const hasText = messages.some((m) =>
      m.blocks.some((block) => block.type === 'text'),
    );
    expect(hasText).toBe(true);
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
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const thinkingMessages = messages.filter((m) =>
      m.blocks.some((block) => block.type === 'thinking'),
    );
    expect(thinkingMessages).toHaveLength(2);
  });

  it('should NOT emit pyramid-style repeated prefixes', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"Let"}\n\n',
      'data: {"type":"response.reasoning_text.delta","sequence_number":2,"delta":"me"}\n\n',
      'data: {"type":"response.reasoning_text.delta","sequence_number":3,"delta":"think"}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":4}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const thinkingMessages = messages.filter((m) =>
      m.blocks.some((block) => block.type === 'thinking'),
    );
    expect(thinkingMessages).toHaveLength(1);

    const thoughtText = thinkingMessages[0].blocks.find(
      (block) => block.type === 'thinking',
    )?.thought;
    expect(thoughtText).toBe('Let me think');
    expect(thoughtText).not.toMatch(/Let.*Let/);
  });

  it('should preserve spacing between summary deltas', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_summary_text.delta","sequence_number":1,"delta":"Planning"}\n\n',
      'data: {"type":"response.reasoning_summary_text.delta","sequence_number":2,"delta":"repo"}\n\n',
      'data: {"type":"response.reasoning_summary_text.delta","sequence_number":3,"delta":"inspection"}\n\n',
      'data: {"type":"response.reasoning_summary_text.done","sequence_number":4}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const thinkingMessages = messages.filter((m) =>
      m.blocks.some((block) => block.type === 'thinking'),
    );
    const thoughts = thinkingMessages.flatMap((message) =>
      message.blocks
        .filter((block) => block.type === 'thinking')
        .map((block) => block.thought),
    );
    const lastThought = thoughts[thoughts.length - 1] ?? '';
    expect(lastThought).toBe('Planning repo inspection');
  });

  it('should NOT yield ThinkingBlock on delta events, only on done', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"First"}\n\n',
      'data: {"type":"response.reasoning_text.delta","sequence_number":2,"delta":"second"}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":3}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const thinkingMessages = messages.filter((m) =>
      m.blocks.some((block) => block.type === 'thinking'),
    );
    expect(thinkingMessages).toHaveLength(1);

    const thinkingBlock = thinkingMessages[0].blocks.find(
      (block) => block.type === 'thinking',
    );
    expect(thinkingBlock?.thought).toBe('First second');
  });

  it('should not duplicate reasoning when output_item.done follows deltas', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"First"}\n\n',
      'data: {"type":"response.reasoning_text.delta","sequence_number":2,"delta":"second"}\n\n',
      'data: {"type":"response.output_item.done","item":{"type":"reasoning","id":"reasoning_1","summary":[{"type":"summary_text","text":"First second"}]}}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const thoughtTexts = messages
      .flatMap((message) => message.blocks)
      .filter(
        (block): block is { type: 'thinking'; thought: string } =>
          block.type === 'thinking',
      )
      .map((block) => block.thought)
      .filter((thought) => thought.trim().length > 0);
    expect(thoughtTexts).toEqual(['First second']);
  });

  it('should yield reasoning before response.completed', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"Reasoning content"}\n\n',
      'data: {"type":"response.completed","sequence_number":2,"response":{"id":"resp_123","object":"response","model":"gpt-5.2","status":"completed","usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const thinkingIndex = messages.findIndex((m) =>
      m.blocks.some((block) => block.type === 'thinking'),
    );
    expect(thinkingIndex).toBeGreaterThanOrEqual(0);
    const usageIndex = messages.findIndex((m) => m.metadata?.usage);
    expect(usageIndex).toBeGreaterThanOrEqual(0);
    expect(thinkingIndex).toBeLessThan(usageIndex);
  });
});
