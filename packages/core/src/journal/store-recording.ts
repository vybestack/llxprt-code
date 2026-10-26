/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { BuildContext } from './groupBuildShared.js';
import type { RecordAppender } from './groupAppender.js';
import type { JournalGroupWriter, CommitAck } from './groupWriter.js';
import {
  ArrivalGroup,
  type RecordingMutation,
  type ArrivalStore,
} from './arrival-group.js';
import {
  decodeTranscriptHead,
  TRANSCRIPT_HEAD_KEY,
} from './transcript-head.js';
import { transcriptEntries } from './transcript-tree.js';
import type { RecordAccess } from './recordAccess.js';

import type { ArrivalBlock } from './arrival-group.js';
import { fieldCode, type ArrivalFieldName } from './chunk-fields.js';
import {
  chunkBlock,
  chunkValue,
  decodeChunkBlock,
  findChunkEntry,
  type ChunkBlock,
} from './chunk-row.js';
import { decodeRowHeader } from './rowRecord.js';
import { mapReader } from './groupBuildShared.js';

export async function readRecordingField(
  ctx: BuildContext,
  handle: ArrivalBlock,
  name: ArrivalFieldName,
): Promise<ChunkBlock | undefined> {
  if (ctx.access === undefined)
    throw new Error('Recording has no committed state');
  const head = decodeTranscriptHead(
    await mapReader(ctx, 'state').get(
      ctx.published?.roots.stateRoot ?? 0,
      TRANSCRIPT_HEAD_KEY,
    ),
  );
  const entry = await findChunkEntry(
    ctx.access,
    head.root,
    'transcript',
    handle.transcriptId,
  );
  if (entry.status !== 0) throw new Error('Recording row is not in progress');
  const header = decodeRowHeader(
    (await ctx.access.readRecordHead(entry.rowRef, 'ROW')).kindHeader,
  );
  if (header.chunk === undefined) throw new Error('Missing manifest');
  const block = await chunkBlock(ctx.access, header.chunk, handle.ordinal);
  if (block.named !== true || block.ended)
    throw new Error('Named block is not open');
  const code = BigInt(fieldCode(name));
  const field = await transcriptEntries(
    ctx.access,
    block.piecesRoot,
    'blocks',
    code,
    false,
  ).next();
  return field.value?.transcriptId === code
    ? decodeChunkBlock(await chunkValue(ctx.access, field.value.rowRef))
    : undefined;
}
export function recordingMutations(seams: {
  readonly enqueue: <T>(run: () => Promise<T>) => Promise<T>;
  readonly writer: () => JournalGroupWriter;
  readonly context: () => BuildContext;
  readonly installed: (result: RecordingMutation<unknown>) => void;
}): <T>(
  build: (
    ctx: BuildContext,
    target: RecordAppender,
  ) => Promise<RecordingMutation<T>>,
) => Promise<{ readonly value: T; readonly ack: CommitAck }> {
  return <T>(
    build: (
      ctx: BuildContext,
      target: RecordAppender,
    ) => Promise<RecordingMutation<T>>,
  ) =>
    seams.enqueue(async () => {
      let result: RecordingMutation<T> | undefined;
      const ack = await seams.writer().prepareGroup(async (target) => {
        result = await build(seams.context(), target);
        return result.built.state;
      }, true);
      if (result === undefined || ack === undefined)
        throw new Error('Recording left no commit');
      seams.installed(result);
      return { value: result.value, ack };
    });
}

export async function interruptRecordingOrphans(
  store: ArrivalStore & {
    getState(key: string): Promise<Uint8Array | undefined>;
  },
  access: () => RecordAccess,
): Promise<void> {
  const head = decodeTranscriptHead(await store.getState(TRANSCRIPT_HEAD_KEY));
  if (head.openRoot === 0) return;
  const release = await store.pin();
  try {
    for await (const entry of transcriptEntries(
      access(),
      head.openRoot,
      'open',
      0n,
      false,
    )) {
      await store.mutateRecording(async (ctx, target) => {
        const group = await ArrivalGroup.start(ctx, target);
        await group.finish(entry, 'interrupted');
        return group.complete(undefined);
      });
    }
  } finally {
    await release();
  }
}
