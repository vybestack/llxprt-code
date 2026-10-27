/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { NativeFactIndexWriter } from '@vybestack/llxprt-code-core/journal/nativeFactIndex.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import type { Version } from '@vybestack/llxprt-code-core/journal/version.js';
import type { VersionEdit } from '@vybestack/llxprt-code-core/journal/groupEdits.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import {
  ROW_BLOCK_TYPE,
  ROW_SPEAKER,
} from '@vybestack/llxprt-code-core/journal/rowRecord.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { AnthropicRepairSource } from './anthropic-repair-source.js';
import { appendUniqueAnthropicTool } from './anthropic-tool-append-facts.js';
import {
  AnthropicRepairIndex,
  writeRepairMessage,
} from './anthropic-repair-index.js';

function appendOnly(edits: readonly VersionEdit[]): boolean {
  return edits.every(
    (edit) =>
      edit.kind === 'setState' ||
      (edit.kind === 'append' &&
        edit.rows.every(
          (row) =>
            row.speaker !== ROW_SPEAKER.tool &&
            row.ids.length === 0 &&
            row.blocks.every(
              (block) =>
                block.type === ROW_BLOCK_TYPE.text ||
                block.type === ROW_BLOCK_TYPE.code ||
                block.type === ROW_BLOCK_TYPE.thinking,
            ),
        )),
  );
}
interface Boundary {
  readonly chain: boolean;
  readonly messages: number;
  readonly last: number;
}
async function appendUnit(
  source: AnthropicRepairSource,
  writer: NativeFactIndexWriter,
  version: readonly number[],
  boundary: Boundary,
  at: number,
): Promise<Boundary | undefined> {
  const unit = await source.describe(at);
  if (unit === undefined) return boundary;
  const { messages, last } = boundary;
  if (boundary.chain && unit.speaker === 'ai') {
    if (unit.thinking) return undefined;
    const index = await AnthropicRepairIndex.prepared(writer, version);
    const old = await index.message(messages);
    await writeRepairMessage(
      writer,
      messages,
      { ...old, end: at, slot: 'chain' },
      version,
    );
    return boundary;
  }
  if (!unit.content) return { ...boundary, chain: unit.chain };
  await writeRepairMessage(
    writer,
    messages + 1,
    {
      start: at,
      end: at,
      slot: 'content',
      role: unit.speaker === 'ai' ? 'assistant' : 'user',
    },
    version,
  );
  if (unit.speaker === 'ai' && unit.thinking) {
    const count = await writer.get(['thinking-count']);
    if (count === undefined)
      throw new Error('Missing Anthropic thinking index');
    await writer.set(['thinking', count[0]], [at]);
    await writer.set(['thinking-count'], [count[0] + 1]);
  }
  return {
    chain: unit.chain,
    messages: messages + 1,
    last: unit.speaker === 'ai' && unit.thinking ? at : last,
  };
}
export async function appendAnthropicFacts(
  snapshot: VersionSnapshot,
  writer: NativeFactIndexWriter,
  previous: Version,
  edits: readonly VersionEdit[],
  settings: RowFormatSettings,
): Promise<boolean> {
  const ordinary = appendOnly(edits);
  if (ordinary)
    for (let row = previous.rows; row < snapshot.rows; row++) {
      const { header } = await snapshot.readIds(await snapshot.entryAt(row));
      if (
        header.speaker === ROW_SPEAKER.tool ||
        header.ids.length > 0 ||
        header.blocks.some(
          (block) =>
            block.type !== ROW_BLOCK_TYPE.text &&
            block.type !== ROW_BLOCK_TYPE.code &&
            block.type !== ROW_BLOCK_TYPE.thinking,
        )
      )
        return false;
    }
  const edit = edits[0];
  const toolRow =
    edits.length === 1 && edit.kind === 'append' && edit.rows.length === 1
      ? edit.rows[0]
      : undefined;
  if (!ordinary && toolRow === undefined) return false;
  const version = await writer.get(['version']);
  if (
    version === undefined ||
    version.length !== 2 ||
    (await writer.get(['invalid']))?.[0] === 1
  )
    return false;
  const query = await IndexedJournalRequestSnapshot.create(snapshot);
  try {
    const source = new AnthropicRepairSource(query, settings);
    if (!ordinary && toolRow !== undefined)
      return await appendUniqueAnthropicTool(
        snapshot,
        writer,
        previous,
        toolRow,
        source,
      );
    await writer.set(['append-rewind'], [0]);
    const index = await AnthropicRepairIndex.read(writer);
    const tail = await writer.get(['tail']);
    if (tail === undefined || tail.length !== 2 || tail[1] !== 0) return false;
    let boundary: Boundary = {
      chain: tail[0] !== 0,
      messages: index.count,
      last: index.lastThinking,
    };
    await writer.set(
      ['append-base'],
      [Number(boundary.chain), index.lastThinking + 1],
    );
    for (let at = previous.aggregate.units; at < query.count; at++) {
      const next = await appendUnit(
        source,
        writer,
        index.version,
        boundary,
        at,
      );
      if (next === undefined) return false;
      boundary = next;
      await writer.set(['messages'], [boundary.messages, boundary.last + 1]);
    }
    await writer.set(['tail'], [Number(boundary.chain), 0]);
    return true;
  } finally {
    await query.close();
  }
}
