/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type Anthropic from '@anthropic-ai/sdk';
import {
  processAnthropicStream,
  type StreamProcessorOptions,
} from './AnthropicStreamProcessor.js';

const options: StreamProcessorOptions = {
  isOAuth: false,
  tools: undefined,
  unprefixToolName: (name) => name,
  findToolSchema: () => undefined,
  logger: { debug: () => undefined },
  cacheLogger: { debug: () => undefined },
  rateLimitLogger: { debug: () => undefined },
  includeThinkingInResponse: true,
};

describe('Anthropic raw tool argument arrival', () => {
  it('yields each raw argument before pulling another upstream event', async () => {
    let pulled = 0;
    async function* events(): AsyncGenerator<Anthropic.MessageStreamEvent> {
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'call_a',
          name: 'lookup',
          input: {},
        },
      };
      pulled++;
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"x":' },
      };
      pulled++;
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '1}' },
      };
      pulled++;
      yield { type: 'content_block_stop', index: 0 };
      yield { type: 'message_stop' };
    }
    const stream = processAnthropicStream(events(), options);
    try {
      const first = await stream.next();
      expect(pulled).toBe(1);
      if (first.done === true) throw new Error('Missing raw argument arrival');
      expect(first.value.toolArgumentDelta?.arguments).toBe('{"x":');
      const second = await stream.next();
      expect(pulled).toBe(2);
      if (second.done === true)
        throw new Error('Missing second argument arrival');
      expect(second.value.toolArgumentDelta?.arguments).toBe('1}');
      const final = await stream.next();
      if (final.done === true) throw new Error('Missing completed tool');
      expect(final.value.toolArgumentDelta?.complete).toBe(true);
      expect(final.value.toolArgumentDelta?.id).toBe(
        first.value.toolArgumentDelta?.id,
      );
      expect(final.value.blocks[0]).toMatchObject({
        type: 'tool_call',
        parameters: { x: 1 },
        id: final.value.toolArgumentDelta?.id,
      });
    } finally {
      await stream.return(undefined);
    }
  });
});
