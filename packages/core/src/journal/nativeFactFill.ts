/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { VersionEdit } from './groupEdits.js';
import {
  mapReader,
  type BuildContext,
  type BuiltGroup,
} from './groupBuildShared.js';
import type { RecordAppender } from './groupAppender.js';
import { snapshotOf } from './formatFill.js';
import { IdFactBatch } from './idFactBatch.js';
import { IdTrieReader } from './idTrieReader.js';
import { KeyedMapBatch, KeyedMapReader } from './keyedMap.js';
import {
  ACTIVE_FACT_INDEX,
  NativeFactIndexWriter,
  nativeFactVersion,
  type NativeFactIndexRegistration,
} from './nativeFactIndex.js';

export async function warmNativeFacts(
  ctx: BuildContext,
  edits: readonly VersionEdit[],
): Promise<NativeFactIndexRegistration | undefined> {
  const edit = edits[0];
  if (
    edits.length !== 1 ||
    edit.kind !== 'factIndex' ||
    ctx.published === undefined
  )
    return undefined;
  const active = await mapReader(ctx, 'meta').get(
    ctx.published.roots.metaRoot,
    ACTIVE_FACT_INDEX,
  );
  return active !== undefined &&
    new TextDecoder().decode(active) === edit.registration.scope
    ? edit.registration
    : undefined;
}

export async function requireNativeFactWriter(
  ctx: BuildContext,
  edits: readonly VersionEdit[],
  registration: NativeFactIndexRegistration | undefined,
): Promise<void> {
  if (registration !== undefined || ctx.published === undefined) return;
  const changesSource = edits.some(
    (edit) =>
      ![
        'toolRanking',
        'setState',
        'checkpoint',
        'deleteCheckpoint',
        'format',
      ].includes(edit.kind),
  );
  if (
    changesSource &&
    (await mapReader(ctx, 'meta').get(
      ctx.published.roots.metaRoot,
      ACTIVE_FACT_INDEX,
    )) !== undefined
  )
    throw new JournalFormatError(
      'Active native fact writer must be registered before changing history',
    );
}
function changesSource(edit: VersionEdit): boolean {
  return ![
    'setState',
    'checkpoint',
    'deleteCheckpoint',
    'format',
    'factIndex',
    'toolRanking',
  ].includes(edit.kind);
}

export async function fillNativeFacts(
  ctx: BuildContext,
  built: BuiltGroup,
  appender: RecordAppender,
  registration: NativeFactIndexRegistration | undefined,
  edits: readonly VersionEdit[],
): Promise<{ built: BuiltGroup; invalidated: boolean }> {
  const explicit = edits.some((edit) => edit.kind === 'factIndex');
  const changed = edits.some(changesSource);
  if (registration === undefined || (!explicit && !changed))
    return { built, invalidated: false };
  await appender.drain();
  const batch = new IdFactBatch(
    new IdTrieReader(ctx.readGroup(appender.nextOffset), ctx.idCache),
    built.state.idRoot,
    ctx.idDeps,
    0,
    { appender, readGroup: ctx.readGroup },
  );
  const writer = new NativeFactIndexWriter(batch, registration.scope);
  const snapshot = snapshotOf(ctx, built, appender);
  try {
    const previous = await writer.get(['version']);
    const generation = nativeFactVersion(
      (previous?.[0] ?? 0) + (previous?.[1] ?? 0) * 0x1_0000_0000 + 1,
    );
    let invalidated = false;
    if (
      !explicit &&
      registration.append !== undefined &&
      ctx.published?.slots.formatSlots.some(
        (format) => format.summaryKind === 'anthropic',
      ) === true
    ) {
      invalidated = !(await registration.append(
        snapshot,
        writer,
        ctx.published,
        edits,
      ));
    } else {
      await registration.write(snapshot, writer, generation);
      await writer.set(['version'], generation);
    }
    await writer.set(['invalid'], [Number(invalidated)]);
    const committed = await batch.commit(appender);
    await appender.drain();
    const meta = new KeyedMapBatch(
      new KeyedMapReader(
        ctx.readGroup(appender.nextOffset),
        ctx.metaCache,
        'meta',
        ctx.hasher,
      ),
      built.state.metaRoot,
    );
    meta.set(
      ACTIVE_FACT_INDEX,
      new TextEncoder().encode(invalidated ? '' : registration.scope),
    );
    const metaRoot = await meta.commit(appender);
    return {
      built: {
        ...built,
        state: { ...built.state, idRoot: committed.root, metaRoot },
      },
      invalidated,
    };
  } finally {
    await snapshot.close();
  }
}
