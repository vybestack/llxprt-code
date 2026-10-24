/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { recordedMessages as emittedCandidate } from './message-table/__tests__/support/recorded-wire-oracle.js';
import { describe, expect, it } from 'bun:test';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
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
    wire: WireSettings,
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
        {
          kind: 'factIndex',
          registration: anthropicRepairFactIndex(settingsOf(wire)),
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
      await withQuery(scenario.send.rows, wire, async (query) => {
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
    await withQuery(rows, wire, async (query) =>
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

  it('refuses unsupported caching even when there are no units to convert', async () => {
    await withQuery([], { reasoningEnabled: false }, async (query) => {
      const settings: RowFormatSettings = {
        ...settingsOf({ reasoningEnabled: false }),
        anthropic: { cache: '1h', imageBudget: null },
      };
      await expect(
        withAnthropicStreamRepair(query, settings, {}, async (engine) =>
          serialized(engine),
        ),
      ).rejects.toThrow(/cache-off/);
    });
  });

  it('captures the thinking policy before asynchronous native reads', async () => {
    const rows: readonly IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            sourceField: 'thinking',
            thought: 'kept',
            signature: 'signature',
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
    await withQuery(rows, wire, async (query) => {
      const policy: { strip: 'all' | 'allButLast' } = { strip: 'allButLast' };
      const output = withAnthropicStreamRepair(
        query,
        settingsOf(wire),
        policy,
        async (engine) => serialized(engine),
      );
      policy.strip = 'all';
      expect(await output).toBe(expected);
    });
  });

  it('uses ONE ONE TWO for converted-ID collisions and later messages see consumed source positions', async () => {
    const call = (id: string): IContent => ({
      speaker: 'ai',
      blocks: [{ type: 'tool_call', id, name: 'read', parameters: {} }],
    });
    const result = (id: string, value: string): IContent => ({
      speaker: 'tool',
      blocks: [
        { type: 'tool_response', callId: id, toolName: 'read', result: value },
      ],
    });
    const text = (value: string): IContent => ({
      speaker: 'human',
      blocks: [{ type: 'text', text: value }],
    });
    const rows: readonly IContent[] = [
      text('q'),
      { speaker: 'ai', blocks: [...call('').blocks, ...call('').blocks] },
      text('next'),
      call('hist_tool_empty'),
      result('hist_tool_empty', 'ONE'),
      text('more'),
      call('toolu_empty'),
      result('toolu_empty', 'TWO'),
    ];
    const wire: WireSettings = {
      reasoningEnabled: false,
      currentModel: 'claude-opus-5',
    };
    const expected = await emittedCandidate(
      await normalizedRows(rows),
      wire,
      {},
    );
    expect(expected.match(/ONE|TWO/g)).toStrictEqual(['ONE', 'ONE', 'TWO']);
    await withQuery(rows, wire, async (query) =>
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
    const wire: WireSettings = { reasoningEnabled: false };
    await withQuery(rows, wire, async (query) => {
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
