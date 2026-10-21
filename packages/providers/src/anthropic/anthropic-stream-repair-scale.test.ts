/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { emittedCandidate } from './message-table/__tests__/support/wireBuilderHarness.js';
import { withAnthropicStreamRepair } from './anthropic-stream-repair.js';

const settings: RowFormatSettings = {
  formatId: 'anthropic',
  formatRev: 1,
  model: 'claude-sonnet-4',
  endpoint: 'https://api.anthropic.com',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: true,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: true,
  unsupportedMedia: 'notice',
  outputLimits: null,
  anthropic: { cache: 'off', imageBudget: null },
};
const hash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

interface Work {
  readonly reads: number;
  readonly unitReads: number;
}
function chainRows(count: number): readonly IContent[] {
  return [
    { speaker: 'human', blocks: [{ type: 'text', text: 'q' }] },
    ...Array.from(
      { length: count },
      (_, index): IContent => ({
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            sourceField: 'thinking',
            thought: `thought ${index}`,
            signature: `signature ${index}`,
          },
        ],
      }),
    ),
    { speaker: 'ai', blocks: [{ type: 'text', text: 'answer' }] },
  ];
}
async function checkStream(
  query: IndexedJournalRequestSnapshot,
  expected: string,
): Promise<number> {
  return withAnthropicStreamRepair(
    query,
    settings,
    { strip: 'allButLast' },
    async (engine) => {
      const actual = createHash('sha256');
      let bytes = 0;
      for await (const chunk of engine.serialize()) {
        actual.update(chunk);
        bytes += Buffer.byteLength(chunk);
      }
      expect(actual.digest('hex')).toBe(hash(expected));
      expect(await engine.measure()).toStrictEqual({ bytes, messages: 3 });
      return engine.source.work.unitReads;
    },
  );
}
async function checkChain(path: string, count: number): Promise<Work> {
  const rows = chainRows(count);
  const expected = await emittedCandidate(
    rows,
    {
      reasoningEnabled: true,
      strip: 'allButLast',
      currentModel: settings.model,
    },
    {},
  );
  const counter = { reads: 0 };
  const session = await JournalSession.create(path, {
    journal: testJournalSeams({ readCounter: counter }, 1, false).dependencies,
  });
  try {
    await session.append(rows);
    const pin = await session.store.snapshot();
    const query = await IndexedJournalRequestSnapshot.create(pin);
    const base = counter.reads;
    try {
      const unitReads = await checkStream(query, expected);
      const reads = counter.reads - base;
      process.stdout.write(
        `Anthropic chain work ${JSON.stringify({ count, reads, unitReads, bytes: Buffer.byteLength(expected), pid: process.pid })}\n`,
      );
      return { reads, unitReads };
    } finally {
      await query.close();
      await pin.close();
    }
  } finally {
    await session.close();
  }
}

describe('native Anthropic long-chain stream work', () => {
  const directory = useTempDir('anthropic-repair-scale-');
  let small: Work = { reads: 0, unitReads: 0 };
  it('matches old bytes while streaming 40 chain units with bounded pieces', async () => {
    small = await checkChain(`${directory()}/small.llxj`, 40);
    expect(small.unitReads).toBeLessThan(40 * 32 + 200);
  });
  it('matches old bytes while streaming 4000 chain units with bounded pieces', async () => {
    const large = await checkChain(`${directory()}/large.llxj`, 4000);
    expect(large.unitReads).toBeLessThan(4000 * 32 + 200);
    expect(large.reads).toBeLessThan(small.reads * 250);
    expect(large.unitReads).toBeLessThan(small.unitReads * 105);
  });
});
