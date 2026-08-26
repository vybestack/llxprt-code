/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type Anthropic from '@anthropic-ai/sdk';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { processAnthropicStream } from './anthropic/AnthropicStreamProcessor.js';
import { parseResponsesStream } from './openai/parseResponsesStream.js';
import { ToolCallCollector } from './openai/ToolCallCollector.js';
import {
  MAX_PROVIDER_SSE_LINE_BYTES,
  MAX_PROVIDER_TOOL_CALL_BYTES,
  assertProviderStreamFragmentLimit,
  ProviderStreamProtocolError,
} from './streamLimits.js';

const ONE_MIB = 1024 * 1024;

function createSseStream(
  chunks: readonly string[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index++;
    },
  });
}

function sseEvent(event: Readonly<Record<string, unknown>>): string {
  return `data: ${JSON.stringify(event)}\n`;
}

async function collect(stream: AsyncIterable<IContent>): Promise<IContent[]> {
  const content: IContent[] = [];
  for await (const item of stream) {
    content.push(item);
  }
  return content;
}

function responsesToolCallStart(): string {
  return sseEvent({
    type: 'response.output_item.added',
    item: {
      id: 'item-1',
      type: 'function_call',
      call_id: 'call-1',
      name: 'store_payload',
      arguments: '',
    },
  });
}

function responsesToolCallDelta(delta: string): string {
  return sseEvent({
    type: 'response.function_call_arguments.delta',
    item_id: 'item-1',
    delta,
  });
}

const anthropicOptions = {
  isOAuth: false,
  tools: undefined,
  unprefixToolName: (name: string) => name,
  findToolSchema: () => undefined,
  logger: { debug: () => undefined },
  cacheLogger: { debug: () => undefined },
  rateLimitLogger: { debug: () => undefined },
  includeThinkingInResponse: true,
};

async function* anthropicToolStream(
  argumentFragments: readonly string[],
): AsyncGenerator<Anthropic.MessageStreamEvent> {
  yield {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'tool_use',
      id: 'tool-1',
      name: 'store_payload',
      input: {},
    },
  };
  for (const partialJson of argumentFragments) {
    yield {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: partialJson },
    };
  }
  yield { type: 'content_block_stop', index: 0 };
}

function findToolCall(content: readonly IContent[]) {
  for (const item of content) {
    const toolCall = item.blocks.find((block) => block.type === 'tool_call');
    if (toolCall?.type === 'tool_call') {
      return toolCall;
    }
  }
  return undefined;
}

describe('retained entry bounds', () => {
  it('does not retain a fragment that carries no identity and no payload', () => {
    // Empty deltas cost nothing against the byte budget but still cost an
    // object each and lengthen the linear duplicate scan, so a peer emitting
    // them indefinitely grows memory without ever tripping the byte cap.
    const collector = new ToolCallCollector();
    collector.addFragment(0, { id: '', name: '', args: '' });
    collector.addFragment(0, {});

    expect(collector.getCompleteCalls()).toStrictEqual([]);
  });

  it('still retains a fragment that carries only arguments', () => {
    const collector = new ToolCallCollector();
    collector.addFragment(0, { id: 'call-1', name: 'do_thing' });
    collector.addFragment(0, { args: '{"a":1}' });

    expect(collector.getCompleteCalls()).toHaveLength(1);
  });

  it('reports a count overrun the same way as a byte overrun', () => {
    expect(() =>
      assertProviderStreamFragmentLimit('tool-call fragments', 11, 10),
    ).toThrow(ProviderStreamProtocolError);
  });

  it('accepts a count exactly at the limit', () => {
    expect(() =>
      assertProviderStreamFragmentLimit('tool-call fragments', 10, 10),
    ).not.toThrow();
  });
});

describe('provider stream byte limits', () => {
  it('rejects an oversized OpenAI Responses incomplete SSE line with a typed protocol error', async () => {
    const oversizedLine = 'x'.repeat(MAX_PROVIDER_SSE_LINE_BYTES + 1);

    const result = collect(
      parseResponsesStream(createSseStream([oversizedLine])),
    );

    await expect(result).rejects.toBeInstanceOf(ProviderStreamProtocolError);
    await expect(result).rejects.toThrow(
      `SSE line exceeded ${MAX_PROVIDER_SSE_LINE_BYTES}-byte limit`,
    );
  });

  it('rejects an oversized COMPLETE OpenAI Responses SSE line', async () => {
    // Measuring only the unfinished remainder after the newline split is
    // bypassed by a single terminating newline: the oversized value then lands
    // in the completed lines and is parsed unmeasured. The only difference from
    // the test above is that newline.
    const oversizedLine = `${'x'.repeat(MAX_PROVIDER_SSE_LINE_BYTES + 1)}\n`;

    const result = collect(
      parseResponsesStream(createSseStream([oversizedLine])),
    );

    await expect(result).rejects.toBeInstanceOf(ProviderStreamProtocolError);
  });

  it('rejects oversized OpenAI Responses tool arguments per call', async () => {
    const fragment = 'x'.repeat(ONE_MIB);
    const chunks = [
      responsesToolCallStart(),
      ...Array.from(
        { length: Math.floor(MAX_PROVIDER_TOOL_CALL_BYTES / ONE_MIB) + 1 },
        () => responsesToolCallDelta(fragment),
      ),
    ];

    const result = collect(parseResponsesStream(createSseStream(chunks)));

    await expect(result).rejects.toBeInstanceOf(ProviderStreamProtocolError);
    await expect(result).rejects.toThrow(
      `tool-call arguments exceeded ${MAX_PROVIDER_TOOL_CALL_BYTES}-byte limit`,
    );
  });

  it('preserves a large legitimate OpenAI Responses tool argument byte-for-byte', async () => {
    const payload = 'ø'.repeat(ONE_MIB / 2);
    const argumentsJson = JSON.stringify({ payload });
    const chunks = [
      responsesToolCallStart(),
      responsesToolCallDelta(argumentsJson),
      sseEvent({
        type: 'response.function_call_arguments.done',
        item_id: 'item-1',
      }),
    ];

    const content = await collect(
      parseResponsesStream(createSseStream(chunks)),
    );

    expect(JSON.stringify(findToolCall(content)?.parameters)).toBe(
      argumentsJson,
    );
  });

  it('rejects oversized Anthropic tool arguments per call', async () => {
    const fragment = 'x'.repeat(ONE_MIB);
    const fragments = Array.from(
      { length: Math.floor(MAX_PROVIDER_TOOL_CALL_BYTES / ONE_MIB) + 1 },
      () => fragment,
    );

    const result = collect(
      processAnthropicStream(anthropicToolStream(fragments), anthropicOptions),
    );

    await expect(result).rejects.toBeInstanceOf(ProviderStreamProtocolError);
    await expect(result).rejects.toThrow(
      `tool-call arguments exceeded ${MAX_PROVIDER_TOOL_CALL_BYTES}-byte limit`,
    );
  });

  it('preserves a large legitimate Anthropic tool argument byte-for-byte', async () => {
    const payload = 'ø'.repeat(ONE_MIB / 2);
    const argumentsJson = JSON.stringify({ payload });

    const content = await collect(
      processAnthropicStream(
        anthropicToolStream([argumentsJson]),
        anthropicOptions,
      ),
    );

    expect(JSON.stringify(findToolCall(content)?.parameters)).toBe(
      argumentsJson,
    );
  });
});
