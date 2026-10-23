/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import {
  type NativeFactIndexRegistration,
  type NativeFactIndexWriter,
} from '@vybestack/llxprt-code-core/journal/nativeFactIndex.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import {
  AnthropicRepairSource,
  type RepairMessage,
} from './anthropic-repair-source.js';
import {
  AnthropicRepairIndex,
  anthropicRepairScope,
  sameFactVersion,
  writeRepairMessage,
} from './anthropic-repair-index.js';
import { projectAnthropicUnit } from './anthropic-unit-facts.js';
import { appendAnthropicFacts } from './anthropic-append-facts.js';
import { anthropicMediaLedgerWriter } from './anthropic-media-ledger.js';
import { writeAnthropicRecoveryFacts } from './anthropic-recovery-facts.js';

interface Consumed {
  readonly ordinal: number;
  readonly inserted: boolean;
}
async function consumed(
  writer: NativeFactIndexWriter,
  id: string,
  version: readonly number[],
): Promise<Consumed> {
  const values = await writer.get(['state', id]);
  return sameFactVersion(values, version)
    ? { ordinal: values[2], inserted: values[3] !== 0 }
    : { ordinal: 0, inserted: false };
}
async function survives(
  source: AnthropicRepairSource,
  index: AnthropicRepairIndex,
  message: RepairMessage,
): Promise<boolean> {
  if (message.slot !== 'results') return true;
  for (let at = message.start; at <= message.end; at++) {
    const local = new Map<string, number>();
    for (const fact of await source.query.anthropicToolFactsAt(at)) {
      if (fact.kind !== 'result' || fact.orphan) continue;
      const within = (local.get(fact.id) ?? 0) + 1;
      local.set(fact.id, within);
      if (
        !(await index.taken(
          fact.id,
          fact.resultsBefore + within,
          message.start - 1,
        ))
      )
        return true;
    }
  }
  return false;
}
async function nextMessage(
  source: AnthropicRepairSource,
  index: AnthropicRepairIndex,
  ordinal: number,
): Promise<RepairMessage | undefined> {
  for (let next = ordinal + 1; next <= index.count; next++) {
    const message = await index.message(next);
    if (await survives(source, index, message)) return message;
  }
  return undefined;
}
async function decide(
  source: AnthropicRepairSource,
  writer: NativeFactIndexWriter,
  index: AnthropicRepairIndex,
  message: RepairMessage,
  next: RepairMessage | undefined,
  id: string,
): Promise<void> {
  if (
    sameFactVersion(
      await writer.get(['decision', message.start, id]),
      index.version,
    )
  )
    return;
  const state = await consumed(writer, id, index.version);
  let taken: number | undefined;
  let missing = false;
  await source.query.withNormalized(2, 1, id, async (results) => {
    if (next?.role === 'user') {
      const before = await results.countBefore(next.start);
      const end = await results.countBefore(next.end + 1);
      if (Math.max(before + 1, state.ordinal + 1) > end) {
        const later = Math.max(end + 1, state.ordinal + 1);
        taken = later <= results.count ? later : undefined;
        missing = taken === undefined;
      }
    } else missing = results.count === 0 && !state.inserted;
  });
  await writer.set(
    ['decision', message.start, id],
    [
      ...index.version,
      next?.role === 'user' ? next.start + 1 : 0,
      taken ?? 0,
      Number(missing),
    ],
  );
  await writer.set(
    ['state', id],
    [
      ...index.version,
      taken ?? state.ordinal,
      Number(state.inserted || missing),
    ],
  );
  if (taken !== undefined)
    await writer.set(
      ['taken', id, taken],
      [...index.version, message.start + 1],
    );
}
export function anthropicRepairFactIndex(
  input: RowFormatSettings,
): NativeFactIndexRegistration {
  const settings = structuredClone(input);
  projectAnthropicUnit({ speaker: 'human', blocks: [] }, settings);
  return {
    scope: anthropicRepairScope(settings),
    append: (snapshot, writer, previous, edits) =>
      appendAnthropicFacts(snapshot, writer, previous, edits, settings),
    async write(snapshot, writer, generation) {
      const query = await IndexedJournalRequestSnapshot.create(snapshot);
      try {
        const ledger = anthropicMediaLedgerWriter(writer, settings);
        const source = new AnthropicRepairSource(
          query,
          settings,
          undefined,
          ledger.observe,
        );
        let messages = 0;
        let last = -1;
        for await (const message of source.messages()) {
          await writeRepairMessage(writer, ++messages, message, generation);
          if (
            message.role === 'assistant' &&
            (await source.describe(message.start))?.thinking === true
          )
            last = message.start;
        }
        await ledger.finish();
        await writer.set(['messages'], [messages, last + 1]);
        const index = await AnthropicRepairIndex.prepared(writer, generation);
        let tailChain = false;
        let tailCalls = false;
        if (messages > 0) {
          const tail = await index.message(messages);
          tailChain =
            tail.slot === 'chain' ||
            (await source.describe(tail.start))?.chain === true;
          for await (const _call of source.calls(tail)) tailCalls = true;
        }
        await writer.set(['tail'], [Number(tailChain), Number(tailCalls)]);
        for (let ordinal = 1; ordinal <= messages; ordinal++) {
          const message = await index.message(ordinal);
          if (message.role !== 'assistant') continue;
          const next = await nextMessage(source, index, ordinal);
          for await (const call of source.calls(message))
            await decide(source, writer, index, message, next, call.id);
        }
        await writeAnthropicRecoveryFacts(
          query,
          writer,
          settings,
          index,
          ledger.hasMedia(),
        );
      } finally {
        await query.close();
      }
    },
  };
}
