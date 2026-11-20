/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { normalizedRows } from './support/frozenWire/normalizedRows.js';
import { rowsSelection } from './support/wireBodyCapture.js';
import {
  anthropicJournalSink,
  sendAnthropicJournalCase,
} from './support/anthropic-journal-case.js';

const histories: ReadonlyArray<{ name: string; rows: readonly IContent[] }> = [
  { name: 'empty', rows: [] },
  {
    name: 'anchored string',
    rows: [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'head 雪' }],
        metadata: { cacheAnchor: true },
      },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'answer' }] },
      { speaker: 'human', blocks: [{ type: 'text', text: 'tail 🐈' }] },
    ],
  },
  {
    name: 'merged anchor',
    rows: [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'first' }],
        metadata: { cacheAnchor: true },
      },
      { speaker: 'human', blocks: [{ type: 'text', text: 'second' }] },
    ],
  },
  {
    name: 'assistant tail',
    rows: [
      { speaker: 'human', blocks: [{ type: 'text', text: 'question' }] },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'think',
            sourceField: 'thinking',
            signature: 'sig',
          },
          { type: 'text', text: 'answer' },
        ],
        metadata: { cacheAnchor: true },
      },
    ],
  },
  {
    name: 'anchored thinking chain',
    rows: [
      { speaker: 'human', blocks: [{ type: 'text', text: 'question' }] },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'thinking',
            sourceField: 'thinking',
            signature: 'sig',
          },
        ],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'anchored chain' }],
        metadata: { cacheAnchor: true },
      },
      { speaker: 'human', blocks: [{ type: 'text', text: 'tail' }] },
    ],
  },
  {
    name: 'repaired tools',
    rows: [
      { speaker: 'human', blocks: [{ type: 'text', text: 'look' }] },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_missing',
            name: 'lookup',
            parameters: {},
          },
        ],
        metadata: { cacheAnchor: true },
      },
      { speaker: 'human', blocks: [{ type: 'text', text: 'finish' }] },
    ],
  },
];

async function cachedSend(
  history: (typeof histories)[number],
  ttl: string,
  authToken = 'test-api-key',
  projected = true,
): Promise<void> {
  const sink = await anthropicJournalSink();
  const fixture = await journalSendFixture(history.rows, [], {
    directory: `${import.meta.dir}/../../../../tmp/anthropic-cases/fixtures`,
  });
  const original = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      const url = new URL(
        typeof input === 'string' || input instanceof URL ? input : input.url,
      );
      return original(sink.route.baseURL + url.pathname, init);
    },
    { preconnect: original.preconnect },
  );
  const route = {
    ...sink.route,
    baseURL: 'https://api.anthropic.com',
    providerSettings: { 'prompt-caching': ttl },
    ephemerals: {
      ...sink.route.ephemerals,
      'reasoning.enabled': true,
      'reasoning.includeInContext': true,
    },
  };
  try {
    const expectedTokens = await sendAnthropicJournalCase(
      route,
      rowsSelection(await normalizedRows(history.rows)),
      {},
      authToken,
      projected,
    );
    let actualTokens: number | undefined;
    const created = await operationFileCreates(async () => {
      actualTokens = await sendAnthropicJournalCase(
        route,
        fixture.selection,
        {},
        authToken,
        projected,
      );
    }, true);
    expect(actualTokens).toBe(expectedTokens);
    expect(sink.requests).toHaveLength(2);
    expect(sink.requests[1]).toStrictEqual(sink.requests[0]);
    expect(sink.requests[1].length).toBe(
      String(Buffer.byteLength(sink.requests[1].body)),
    );
    expect(sink.requests[1].body).toContain('cache_control');
    expect(created).toStrictEqual({ files: [], directories: [] });
  } finally {
    globalThis.fetch = original;
    await fixture.close();
    await sink.close();
  }
}

describe('native cached Anthropic production HTTP', () => {
  for (const ttl of ['5m', '1h']) {
    for (const history of histories) {
      for (const projected of [false, true])
        it(`sends ${history.name} with ${ttl} builder bytes, projected=${projected}, and no files`, () =>
          expect(
            cachedSend(history, ttl, 'test-api-key', projected),
          ).resolves.toBeUndefined());
    }
    it(`preserves cached OAuth context placement with ${ttl}`, () =>
      expect(
        cachedSend(histories[1], ttl, 'sk-ant-oat-cache'),
      ).resolves.toBeUndefined());
  }
});
