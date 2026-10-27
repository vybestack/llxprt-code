/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { metricReference } from '../../storage/media-metrics-test-helpers.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DebugLogger } from '../../debug/DebugLogger.js';
import { NeutralTextStream } from '../../utils/neutral-text-stream.js';
import { estimateTokens } from '../../utils/toolOutputLimiter.js';
import { JournalSession } from './journalSession.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { estimateContentTokens } from './historyTokenEstimation.js';
import { estimateSealedTokens } from './sealed-token-estimation.js';
import type { IContent } from './IContent.js';
import { JournalTokenRows } from './journal-token-rows.js';
import { estimateTokenRange } from './estimate-token-range.js';

export async function countStream(
  parts: AsyncIterable<Uint8Array>,
): Promise<number> {
  const counter = new NeutralTextStream();
  for await (const part of parts) counter.append(part);
  return counter.finish();
}
const provider = {
  getTokenizerForModel: () => ({
    countTokens: (text: unknown) => estimateTokens(String(text)),
    countTokenStream: countStream,
  }),
};
const logger = new DebugLogger('sealed-token-test');

const contents: readonly IContent[] = [
  {
    speaker: 'human',
    blocks: [
      {
        ...metricReference(1),
        caption: 'a snowy landscape',
        dimensions: { width: 1024, height: 512 },
      },
    ],
  },
  {
    speaker: 'ai',
    blocks: [
      { type: 'text', text: '雪ABCdef '.repeat(9000) },
      { type: 'thinking', thought: "I'm thinking\n \t 雪ABC" },
      { type: 'code', code: 'const x = "😀";\n' },
    ],
  },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'call-1',
        name: 'shell',
        parameters: { command: 'echo 雪', nested: [1, 2, { x: '' }] },
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call-1',
        toolName: 'shell',
        error: 'failed 雪',
        result: { remedy: 'try again', output: 'body '.repeat(20000) },
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'empty',
        toolName: 'shell',
        error: 'failed',
        result: '',
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'null',
        toolName: 'shell',
        result: null,
      },
    ],
  },
];

describe('sealed row token estimates', () => {
  it('matches whole-row estimates for text, thinking, code and tool JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sealed-token-estimation-'));
    const session = await JournalSession.create(join(root, 'primary.llxj'));
    const store = new JournalHistoryStore(session);
    try {
      for (const content of contents) store.apply({ kind: 'content', content });
      await store.waitForDurable();
      const snapshot = await session.store.snapshot();
      spyOn(snapshot, 'readRow').mockImplementation(() => {
        throw new Error('Whole row hydration');
      });
      spyOn(snapshot, 'readBlock').mockImplementation(() => {
        throw new Error('Whole block hydration');
      });
      try {
        for (const [index, content] of contents.entries())
          expect(
            await estimateSealedTokens(
              snapshot,
              await snapshot.entryAt(index),
              'gpt-5.6',
              provider,
              logger,
            ),
          ).toBe(
            await estimateContentTokens(content, 'gpt-5.6', provider, logger),
          );
        const rows = new JournalTokenRows({
          snapshot: async () => snapshot.retain(),
          takeDraft: () => undefined,
          releaseDraft: () => undefined,
        });
        const estimated = await estimateTokenRange(
          rows.capture(contents.length - 1, undefined, 0),
          'gpt-5.6',
          provider,
          logger,
        );
        let expected = 0;
        for (const content of contents)
          expected += await estimateContentTokens(
            content,
            'gpt-5.6',
            provider,
            logger,
          );
        expect(estimated).toStrictEqual({ tokens: expected, rows: contents.length });
      } finally {
        await snapshot.close();
      }
    } finally {
      await store.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
