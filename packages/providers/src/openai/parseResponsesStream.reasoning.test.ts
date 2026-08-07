import { describe, it, expect } from 'bun:test';
import type {
  IContent,
  ThinkingBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

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

function collectThinkingBlocks(messages: IContent[]): ThinkingBlock[] {
  return messages
    .flatMap((message) => message.blocks)
    .filter((block): block is ThinkingBlock => block.type === 'thinking');
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

    const thoughts = collectThinkingBlocks(messages).map(
      (block) => block.thought,
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

    const thoughts = collectThinkingBlocks(messages).map(
      (block) => block.thought,
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
    expect(usageMessage?.metadata?.usage).toStrictEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cachedTokens: 0,
    });
  });

  it('should emit only reasoning_text thinking blocks and suppress reasoning_summary_text when both are present', async () => {
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

    const thinkingBlocks = collectThinkingBlocks(messages);
    expect(thinkingBlocks.map((block) => block.thought)).toStrictEqual([
      'Raw reasoning.',
      'Raw reasoning.',
    ]);
    expect(thinkingBlocks.map((block) => block.streamStatus)).toStrictEqual([
      'delta',
      'complete',
    ]);
  });

  it('streams reasoning deltas as same-stream incremental thinking updates', async () => {
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

    const thinkingBlocks = collectThinkingBlocks(messages);
    expect(thinkingBlocks.map((block) => block.thought)).toStrictEqual([
      'Let',
      'Let me',
      'Let me think',
      'Let me think',
    ]);
    const streamIds = thinkingBlocks.map((block) => block.streamId);
    expect(new Set(streamIds)).toStrictEqual(
      new Set(['openai-responses-reasoning:0']),
    );
    expect(thinkingBlocks.map((block) => block.streamStatus)).toStrictEqual([
      'delta',
      'delta',
      'delta',
      'complete',
    ]);
  });

  it('closes active reasoning lifecycle when response completes without done event', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"Checking"}\n\n',
      'data: {"type":"response.completed","sequence_number":2,"response":{"id":"resp_123","object":"response","model":"gpt-5.2","status":"completed"}}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const thinkingBlocks = collectThinkingBlocks(messages);
    expect(thinkingBlocks.map((block) => block.thought)).toStrictEqual([
      'Checking',
      'Checking',
    ]);
    expect(thinkingBlocks.map((block) => block.streamId)).toStrictEqual([
      'openai-responses-reasoning:0',
      'openai-responses-reasoning:0',
    ]);
    expect(thinkingBlocks.map((block) => block.streamStatus)).toStrictEqual([
      'delta',
      'complete',
    ]);
  });

  it('uses a distinct stream id for each reasoning lifecycle', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"First"}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":2}\n\n',
      'data: {"type":"response.reasoning_text.delta","sequence_number":3,"delta":"Second"}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":4}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const thinkingBlocks = collectThinkingBlocks(messages);
    expect(thinkingBlocks.map((block) => block.thought)).toStrictEqual([
      'First',
      'First',
      'Second',
      'Second',
    ]);
    expect(thinkingBlocks.map((block) => block.streamId)).toStrictEqual([
      'openai-responses-reasoning:0',
      'openai-responses-reasoning:0',
      'openai-responses-reasoning:1',
      'openai-responses-reasoning:1',
    ]);
    expect(thinkingBlocks.map((block) => block.streamStatus)).toStrictEqual([
      'delta',
      'complete',
      'delta',
      'complete',
    ]);
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

    const thoughts = collectThinkingBlocks(messages).map(
      (block) => block.thought,
    );
    expect(thoughts).toStrictEqual([
      'Planning',
      'Planning repo',
      'Planning repo inspection',
      'Planning repo inspection',
    ]);
  });

  it('yields ThinkingBlock updates on delta events before done', async () => {
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

    const thinkingBlocks = collectThinkingBlocks(messages);
    expect(thinkingBlocks.map((block) => block.thought)).toStrictEqual([
      'First',
      'First second',
      'First second',
    ]);
    expect(thinkingBlocks[0]?.streamStatus).toBe('delta');
    expect(thinkingBlocks[2]?.streamStatus).toBe('complete');
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

    const thinkingBlocks = collectThinkingBlocks(messages);
    expect(thinkingBlocks.map((block) => block.thought)).toStrictEqual([
      'First',
      'First second',
      'First second',
    ]);
    expect(thinkingBlocks.map((block) => block.streamStatus)).toStrictEqual([
      'delta',
      'delta',
      'complete',
    ]);
  });

  it('should not duplicate hidden reasoning when output_item.done follows hidden deltas', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"First"}\n\n',
      'data: {"type":"response.reasoning_text.delta","sequence_number":2,"delta":"second"}\n\n',
      'data: {"type":"response.output_item.done","item":{"type":"reasoning","id":"reasoning_1","summary":[{"type":"summary_text","text":"First second"}]}}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream, {
      includeThinkingInResponse: false,
    })) {
      messages = [...messages, message];
    }

    const thinkingBlocks = collectThinkingBlocks(messages);
    expect(thinkingBlocks.map((block) => block.thought)).toStrictEqual([
      'First',
      'First second',
      'First second',
    ]);
    expect(thinkingBlocks.map((block) => block.streamStatus)).toStrictEqual([
      'delta',
      'delta',
      'complete',
    ]);
    expect(thinkingBlocks.every((block) => block.isHidden === true)).toBe(true);
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

  it('should emit only the summary ThinkingBlock when reasoning_summary_text arrives first (no reasoning_text)', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_summary_text.delta","sequence_number":1,"delta":"Summary only."}\n\n',
      'data: {"type":"response.reasoning_summary_text.done","sequence_number":2,"text":"Summary only."}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const thinkingBlocks = collectThinkingBlocks(messages);
    expect(thinkingBlocks.map((block) => block.thought)).toStrictEqual([
      'Summary only.',
      'Summary only.',
    ]);
    expect(thinkingBlocks.map((block) => block.streamStatus)).toStrictEqual([
      'delta',
      'complete',
    ]);
  });

  it('should suppress reasoning_summary_text when reasoning_text was already emitted', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"Full reasoning text"}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":2}\n\n',
      'data: {"type":"response.reasoning_summary_text.delta","sequence_number":3,"delta":"Condensed summary"}\n\n',
      'data: {"type":"response.reasoning_summary_text.done","sequence_number":4,"text":"Condensed summary"}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const thinkingBlocks = collectThinkingBlocks(messages);
    expect(thinkingBlocks.map((block) => block.thought)).toStrictEqual([
      'Full reasoning text',
      'Full reasoning text',
    ]);
  });

  it('should suppress reasoning_text when reasoning_summary_text was already emitted', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_summary_text.delta","sequence_number":1,"delta":"Summary first"}\n\n',

      'data: {"type":"response.reasoning_summary_text.done","sequence_number":2,"text":"Summary first"}\n\n',
      'data: {"type":"response.reasoning_text.delta","sequence_number":3,"delta":"Full text second"}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":4}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const thinkingBlocks = collectThinkingBlocks(messages);
    expect(thinkingBlocks.map((block) => block.thought)).toStrictEqual([
      'Summary first',
      'Summary first',
    ]);
  });

  it('does not emit suppressed summary at terminal completion after reasoning_text won', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"Full reasoning"}\n\n',
      'data: {"type":"response.reasoning_summary_text.delta","sequence_number":2,"delta":"Suppressed summary"}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":3}\n\n',
      'data: {"type":"response.completed","sequence_number":4,"response":{"id":"resp_123","object":"response","model":"gpt-5.2","status":"completed"}}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const thinkingBlocks = collectThinkingBlocks(messages);
    expect(thinkingBlocks.map((block) => block.thought)).toStrictEqual([
      'Full reasoning',
      'Full reasoning',
    ]);
    expect(
      thinkingBlocks.some((block) => block.thought === 'Suppressed summary'),
    ).toBe(false);
  });

  it('allows a new reasoning lifecycle after output_item.done closes the prior one', async () => {
    const chunks = [
      'data: {"type":"response.output_item.done","sequence_number":1,"item":{"type":"reasoning","id":"reasoning_1","summary":[{"type":"summary_text","text":"First lifecycle"}]}}\n\n',
      'data: {"type":"response.reasoning_text.delta","sequence_number":2,"delta":"Second"}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":3}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const thinkingBlocks = collectThinkingBlocks(messages);
    expect(thinkingBlocks.map((block) => block.thought)).toStrictEqual([
      'First lifecycle',
      'Second',
      'Second',
    ]);
    expect(thinkingBlocks.map((block) => block.streamStatus)).toStrictEqual([
      undefined,
      'delta',
      'complete',
    ]);
    expect(thinkingBlocks[1]?.streamId).toBe('openai-responses-reasoning:0');
    expect(thinkingBlocks[2]?.streamId).toBe('openai-responses-reasoning:0');
  });

  it('should re-emit hidden ThinkingBlock with encrypted_content after visible emission', async () => {
    const chunks = [
      'data: {"type":"response.reasoning_text.delta","sequence_number":1,"delta":"Thinking about this"}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":2}\n\n',
      'data: {"type":"response.output_item.done","item":{"type":"reasoning","id":"reasoning_1","summary":[{"type":"summary_text","text":"Thinking about this"}],"encrypted_content":"encrypted_data_here"}}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const thinkingBlocks = collectThinkingBlocks(messages);
    expect(thinkingBlocks).toHaveLength(3);

    expect(thinkingBlocks[0]?.isHidden).toBe(false);
    expect(thinkingBlocks[0]?.thought).toBe('Thinking about this');
    expect(thinkingBlocks[0]?.streamStatus).toBe('delta');

    expect(thinkingBlocks[1]?.isHidden).toBe(false);
    expect(thinkingBlocks[1]?.thought).toBe('Thinking about this');
    expect(thinkingBlocks[1]?.streamStatus).toBe('complete');

    expect(thinkingBlocks[2]?.isHidden).toBe(true);
    expect(thinkingBlocks[2]?.thought).toBe('Thinking about this');
    expect(thinkingBlocks[2]?.encryptedContent).toBe('encrypted_data_here');
  });

  it('treats reasoning_text after output_item.done as a new reasoning lifecycle', async () => {
    const outputItemData =
      '{"type":"response.output_item.done","item":{"type":"reasoning","id":"reasoning_1","summary":[{"type":"summary_text","text":"Visible from output_item"}]}}';
    const chunks = [
      `data: ${outputItemData}\n\n`,
      'data: {"type":"response.reasoning_text.delta","sequence_number":2,"delta":"Different reasoning text"}\n\n',
      'data: {"type":"response.reasoning_text.done","sequence_number":3}\n\n',
    ];

    const stream = createSSEStream(chunks);
    let messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages = [...messages, message];
    }

    const thinkingBlocks = collectThinkingBlocks(messages);
    expect(thinkingBlocks.map((block) => block.thought)).toStrictEqual([
      'Visible from output_item',
      'Different reasoning text',
      'Different reasoning text',
    ]);
    expect(thinkingBlocks.map((block) => block.streamStatus)).toStrictEqual([
      undefined,
      'delta',
      'complete',
    ]);
  });
});
