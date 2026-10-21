/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';
import { emittedCandidate } from './message-table/__tests__/support/wireBuilderHarness.js';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
import {
  anthropicLengthRegistration,
  planStoredAnthropicRequest,
} from './journal-anthropic-length.js';

export const storedSettings: RowFormatSettings = {
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
const text = (value: string): IContent => ({
  speaker: 'human',
  blocks: [{ type: 'text', text: value }],
});
const thinking = (value: string): IContent => ({
  speaker: 'ai',
  blocks: [
    {
      type: 'thinking',
      thought: value,
      sourceField: 'thinking',
      signature: 'sig',
    },
  ],
});
const rows: readonly IContent[] = [
  text('雪 \\"\n'),
  thinking('first'),
  { speaker: 'ai', blocks: [{ type: 'text', text: '  ' }] },
  text('next'),
  thinking('last'),
  {
    speaker: 'ai',
    blocks: [{ type: 'tool_call', id: 'x', name: 'read', parameters: {} }],
  },
  text('missing result'),
];

export async function fillStored(
  session: JournalSession,
  input: readonly IContent[],
  settings: RowFormatSettings = storedSettings,
): Promise<void> {
  await session.store.commit([
    {
      kind: 'replace',
      rows: input.map((row) => encodeContentRow(row, { owner: 0 })),
    },
    { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
  ]);
  await session.registerRowFormat(anthropicLengthRegistration(settings));
}

describe('native stored Anthropic length planning', () => {
  const directory = useTempDir('stored-anthropic-');
  it('persists actual native transfers and last-kept lengths for every thinking policy', async () => {
    const session = await JournalSession.create(`${directory()}/length.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await fillStored(session, rows);
      const pin = await session.store.snapshot();
      try {
        for (const strip of ['none', 'all', 'allButLast'] as const) {
          const expected = await emittedCandidate(
            await normalizedRows(rows),
            {
              reasoningEnabled: true,
              strip,
              currentModel: storedSettings.model,
            },
            {},
          );
          const request = {
            model: storedSettings.model,
            max_tokens: 123,
            stream: true,
            system: 'system 雪',
            tools: [{ name: 'read', input_schema: { type: 'object' } }],
          };
          const actual = await planStoredAnthropicRequest(
            pin,
            storedSettings,
            { strip },
            request,
          );
          expect(actual.messagesBytes).toBe(Buffer.byteLength(expected));
          expect(actual.contentLength).toBe(
            Buffer.byteLength(
              JSON.stringify({ ...request, messages: JSON.parse(expected) }),
            ),
          );
          expect(actual.messages).toBe(JSON.parse(expected).length);
        }
      } finally {
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });
  [40, 4000].forEach((count) => {
    it(`plans ${count} rows without reading ROW or LENS payload`, async () => {
      const counter = { reads: 0 };
      const session = await JournalSession.create(
        `${directory()}/read-${count}.llxj`,
        {
          journal: testJournalSeams({ readCounter: counter }, 1, false)
            .dependencies,
        },
      );
      try {
        await fillStored(
          session,
          Array.from({ length: count }, (_, at) =>
            at % 2 !== 0 ? thinking(`thought ${at}`) : text(`q ${at}`),
          ),
        );
        const pin = await session.store.snapshot();
        try {
          const before = counter.reads;
          for (const strip of ['none', 'all', 'allButLast'] as const) {
            const plan = await planStoredAnthropicRequest(
              pin,
              storedSettings,
              { strip },
              { model: storedSettings.model, max_tokens: 1 },
            );
            expect(plan.messagesBytes).toBeGreaterThan(0);
          }
          expect(counter.reads - before).toBeLessThan(40);
          process.stdout.write(
            `Stored Anthropic warm ${JSON.stringify({ count, reads: counter.reads - before, pid: process.pid })}\n`,
          );
        } finally {
          await pin.close();
        }
      } finally {
        await session.close();
      }
    });
  });
  it('refuses absent, mismatched and unsupported measurement settings', async () => {
    const session = await JournalSession.create(`${directory()}/missing.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.append([text('not measured')]);
      const pin = await session.store.snapshot();
      try {
        await expect(
          planStoredAnthropicRequest(
            pin,
            storedSettings,
            {},
            { model: storedSettings.model, max_tokens: 1 },
          ),
        ).rejects.toThrow(/not registered/);
      } finally {
        await pin.close();
      }
      expect(() =>
        anthropicLengthRegistration({
          ...storedSettings,
          anthropic: { cache: '5m', imageBudget: null },
        }),
      ).toThrow(/cache-off/);
      await fillStored(session, rows);
      const measured = await session.store.snapshot();
      try {
        await expect(
          planStoredAnthropicRequest(
            measured,
            { ...storedSettings, model: 'different' },
            {},
            { model: 'different', max_tokens: 1 },
          ),
        ).rejects.toThrow(/not registered/);
        await expect(
          planStoredAnthropicRequest(
            measured,
            storedSettings,
            {},
            { model: storedSettings.model, max_tokens: 1 },
            { pendingInputCount: 1 },
          ),
        ).rejects.toThrow(/tail/);
        await expect(
          planStoredAnthropicRequest(
            measured,
            storedSettings,
            {},
            { model: storedSettings.model, max_tokens: 1 },
            { from: 1 },
          ),
        ).rejects.toThrow(/range/);
      } finally {
        await measured.close();
      }
    } finally {
      await session.close();
    }
  });
});
