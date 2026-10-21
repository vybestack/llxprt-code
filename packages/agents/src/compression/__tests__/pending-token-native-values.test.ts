/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { truncateLargestToolResponses } from '../toolResultTruncator.js';
import { withNativeValueFixture } from './support/native-value-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import {
  freezeRows,
  lengthTokenizer,
  pendingTokenDeps,
  PENDING_BUDGET,
} from './pending-token-native-helpers.js';

function response(callId: string): IContent['blocks'][number] {
  return {
    type: 'tool_response',
    callId,
    toolName: 'read_file',
    result: 'x'.repeat(4096),
    isComplete: false,
  };
}
describe('pending-token native complete values and ties', () => {
  it('selects the latest response block on a tie and preserves the incomplete unselected result', async () => {
    await withNativeValueFixture(async ({ history }) => {
      lengthTokenizer(history);
      const first = response('call-a');
      const last = response('call-b');
      const input: IContent[] = [{ speaker: 'tool', blocks: [first, last] }];
      freezeRows(input);
      await history.detachedValues.replace(input);
      const limit = history.getTotalTokens() + PENDING_BUDGET - 1;
      expect(
        await truncateLargestToolResponses(pendingTokenDeps(history), limit),
      ).toMatchObject({ replacedCount: 1, success: true });
      const [actual] = await Array.fromAsync(history.streamRawHistory());
      expect(actual.blocks[0]).toStrictEqual(first);
      expect(actual.blocks[1]).toMatchObject({
        callId: 'call-b',
        isComplete: true,
        providerMetadata: { contextTruncated: true },
      });
      expect(input[0].blocks).toStrictEqual([first, last]);
    });
  });
  it('keeps the entire nine-MiB human value while stubbing only the oversized response', async () => {
    await withNativeValueFixture(async ({ history, durable }) => {
      lengthTokenizer(history);
      const text = 'large-preserved-value:'
        .repeat(Math.ceil((9 * 1024 * 1024 + 17) / 22))
        .slice(0, 9 * 1024 * 1024 + 17);
      const human: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text }],
        metadata: {
          chronology: { seq: 1, userTurn: 1, step: 1, recordedAt: 0 },
        },
      };
      await history.detachedValues.replace([
        human,
        { speaker: 'tool', blocks: [response('large')] },
      ]);
      const limit = history.getTotalTokens() + PENDING_BUDGET - 1;
      const files = await operationFileCreates(async () => {
        expect(
          await truncateLargestToolResponses(pendingTokenDeps(history), limit),
        ).toMatchObject({ replacedCount: 1, success: true });
      }, true);
      const actual = await Array.fromAsync(history.streamRawHistory());
      expect(actual[0]).toStrictEqual(human);
      expect(text).toHaveLength(9 * 1024 * 1024 + 17);
      expect(await durable()).toStrictEqual(
        await compressionValueDigest(actual),
      );
      expect(files).toStrictEqual({ directories: [], files: [] });
    });
  }, 180_000);
  it('preserves error status and complete truncation metadata for failed tools', async () => {
    await withNativeValueFixture(async ({ history }) => {
      lengthTokenizer(history);
      await history.detachedValues.replace([
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'failed',
              toolName: 'write_file',
              result: null,
              error: 'error'.repeat(4096),
              isComplete: false,
            },
          ],
        },
      ]);
      const limit = history.getTotalTokens() + PENDING_BUDGET - 1;
      expect(
        await truncateLargestToolResponses(pendingTokenDeps(history), limit),
      ).toMatchObject({ replacedCount: 1, success: true });
      const [actual] = await Array.fromAsync(history.streamRawHistory());
      expect(actual.blocks[0]).toMatchObject({
        callId: 'failed',
        result: null,
        isComplete: true,
        providerMetadata: { contextTruncated: true },
      });
      const block = actual.blocks[0];
      if (block.type !== 'tool_response')
        throw new Error('Missing failed response');
      expect(block.error).toContain('The tool execution failed.');
    });
  });
});
