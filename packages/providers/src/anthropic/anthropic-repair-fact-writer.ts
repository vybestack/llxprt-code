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
import { decideAnthropicTool } from './anthropic-tool-decision.js';
import { AnthropicStreamRepair } from './anthropic-stream-repair.js';
import { writeAnthropicCacheWindows } from './anthropic-cache-windows.js';
import { flushMessagePages } from './anthropic-message-pages.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import type { Version } from '@vybestack/llxprt-code-core/journal/version.js';
import type { VersionEdit } from '@vybestack/llxprt-code-core/journal/groupEdits.js';

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
    for await (const id of source.resultIds(at)) {
      if ((await source.query.normalizedCount(2, 0, id)) === 0) continue;
      const within = (local.get(id) ?? 0) + 1;
      local.set(id, within);
      const before = await source.query.normalizedCount(2, 1, id, {
        from: 0,
        to: at,
      });
      if (!(await index.taken(id, before + within, message.start - 1)))
        return true;
    }
  }
  return false;
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
  const { taken, missing } = await source.query.withNormalized(
    2,
    1,
    id,
    (results) => decideAnthropicTool(results, state, next),
  );
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
async function writeAtomFacts(
  index: AnthropicRepairIndex,
  engine: AnthropicStreamRepair,
  writer: NativeFactIndexWriter,
  from = 0,
): Promise<void> {
  for await (const { ordinal, message } of index.messageEntries(from)) {
    const kept =
      message.slot !== 'results' || (await engine.tools.hasKept(message));
    let inserts = false;
    if (message.role === 'assistant')
      for await (const _decision of engine.tools.scripts(message)) {
        inserts = true;
        break;
      }
    await writeRepairMessage(
      writer,
      ordinal,
      { ...message, kept, inserts },
      index.version,
    );
  }
}
async function appendIndexedFacts(
  snapshot: VersionSnapshot,
  writer: NativeFactIndexWriter,
  previous: Version,
  edits: readonly VersionEdit[],
  settings: RowFormatSettings,
): Promise<boolean> {
  if (
    !(await appendAnthropicFacts(snapshot, writer, previous, edits, settings))
  )
    return false;
  const query = await IndexedJournalRequestSnapshot.create(snapshot);
  try {
    const index = await AnthropicRepairIndex.read(writer);
    const engine = await AnthropicStreamRepair.create(
      query,
      settings,
      {},
      index,
    );
    await writeAtomFacts(index, engine, writer, previous.aggregate.units);
    const rewind = (await writer.get(['append-rewind']))?.[0] ?? 0;
    await writeAnthropicRecoveryFacts(
      query,
      writer,
      settings,
      index,
      false,
      rewind === 0 ? previous.aggregate.units : rewind - 1,
    );
    await writeAnthropicCacheWindows(engine, writer, previous.aggregate.units);
    await flushMessagePages(writer);
    return true;
  } finally {
    await query.close();
  }
}
async function writeTopology(
  source: AnthropicRepairSource,
  writer: NativeFactIndexWriter,
  generation: readonly number[],
): Promise<AnthropicRepairIndex> {
  let messages = 0;
  let last = -1;
  let thinking = 0;
  await writer.set(['messages'], [0, 0]);
  const decisions = await AnthropicRepairIndex.prepared(writer, generation);
  const topology = source.messages();
  let tail: RepairMessage | undefined;
  const nextRecorded = async (): Promise<RepairMessage | undefined> => {
    const next = await topology.next();
    if (next.done === true) return undefined;
    const message = next.value;
    tail = message;
    await writeRepairMessage(writer, ++messages, message, generation);
    if (
      message.role === 'assistant' &&
      (await source.describe(message.start))?.thinking === true
    ) {
      last = message.start;
      await writer.set(['thinking', thinking++], [last]);
    }
    return message;
  };
  try {
    let message = await nextRecorded();
    while (message !== undefined) {
      let next = await nextRecorded();
      if (message.role !== 'assistant') {
        message = next;
        continue;
      }
      while (next !== undefined && !(await survives(source, decisions, next)))
        next = await nextRecorded();
      for await (const call of source.calls(message))
        await decide(source, writer, decisions, message, next, call.id);
      message = next;
    }
  } finally {
    await topology.return(undefined);
  }
  await writer.set(['thinking-count'], [thinking]);
  await writer.set(['messages'], [messages, last + 1]);
  let tailChain = false;
  let tailCalls = false;
  if (tail !== undefined) {
    tailChain =
      tail.slot === 'chain' ||
      (await source.describe(tail.start))?.chain === true;
    for await (const _call of source.calls(tail)) tailCalls = true;
  }
  await writer.set(['tail'], [Number(tailChain), Number(tailCalls)]);
  return AnthropicRepairIndex.prepared(writer, generation);
}

export function anthropicRepairFactIndex(
  input: RowFormatSettings,
): NativeFactIndexRegistration {
  const settings = structuredClone(input);
  projectAnthropicUnit({ speaker: 'human', blocks: [] }, settings);
  return {
    scope: anthropicRepairScope(settings),
    append: (snapshot, writer, previous, edits) =>
      appendIndexedFacts(snapshot, writer, previous, edits, settings),
    async write(snapshot, writer, generation) {
      const query = await IndexedJournalRequestSnapshot.create(snapshot);
      try {
        const ledger = anthropicMediaLedgerWriter(writer, settings);
        const source = new AnthropicRepairSource(query, settings);
        const index = await writeTopology(source, writer, generation);
        await writeAnthropicRecoveryFacts(
          query,
          writer,
          settings,
          index,
          source.work.media,
          undefined,
          ledger.observe,
          (message, ordinal) =>
            writeRepairMessage(writer, ordinal, message, generation),
        );
        await ledger.finish();
        await flushMessagePages(writer);
      } finally {
        await query.close();
      }
    },
  };
}
