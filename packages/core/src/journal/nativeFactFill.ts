/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { decodeDecimal, encodeDecimal } from './metaFacts.js';
import { maintainNativeFacts } from './native-fact-maintenance.js';
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
  NATIVE_FACTS_THROUGH,
  NativeFactIndexWriter,
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
  const through = await mapReader(ctx, 'meta').get(
    ctx.published.roots.metaRoot,
    NATIVE_FACTS_THROUGH,
  );
  if (through === undefined) return undefined;
  return decodeDecimal(through) === BigInt(ctx.published.commitSeq) &&
    active !== undefined &&
    new TextDecoder().decode(active) === edit.registration.scope
    ? edit.registration
    : undefined;
}

function changesNativeSource(edit: VersionEdit): boolean {
  return ![
    'chronology',
    'densityCalls',
    'recency',
    'kimi',
    'mistral',
    'mistralScope',
    'setState',
    'checkpoint',
    'deleteCheckpoint',
    'format',
    'factIndex',
    'densityFiles',
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
  const changed = edits.some(changesNativeSource);
  if (registration === undefined || (!explicit && !changed))
    return advanceCoverage(ctx, built, appender, changed);
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
    const { invalidated, rebuilt } = await maintainNativeFacts(
      ctx,
      snapshot,
      writer,
      registration,
      edits,
    );
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
    meta.set(NATIVE_FACTS_THROUGH, encodeDecimal(ctx.commitSeq));
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
      invalidated:
        invalidated ||
        (rebuilt &&
          ctx.published?.slots.formatSlots.some(
            (format) => format.summaryKind === 'anthropic',
          ) === true),
    };
  } finally {
    await snapshot.close();
  }
}

async function advanceCoverage(
  ctx: BuildContext,
  built: BuiltGroup,
  appender: RecordAppender,
  changed: boolean,
): Promise<{ built: BuiltGroup; invalidated: boolean }> {
  if (changed || ctx.published === undefined)
    return { built, invalidated: false };
  const reader = mapReader(ctx, 'meta');
  const through = await reader.get(
    ctx.published.roots.metaRoot,
    NATIVE_FACTS_THROUGH,
  );
  if (
    through === undefined ||
    decodeDecimal(through) !== BigInt(ctx.published.commitSeq)
  )
    return { built, invalidated: false };
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
  meta.set(NATIVE_FACTS_THROUGH, encodeDecimal(ctx.commitSeq));
  return {
    built: {
      ...built,
      state: { ...built.state, metaRoot: await meta.commit(appender) },
    },
    invalidated: false,
  };
}
