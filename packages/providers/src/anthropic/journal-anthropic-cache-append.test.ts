/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';
import {
  emittedCandidate,
  type StripPolicy,
} from './message-table/__tests__/support/wireBuilderHarness.js';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
import {
  anthropicLengthRegistration,
  planStoredAnthropicRequest,
} from './journal-anthropic-length.js';
import { AnthropicStreamRepair } from './anthropic-stream-repair.js';

const settings: RowFormatSettings = {
  formatId: 'anthropic',
  formatRev: 1,
  model: 'claude-opus-5',
  endpoint: 'https://api.anthropic.com',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: true,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: true,
  unsupportedMedia: 'notice',
  outputLimits: null,
  anthropic: { cache: 'off', cacheFacts: true, imageBudget: null },
};
const rows: readonly IContent[] = [
  {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'head 雪' }],
    metadata: { cacheAnchor: true },
  },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'first',
        sourceField: 'thinking',
        signature: 'sig',
      },
      { type: 'text', text: 'answer' },
    ],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'next' }] },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'last',
        sourceField: 'thinking',
        signature: 'sig',
      },
      { type: 'text', text: 'finish' },
    ],
  },
];

async function assertCached(
  session: JournalSession,
  input: readonly IContent[],
  strip: StripPolicy,
): Promise<void> {
  const snapshot = await session.store.snapshot();
  const query = await IndexedJournalRequestSnapshot.create(snapshot);
  try {
    const plan = await planStoredAnthropicRequest(
      snapshot,
      settings,
      { strip },
      { model: settings.model },
      { cache: '1h' },
    );
    const engine = await AnthropicStreamRepair.create(query, settings, {
      strip,
    });
    let actual = '';
    for await (const piece of engine.serialize(
      undefined,
      undefined,
      plan.cache,
    ))
      actual += piece;
    const expected = await emittedCandidate(
      await normalizedRows(input),
      { reasoningEnabled: true, strip, currentModel: settings.model },
      { ttl: '1h' },
    );
    expect(actual).toBe(expected);
    expect(plan.messagesBytes).toBe(Buffer.byteLength(expected));
  } finally {
    await query.close();
    await snapshot.close();
  }
}

const chainRows: readonly IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'question' }] },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'first',
        sourceField: 'thinking',
        signature: 'sig',
      },
    ],
    metadata: { cacheAnchor: true },
  },
  {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'anchored' }],
    metadata: { cacheAnchor: true },
  },
  { speaker: 'ai', blocks: [{ type: 'text', text: 'not anchored' }] },
  {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'anchor moves here' }],
    metadata: { cacheAnchor: true },
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'finish' }] },
];
async function checkAppends(
  input: readonly IContent[],
  path: string,
): Promise<number | undefined> {
  const session = await JournalSession.create(path, {
    journal: testJournalSeams().dependencies,
  });
  try {
    await session.append(input.slice(0, 1));
    await session.store.commit([
      {
        kind: 'factIndex',
        registration: anthropicRepairFactIndex(settings),
      },
    ]);
    await session.registerRowFormat(anthropicLengthRegistration(settings));
    for (let count = 1; count <= input.length; count++) {
      if (count > 1) await session.append([input[count - 1]]);
      const policies: readonly StripPolicy[] = ['none', 'all', 'allButLast'];
      for (const strip of policies)
        await assertCached(session, input.slice(0, count), strip);
    }
  } finally {
    await session.close();
  }
  const reopened = await JournalSession.open(path, {
    journal: testJournalSeams().dependencies,
  });
  try {
    const policies: readonly StripPolicy[] = ['none', 'all', 'allButLast'];
    for (const strip of policies) await assertCached(reopened, input, strip);
    return reopened.store.published?.aggregate.units;
  } finally {
    await reopened.close();
  }
}
describe('stored Anthropic caching after append', () => {
  const directory = useTempDir('anthropic-cache-append-');
  for (const input of [rows, chainRows])
    it(`moves the tail and preserves the anchor through ${input.length} appends for every thinking policy`, async () => {
      expect(await checkAppends(input, `${directory()}/cache.llxj`)).toBe(
        input.length,
      );
    });
});
