/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { NativeFactIndexWriter } from '@vybestack/llxprt-code-core/journal/nativeFactIndex.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import type { Version } from '@vybestack/llxprt-code-core/journal/version.js';
import type { RowDraft } from '@vybestack/llxprt-code-core/journal/rowDraft.js';
import type { IdFact } from '@vybestack/llxprt-code-core/journal/idFactCodec.js';
import {
  ROW_BLOCK_TYPE,
  ROW_SPEAKER,
} from '@vybestack/llxprt-code-core/journal/rowRecord.js';
import { unitCount } from '@vybestack/llxprt-code-core/journal/unitContributions.js';
import type { AnthropicRepairSource } from './anthropic-repair-source.js';
import {
  AnthropicRepairIndex,
  writeRepairMessage,
} from './anthropic-repair-index.js';

function shape(row: RowDraft): 'call' | 'result' | undefined {
  if (
    row.ids.length !== 1 ||
    row.ids[0].rawId === '' ||
    row.ids[0].nameLen === 0
  )
    return undefined;
  if (
    row.speaker === ROW_SPEAKER.ai &&
    row.blocks.every((block) =>
      [ROW_BLOCK_TYPE.tool_call, ROW_BLOCK_TYPE.text, ROW_BLOCK_TYPE.code].some(
        (type) => type === block.type,
      ),
    )
  )
    return 'call';
  if (
    row.speaker !== ROW_SPEAKER.ai &&
    row.blocks.length === 1 &&
    row.blocks[0].type === ROW_BLOCK_TYPE.tool_response
  )
    return 'result';
  return undefined;
}
async function unique(
  snapshot: VersionSnapshot,
  raw: IdFact,
  id: string,
): Promise<boolean> {
  if (raw.firstAiCall === undefined || raw.callCount !== 1 || raw.unnamed !== 0)
    return false;
  return (
    (await snapshot.facts.normalizedCount(2, 0, id)) === 1 &&
    (await snapshot.facts.normalizedCount(2, 1, id)) === 1
  );
}
async function appendCall(
  source: AnthropicRepairSource,
  writer: NativeFactIndexWriter,
  index: AnthropicRepairIndex,
  at: number,
  id: string,
): Promise<boolean> {
  const unit = await source.describe(at);
  const adjacent = await source.describe(at + 1);
  if (unit?.content !== true || unit.thinking || adjacent?.results !== true)
    return false;
  await writeRepairMessage(
    writer,
    index.count + 1,
    { start: at, end: at, slot: 'content', role: 'assistant' },
    index.version,
  );
  await writeRepairMessage(
    writer,
    index.count + 2,
    { start: at + 1, end: at + 1, slot: 'results', role: 'user' },
    index.version,
  );
  await writer.set(['decision', at, id], [...index.version, at + 2, 0, 0]);
  await writer.set(['messages'], [index.count + 2, index.lastThinking + 1]);
  return true;
}
async function tailHolder(
  snapshot: VersionSnapshot,
  previous: Version,
  source: AnthropicRepairSource,
  index: AnthropicRepairIndex,
  raw: IdFact,
  at: number,
): Promise<boolean> {
  if (previous.rows === 0 || index.count < 2) return false;
  const holder = await snapshot.entryAt(previous.rows - 1);
  if (
    holder.label !== raw.firstAiCall?.label ||
    unitCount(holder) !== 2 ||
    (await snapshot.unitsBelow(holder.label)) !== at
  )
    return false;
  const message = await index.message(index.count - 1);
  const adjacent = await index.message(index.count);
  if (
    [
      message.start !== at,
      message.end !== at,
      message.slot !== 'content',
      message.role !== 'assistant',
      adjacent.start !== at + 1,
      adjacent.end !== at + 1,
      adjacent.slot !== 'results',
    ].includes(true)
  )
    return false;
  const unit = await source.describe(at);
  return unit !== undefined && !unit.thinking && !unit.chain;
}
export async function appendUniqueAnthropicTool(
  snapshot: VersionSnapshot,
  writer: NativeFactIndexWriter,
  previous: Version,
  row: RowDraft,
  source: AnthropicRepairSource,
): Promise<boolean> {
  const kind = shape(row);
  if (kind === undefined) return false;
  const index = await AnthropicRepairIndex.read(writer);
  const tail = await writer.get(['tail']);
  if (tail === undefined || tail[0] !== 0 || tail[1] !== 0) return false;
  const raw = await snapshot.facts.fact(row.ids[0].rawId);
  const id = snapshot.normalizedId(2, row.ids[0].rawId);
  if (raw === undefined || !(await unique(snapshot, raw, id))) return false;
  const newest = await snapshot.entryAt(snapshot.rows - 1);
  const at =
    kind === 'call' ? previous.aggregate.units : previous.aggregate.units - 2;
  if (kind === 'call') {
    if (
      raw.firstAiCall?.label !== newest.label ||
      raw.firstResponse !== undefined ||
      source.query.count !== at + 2
    )
      return false;
    if (!(await appendCall(source, writer, index, at, id))) return false;
  } else {
    if (
      source.query.count !== previous.aggregate.units ||
      raw.firstResponse?.label !== newest.label ||
      raw.best?.label !== newest.label
    )
      return false;
    if (!(await tailHolder(snapshot, previous, source, index, raw, at)))
      return false;
  }
  await writer.set(['append-base'], [0, index.lastThinking + 1]);
  await writer.set(['append-rewind'], [kind === 'result' ? at + 1 : 0]);
  await writer.set(['tail'], [0, 0]);
  return true;
}
