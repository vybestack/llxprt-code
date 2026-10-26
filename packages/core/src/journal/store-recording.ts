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
