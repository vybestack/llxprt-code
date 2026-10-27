/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
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
  nativeFactCoverage,
  encodeNativeFactCoverage,
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
  const coverage = nativeFactCoverage(active);
  return coverage?.through === BigInt(ctx.published.commitSeq) &&
    coverage.scope === edit.registration.scope
    ? edit.registration
    : undefined;
}

export function changesNativeSource(edit: VersionEdit): boolean {
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
  refillAllowed = true,
): Promise<{ built: BuiltGroup; invalidated: boolean }> {
  const explicit = edits.some((edit) => edit.kind === 'factIndex');
  const changed = edits.some(changesNativeSource);
  if (registration === undefined || (!explicit && !changed))
    return advanceCoverage(ctx, built, appender, changed);
  // Keep the last complete prefix available for catch-up while its format
  // writer is detached. Coverage stays behind the published version, so
  // readers cannot mistake those prefix facts for a filled current index.
  if (!explicit && !refillAllowed) return { built, invalidated: true };
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
      refillAllowed,
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
    meta.set(
      ACTIVE_FACT_INDEX,
      encodeNativeFactCoverage(
        invalidated ? '' : registration.scope,
        ctx.commitSeq,
      ),
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
  const coverage = nativeFactCoverage(
    await reader.get(ctx.published.roots.metaRoot, ACTIVE_FACT_INDEX),
  );
  if (
    coverage === undefined ||
    coverage.through !== BigInt(ctx.published.commitSeq)
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
  meta.set(
    ACTIVE_FACT_INDEX,
    encodeNativeFactCoverage(coverage.scope, ctx.commitSeq),
  );
  return {
    built: {
      ...built,
      state: { ...built.state, metaRoot: await meta.commit(appender) },
    },
    invalidated: false,
  };
}
