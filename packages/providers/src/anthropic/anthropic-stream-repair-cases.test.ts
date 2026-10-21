/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { anthropicScenarios } from '../__tests__/support/frozenWire/explicit/anthropicCases.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';
import {
  emittedCandidate,
  oracleJson,
  type WireSettings,
} from './message-table/__tests__/support/wireBuilderHarness.js';
import { wireSettingsOf } from './message-table/__tests__/support/lengthModel/frozenInputs.js';
import {
  withAnthropicStreamRepair,
  type AnthropicStreamRepair,
} from './anthropic-stream-repair.js';

const settingsOf = (wire: WireSettings): RowFormatSettings => ({
  formatId: 'anthropic',
  formatRev: 1,
  model: wire.currentModel ?? 'claude-sonnet-4',
  endpoint: 'https://api.anthropic.com',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: wire.reasoningEnabled,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: true,
  unsupportedMedia: 'notice',
  outputLimits: null,
  anthropic: { cache: 'off', imageBudget: null },
});
async function serialized(engine: AnthropicStreamRepair): Promise<string> {
  let result = '';
  for await (const chunk of engine.serialize()) result += chunk;
  return result;
}

describe('native Anthropic named repair and finish cases', () => {
  const directory = useTempDir('anthropic-repair-cases-');
  async function withQuery<T>(
    rows: readonly IContent[],
    consume: (query: IndexedJournalRequestSnapshot) => Promise<T>,
  ): Promise<T> {
    const session = await JournalSession.create(`${directory()}/cases.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.store.commit([
        {
          kind: 'replace',
          rows: rows.map((row) => encodeContentRow(row, { owner: 0 })),
        },
      ]);
      const pin = await session.store.snapshot();
      const query = await IndexedJournalRequestSnapshot.create(pin);
      try {
        return await consume(query);
      } finally {
        await query.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  }

  for (const scenario of anthropicScenarios()) {
    it(`writes independent normalized old bytes for ${scenario.name} with caching off`, async () => {
      const wire = wireSettingsOf(
        scenario.send.model ?? 'claude-opus-5',
        scenario.send.ephemerals ?? {},
      );
      const normalized = await normalizedRows(scenario.send.rows);
      const expected = await emittedCandidate(normalized, wire, {});
      expect(expected).toBe(oracleJson(normalized, wire));
      await withQuery(scenario.send.rows, async (query) => {
        await withAnthropicStreamRepair(
          query,
          settingsOf(wire),
          wire,
          async (engine) => {
            expect(await serialized(engine)).toBe(expected);
            expect((await engine.measure()).bytes).toBe(
              Buffer.byteLength(expected),
            );
          },
        );
      });
    });
  }

  it('preserves the original raw ONE ONE TWO expectation as a separate domain', async () => {
    const scenario = anthropicScenarios().find((candidate) =>
      candidate.name.includes('ONE, ONE, TWO'),
    );
    if (scenario === undefined)
      throw new Error('Missing duplicate control scenario');
    const raw = await emittedCandidate(
      scenario.send.rows,
      { reasoningEnabled: false, currentModel: 'claude-opus-5' },
      {},
    );
    expect(raw.match(/ONE|TWO/g)).toStrictEqual(['ONE', 'ONE', 'TWO']);
    const normalized = await normalizedRows(scenario.send.rows);
    expect(
      oracleJson(normalized, {
        reasoningEnabled: false,
        currentModel: 'claude-opus-5',
      }),
    ).not.toBe(raw);
  });

  it('keeps whitespace out of a multi-unit last-kept chain without losing either thinking block', async () => {
    const rows: readonly IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'q' }] },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            sourceField: 'thinking',
            thought: 'first',
            signature: 's1',
          },
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: '  \n' },
          {
            type: 'thinking',
            sourceField: 'thinking',
            thought: 'second',
            signature: 's2',
          },
        ],
      },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'answer' }] },
    ];
    const wire: WireSettings = {
      reasoningEnabled: true,
      strip: 'allButLast',
      currentModel: 'claude-sonnet-4',
    };
    const expected = await emittedCandidate(
      await normalizedRows(rows),
      wire,
      {},
    );
    await withQuery(rows, async (query) =>
      withAnthropicStreamRepair(
        query,
        settingsOf(wire),
        wire,
        async (engine) => {
          expect(await serialized(engine)).toBe(expected);
          expect((await engine.measure()).bytes).toBe(
            Buffer.byteLength(expected),
          );
        },
      ),
    );
  });

  it('preserves callback error identity and releases its extra pin', async () => {
    const rows: readonly IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'q' }] },
    ];
    await withQuery(rows, async (query) => {
      const failure = new Error('repair callback failure');
      await expect(
        withAnthropicStreamRepair(
          query,
          settingsOf({ reasoningEnabled: false }),
          {},
          () => {
            throw failure;
          },
        ),
      ).rejects.toBe(failure);
      await withAnthropicStreamRepair(
        query,
        settingsOf({ reasoningEnabled: false }),
        {},
        async (engine) => {
          expect(await serialized(engine)).toBe(
            '[{"role":"user","content":"q"}]',
          );
        },
      );
    });
  });
});
