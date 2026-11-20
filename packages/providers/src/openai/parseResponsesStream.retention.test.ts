/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import {
  MIB,
  RETAINED_BOUND,
  bigText,
} from '../__tests__/support/retainedText.js';
import { parseResponsesStream } from './parseResponsesStream.js';

function sseStream(events: readonly unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < events.length) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(events[index++])}\n\n`),
        );
      } else {
        controller.close();
      }
    },
  });
}

async function streamFailure(events: readonly unknown[]): Promise<unknown> {
  try {
    for await (const message of parseResponsesStream(sseStream(events))) {
      void message;
    }
  } catch (error: unknown) {
    return error;
  }
  throw new Error('expected the stream to fail');
}

describe('parseResponsesStream malformed tool arguments retention', () => {
  it('keeps none of the arguments alive through the snippet on the error', async () => {
    const baseline = await settledHeap();
    let held: unknown;
    const run = async (): Promise<void> => {
      held = await streamFailure([
        {
          type: 'response.output_item.added',
          item: { type: 'function_call', id: 'fc1', call_id: 'c1', name: 't' },
        },
        {
          type: 'response.function_call_arguments.done',
          item_id: 'fc1',
          arguments: bigText(7 * MIB),
        },
      ]);
    };
    await run();
    const afterFailure = await settledHeap();

    expect(held).toBeInstanceOf(Error);
    expect(JSON.stringify(held)).toContain('fc1');
    expect(afterFailure - baseline).toBeLessThan(RETAINED_BOUND);
  });
});
