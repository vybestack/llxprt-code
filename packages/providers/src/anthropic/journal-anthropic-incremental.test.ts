/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { emittedCandidate } from './message-table/__tests__/support/wireBuilderHarness.js';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
import { AnthropicStreamRepair } from './anthropic-stream-repair.js';
import {
  anthropicLengthRegistration,
  planStoredAnthropicRequest,
} from './journal-anthropic-length.js';

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
const text = (
  value: string,
  speaker: IContent['speaker'] = 'human',
): IContent => ({
  speaker,
  blocks: [{ type: 'text', text: value }],
  metadata: { id: `unique-${value}` },
});
const think = (value: string): IContent => ({
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
async function register(session: JournalSession): Promise<void> {
  await session.store.commit([
    { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
  ]);
  await session.registerRowFormat(anthropicLengthRegistration(settings));
}
async function capturePayloadRanges(
  session: JournalSession,
  pin: VersionSnapshot,
  ranges: Array<{ start: number; end: number }>,
): Promise<void> {
  const read = await session.store.openRead();
  try {
    for await (const entry of pin.entries()) {
      ranges.push({
        start: entry.recordOffset,
        end: entry.recordOffset + entry.recordLength,
      });
      for (const offset of entry.lensRef.filter((value) => value !== 0)) {
        const head = await read.access.readRecordHead(offset);
        ranges.push({ start: offset, end: head.endOffset });
      }
    }
  } finally {
    await read.close();
  }
}
async function checkWarmPolicies(
  pin: VersionSnapshot,
  previousBytes: number,
): Promise<void> {
  for (const strip of ['none', 'all', 'allButLast'] as const) {
    const plan = await planStoredAnthropicRequest(
      pin,
      settings,
      { strip },
      { model: settings.model },
    );
    expect(plan.messagesBytes).toBeGreaterThan(previousBytes);
  }
}
async function warmEvidence(
  session: JournalSession,
  ranges: Array<{ start: number; end: number }>,
  counter: { reads: number },
  audit: { enabled: boolean; payload: number },
  previousBytes: number,
): Promise<{ warmReads: number; payloadReads: number }> {
  const pin = await session.store.snapshot();
  try {
    await capturePayloadRanges(session, pin, ranges);
    const start = counter.reads;
    audit.enabled = true;
    await checkWarmPolicies(pin, previousBytes);
    audit.enabled = false;
    expect(audit.payload).toBe(0);
    expect(counter.reads - start).toBeLessThan(40);
    return { warmReads: counter.reads - start, payloadReads: audit.payload };
  } finally {
    await pin.close();
  }
}
async function matches(
  session: JournalSession,
  rows: readonly IContent[],
): Promise<void> {
  const pin = await session.store.snapshot();
  const query = await IndexedJournalRequestSnapshot.create(pin);
  try {
    for (const strip of ['none', 'all', 'allButLast'] as const) {
      const expected = await emittedCandidate(
        await normalizedRows(
          buildCuratedHistory(new DebugLogger('incremental-old'), rows, false),
        ),
        {
          reasoningEnabled: true,
          strip,
          currentModel: settings.model,
        },
        {},
      );
      const plan = await planStoredAnthropicRequest(
        pin,
        settings,
        { strip },
        { model: settings.model, max_tokens: 7 },
      );
      expect(plan.messagesBytes).toBe(Buffer.byteLength(expected));
      expect(plan.contentLength).toBe(
        Buffer.byteLength(
          JSON.stringify({
            model: settings.model,
            max_tokens: 7,
            messages: JSON.parse(expected),
          }),
        ),
      );
      let actual = '';
      const engine = await AnthropicStreamRepair.create(query, settings, {
        strip,
      });
      for await (const chunk of engine.serialize()) actual += chunk;
      expect(actual).toBe(expected);
    }
  } finally {
    await query.close();
    await pin.close();
  }
}

describe('incremental native Anthropic stored summaries', () => {
  const directory = useTempDir('anthropic-incremental-');
  for (const count of [40, 4000]) {
    it(`appends to ${count} unique-ID text rows within a depth-sized read budget`, async () => {
      const counter = { reads: 0 };
      const ranges: Array<{ start: number; end: number }> = [];
      const audit = { enabled: false, payload: 0 };
      const dependencies = testJournalSeams(
        { readCounter: counter },
        1,
        false,
      ).dependencies;
      const session = await JournalSession.create(
        `${directory()}/scale-${count}.llxj`,
        {
          journal: {
            ...dependencies,
            open: async (path, flags) => {
              const file = await dependencies.open(path, flags);
              return {
                ...file,
                read: async (buffer, offset, length, position) => {
                  if (
                    audit.enabled &&
                    ranges.some(
                      (range) =>
                        position < range.end && position + length > range.start,
                    )
                  )
                    audit.payload++;
                  return file.read(buffer, offset, length, position);
                },
              };
            },
          },
        },
      );
      const rows = Array.from({ length: count }, (_, at) =>
        text(`row-${at}`, at % 2 === 0 ? 'human' : 'ai'),
      );
      try {
        await session.append(rows);
        await register(session);
        const old = await session.store.snapshot();
        try {
          const oldPlan = await planStoredAnthropicRequest(
            old,
            settings,
            {},
            { model: settings.model },
          );
          const added = text('append 雪 \\"\n', 'ai');
          await capturePayloadRanges(session, old, ranges);
          const before = counter.reads;
          audit.enabled = true;
          await session.append([added]);
          audit.enabled = false;
          const appendReads = counter.reads - before;
          const appendHistoricalPayloadReads = audit.payload;
          expect(appendReads).toBeLessThan(250);
          expect(appendHistoricalPayloadReads).toBe(0);
          const warm = await warmEvidence(
            session,
            ranges,
            counter,
            audit,
            oldPlan.messagesBytes,
          );
          process.stdout.write(
            `Incremental Anthropic ${JSON.stringify({ count, appendReads, appendHistoricalPayloadReads, ...warm, pid: process.pid })}\n`,
          );
          await matches(session, [...rows, added]);
          expect(
            await planStoredAnthropicRequest(
              old,
              settings,
              {},
              { model: settings.model },
            ),
          ).toStrictEqual(oldPlan);
        } finally {
          await old.close();
        }
      } finally {
        await session.close();
      }
    });
  }
  for (const scenario of [
    {
      name: 'ordinary unique call and actual response',
      before: [think('old'), text('q')],
      added: [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_round',
              name: 'read',
              parameters: { path: '雪' },
            },
          ],
        } satisfies IContent,
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_round',
              toolName: 'read',
              result: 'actual result 雪',
              isComplete: true,
            },
          ],
        } satisfies IContent,
        text('answer', 'ai'),
      ],
    },
    {
      name: 'assistant merge and whitespace',
      before: [text('q'), text('old', 'ai')],
      added: [text('  \n', 'ai'), text('new', 'ai')],
    },
    {
      name: 'last thinking changes after a speaker boundary',
      before: [think('old'), text('q')],
      added: [think('new'), text('answer', 'ai')],
    },
    {
      name: 'continuing thinking chain',
      before: [text('q'), think('old')],
      added: [text('  ', 'ai'), text('answer', 'ai'), text('next')],
    },
  ]) {
    it(`preserves old-emitter bytes for ${scenario.name}`, async () => {
      const session = await JournalSession.create(
        `${directory()}/${scenario.name}.llxj`,
        { journal: testJournalSeams().dependencies },
      );
      try {
        await session.append(scenario.before);
        await register(session);
        let rows: readonly IContent[] = scenario.before;
        for (const row of scenario.added) {
          await session.append([row]);
          rows = [...rows, row];
          await matches(session, rows);
          expect(session.store.published?.rows).toBe(rows.length);
        }
      } finally {
        await session.close();
      }
    });
  }
});
