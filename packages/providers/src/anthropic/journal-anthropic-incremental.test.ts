/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { recordedMessages as emittedCandidate } from './message-table/__tests__/support/recorded-wire-oracle.js';
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
const toolCall = (id: string, name = 'read'): IContent => ({
  speaker: 'ai',
  blocks: [{ type: 'tool_call', id, name, parameters: { path: '雪' } }],
});
const toolResult = (
  id: string,
  result = 'actual result 雪',
  speaker: IContent['speaker'] = 'tool',
): IContent => ({
  speaker,
  blocks: [
    {
      type: 'tool_response',
      callId: id,
      toolName: 'read',
      result,
      isComplete: true,
    },
  ],
});
interface PhysicalRead {
  readonly start: number;
  readonly end: number;
}
async function classifyReads(
  session: JournalSession,
  pin: VersionSnapshot,
  from: number,
  reads: readonly PhysicalRead[],
): Promise<{
  metadataOrHeads: number;
  rowBodies: number;
  lens: number;
  historicalPayloadReads: number;
  prefetchPayloadOverlaps: number;
}> {
  const rows: Array<PhysicalRead & { body: number; selected: boolean }> = [];
  const lenses: Array<PhysicalRead & { selected: boolean }> = [];
  const read = await session.store.openRead();
  try {
    let index = 0;
    for await (const entry of pin.entries()) {
      const selected = index++ >= from;
      const head = await read.access.readRecordHead(entry.recordOffset);
      rows.push({
        start: head.offset,
        end: head.endOffset,
        body: head.bodyOffset,
        selected,
      });
      for (const ref of entry.lensRef.filter((value) => value !== 0)) {
        const lens = await read.access.readRecordHead(ref);
        lenses.push({ start: ref, end: lens.endOffset, selected });
      }
    }
  } finally {
    await read.close();
  }
  const records = [...rows, ...lenses];
  const startsIn = (event: PhysicalRead, range: PhysicalRead): boolean =>
    event.start >= range.start && event.start < range.end;
  const rowBodies = reads.filter((event) =>
    rows.some(
      (row) => row.selected && startsIn(event, row) && event.end > row.body,
    ),
  ).length;
  const lens = reads.filter((event) =>
    lenses.some((range) => range.selected && startsIn(event, range)),
  ).length;
  const historicalPayloadReads = reads.filter((event) =>
    records.some((range) => !range.selected && startsIn(event, range)),
  ).length;
  const prefetchPayloadOverlaps = reads.filter(
    (event) =>
      !records.some((range) => startsIn(event, range)) &&
      records.some(
        (range) => event.start < range.end && event.end > range.start,
      ),
  ).length;
  return {
    metadataOrHeads: reads.length - rowBodies - lens - historicalPayloadReads,
    rowBodies,
    lens,
    historicalPayloadReads,
    prefetchPayloadOverlaps,
  };
}
async function withSnapshot(
  session: JournalSession,
  consume: (pin: VersionSnapshot) => Promise<void>,
): Promise<void> {
  const pin = await session.store.snapshot();
  try {
    await consume(pin);
  } finally {
    await pin.close();
  }
}
async function capturePayloadRanges(
  session: JournalSession,
  pin: VersionSnapshot,
  ranges: Array<{ start: number; end: number }>,
  omitRow?: bigint,
): Promise<void> {
  const read = await session.store.openRead();
  try {
    for await (const entry of pin.entries()) {
      if (entry.label !== omitRow)
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
  for (const count of [40, 400, 4000]) {
    it(`maintains a real tool round after ${count} fixed-density source rows without whole fills`, async () => {
      const counter = { reads: 0 };
      const ranges: Array<{ start: number; end: number }> = [];
      const audit = { enabled: false, payload: 0, holderReads: 0 };
      const events: PhysicalRead[] = [];
      const holder = { start: 0, end: 0 };
      const fills = { facts: 0, format: 0 };
      const dependencies = testJournalSeams(
        { readCounter: counter },
        1,
        false,
      ).dependencies;
      const session = await JournalSession.create(
        `${directory()}/tool-scale-${count}.llxj`,
        {
          journal: {
            ...dependencies,
            open: async (path, flags) => {
              const file = await dependencies.open(path, flags);
              return {
                ...file,
                read: async (buffer, offset, length, position) => {
                  const result = await file.read(
                    buffer,
                    offset,
                    length,
                    position,
                  );
                  const end = position + result.bytesRead;
                  if (
                    audit.enabled &&
                    ranges.some(
                      (range) => position < range.end && end > range.start,
                    )
                  )
                    audit.payload++;
                  if (
                    audit.enabled &&
                    position < holder.end &&
                    end > holder.start
                  )
                    audit.holderReads++;
                  if (audit.enabled) events.push({ start: position, end });
                  return result;
                },
              };
            },
          },
        },
      );
      const rows = Array.from({ length: count / 4 }, (_, at) => [
        text(`q-${at}`),
        toolCall(`call_history_${at}`),
        toolResult(`call_history_${at}`),
        text(`answer-${at}`, 'ai'),
      ]).flat();
      try {
        const coldStart = counter.reads;
        await session.append(rows);
        const facts = anthropicRepairFactIndex(settings);
        await session.store.commit([
          {
            kind: 'factIndex',
            registration: {
              ...facts,
              write: async (...args) => {
                fills.facts++;
                await facts.write(...args);
              },
            },
          },
        ]);
        const format = anthropicLengthRegistration(settings);
        await session.registerRowFormat({
          ...format,
          prepare: async (snapshot, input) => {
            fills.format++;
            if (format.prepare === undefined)
              throw new Error('Missing format preparation');
            return format.prepare(snapshot, input);
          },
        });
        const coldReads = counter.reads - coldStart;
        const old = await session.store.snapshot();
        try {
          const oldPlan = await planStoredAnthropicRequest(
            old,
            settings,
            {},
            { model: settings.model },
          );
          await capturePayloadRanges(session, old, ranges);
          const call = toolCall('call_new_round');
          const before = counter.reads;
          audit.enabled = true;
          await session.append([call]);
          audit.enabled = false;
          const callReads = counter.reads - before;
          expect(callReads).toBeLessThan(250);
          expect(audit.payload).toBe(0);
          await withSnapshot(session, async (callPin) => {
            expect(events.length).toBe(callReads);
            const callPhysical = await classifyReads(
              session,
              callPin,
              count,
              events,
            );
            expect(callPhysical.rowBodies).toBeGreaterThan(0);
            expect(callPhysical.historicalPayloadReads).toBe(0);
            events.length = 0;
            const callPlan = await planStoredAnthropicRequest(
              callPin,
              settings,
              {},
              { model: settings.model },
            );
            const entry = await callPin.entryAt(count);
            holder.start = entry.recordOffset;
            holder.end = entry.recordOffset + entry.recordLength;
            ranges.length = 0;
            await capturePayloadRanges(session, callPin, ranges, entry.label);
            const response = toolResult('call_new_round');
            const start = counter.reads;
            audit.enabled = true;
            await session.append([response]);
            audit.enabled = false;
            const resultReads = counter.reads - start;
            const resultEvents = [...events];
            expect(resultEvents.length).toBe(resultReads);
            expect(resultReads).toBeLessThan(250);
            expect(audit.holderReads).toBeGreaterThan(0);
            const resultHistoricalRecordOverlaps = audit.payload;
            audit.payload = 0;
            expect(fills).toStrictEqual({ facts: 1, format: 1 });
            const warm = await warmEvidence(
              session,
              ranges,
              counter,
              audit,
              oldPlan.messagesBytes,
            );
            expect(
              await planStoredAnthropicRequest(
                callPin,
                settings,
                {},
                { model: settings.model },
              ),
            ).toStrictEqual(callPlan);
            expect(
              await planStoredAnthropicRequest(
                old,
                settings,
                {},
                { model: settings.model },
              ),
            ).toStrictEqual(oldPlan);
            let resultPhysical = {
              metadataOrHeads: 0,
              rowBodies: 0,
              lens: 0,
              historicalPayloadReads: 0,
              prefetchPayloadOverlaps: 0,
            };
            await withSnapshot(session, async (current) => {
              resultPhysical = await classifyReads(
                session,
                current,
                count,
                resultEvents,
              );
              expect(resultPhysical.metadataOrHeads).toBeLessThan(250);
              expect(resultPhysical.rowBodies).toBeGreaterThan(0);
              expect(resultPhysical.historicalPayloadReads).toBe(0);
              const currentPlan = await planStoredAnthropicRequest(
                current,
                settings,
                {},
                { model: settings.model },
              );
              expect(currentPlan.generation).toBe(oldPlan.generation);
              expect(currentPlan.messagesBytes).not.toBe(
                callPlan.messagesBytes,
              );
            });
            process.stdout
              .write(`Tool append Anthropic ${JSON.stringify({ count, coldReads, callReads, resultReads, callPhysical, resultPhysical, historicalPayloadReads: resultPhysical.historicalPayloadReads, resultHistoricalRecordOverlaps, holderReads: audit.holderReads, wholeFactFills: fills.facts - 1, wholeFormatFills: fills.format - 1, ...warm, pid: process.pid })}
`);
            await matches(session, [...rows, call, response]);
          });
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
      name: 'escaped template input and consecutive unique rounds',
      before: [text('q')],
      added: [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_template',
              name: 'render_雪',
              parameters: { template: '${value}\n"雪"', data: [1, null, true] },
            },
          ],
        } satisfies IContent,
        toolResult('hist_tool_template', '{"rendered":"雪"}'),
        toolCall('toolu_second'),
        toolResult('toolu_second', 'second actual result', 'human'),
        think('next thinking'),
        text('answer', 'ai'),
      ],
    },
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
