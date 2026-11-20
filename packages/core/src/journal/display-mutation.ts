/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  ArrivalGroup,
  type ArrivalStore,
  type ArrivalRow,
} from './arrival-group.js';
import type { RowDraft } from './rowDraft.js';
import { encodeTextSuffix } from './chunk-fields.js';
import type { RecordAccess } from './recordAccess.js';
import type { RecordAppender } from './groupAppender.js';
import { KeyedMapReader, KeyedMapBatch } from './keyedMap.js';
import {
  TranscriptTreeWriter,
  type TranscriptEntry,
} from './transcript-tree.js';
import { appendChunkValue, findChunkEntry } from './chunk-row.js';
import {
  TRANSCRIPT_HEAD_KEY,
  decodeTranscriptHead,
  encodeTranscriptHead,
  type TranscriptHead,
} from './transcript-head.js';

interface DisplayMutation {
  readonly row?: ArrivalRow;
  readonly draft?: RowDraft;
  readonly presentation?: Uint8Array;
  readonly text?: string;
  readonly retract?: boolean;
  readonly relationKey?: string;
}

async function rewriteHead(
  access: () => RecordAccess,
  target: RecordAppender,
  head: TranscriptHead,
  entry: TranscriptEntry,
  operation: DisplayMutation,
): Promise<TranscriptHead> {
  const creating = operation.presentation !== undefined;
  if (
    !creating &&
    (entry.audience !== 2 ||
      entry.status !== (operation.retract === true ? 1 : 0))
  )
    throw new Error('Only an eligible display-only row can be changed');
  const presentationRef =
    operation.presentation === undefined
      ? entry.presentationRef
      : await appendChunkValue(
          target,
          'transcript:display',
          operation.presentation,
        );
  let status = 1;
  if (creating && operation.text === undefined) status = 0;
  else if (operation.retract === true) status = 6;
  const updated = {
    ...entry,
    audience: 2,
    status,
    presentationRef,
    revision: entry.revision + 1,
  };
  const tree = (mode: 'transcript' | 'open') =>
    new TranscriptTreeWriter(access, target, mode);
  const root = await tree('transcript').insert(head.root, updated);
  let openRoot = head.openRoot;
  if (status === 0) openRoot = await tree('open').insert(openRoot, updated);
  else if (status !== 6)
    openRoot = await tree('open').remove(openRoot, entry.transcriptId);
  return {
    ...head,
    root,
    openRoot,
    reachableBytes: head.reachableBytes + (operation.presentation?.length ?? 0),
  };
}

/** Audience and display relations publish under the same trailer as the descriptor. */
export async function mutateDisplay(
  store: ArrivalStore,
  operation: DisplayMutation,
): Promise<ArrivalRow> {
  const result = await store.mutateRecording(async (ctx, target) => {
    const group = await ArrivalGroup.start(ctx, target);
    const row =
      operation.draft === undefined
        ? operation.row
        : await group.begin(operation.draft, {
            id: crypto.randomUUID(),
            submissionId: '',
          });
    if (row === undefined) throw new Error('Missing display row identity');
    if (operation.text !== undefined) {
      const block = await group.beginBlock(row, 0, true);
      for (const bytes of encodeTextSuffix(operation.text, 0, false))
        await group.appendNamed(block, 'text', bytes);
      if (operation.text.length === 0)
        await group.appendNamed(block, 'text', new Uint8Array());
      await group.endBlock(block);
    }
    const mutation = await group.complete(row);
    await target.drain();
    const access = () => ctx.readGroup(target.nextOffset);
    const state = new KeyedMapBatch(
      new KeyedMapReader(access(), ctx.stateCache, 'state', ctx.hasher),
      mutation.built.state.stateRoot,
    );
    const head = decodeTranscriptHead(await state.get(TRANSCRIPT_HEAD_KEY));
    const entry = await findChunkEntry(
      access(),
      head.root,
      'transcript',
      row.transcriptId,
    );
    state.set(
      TRANSCRIPT_HEAD_KEY,
      encodeTranscriptHead(
        await rewriteHead(access, target, head, entry, operation),
      ),
    );
    if (operation.relationKey !== undefined)
      state.set(
        operation.relationKey,
        new TextEncoder().encode(row.transcriptId.toString()),
      );
    return {
      value: row,
      built: {
        ...mutation.built,
        state: {
          ...mutation.built.state,
          stateRoot: await state.commit(target),
        },
      },
    };
  });
  return result.value;
}
