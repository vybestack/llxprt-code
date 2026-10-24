/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  readNeutralRowFact,
  writeNeutralRowFact,
} from './neutral-row-fact-storage.js';
import { filledVersion } from './filled-version.js';
import { decodeDecimal, encodeDecimal } from './metaFacts.js';
import type { BuildContext, BuiltGroup } from './groupBuildShared.js';
import type { RecordAppender } from './groupAppender.js';
import { snapshotOf } from './formatFill.js';
import { IdFactBatch } from './idFactBatch.js';
import { IdTrieReader } from './idTrieReader.js';
import { KeyedMapBatch, KeyedMapReader } from './keyedMap.js';
import { readRowTreeNode } from './rowTreeReader.js';
import type { RowEntry } from './rowEntry.js';
import type { VersionSnapshot } from './versionSnapshot.js';

export interface NeutralRowFactRegistration {
  readonly kind: 'token-usage';
  readonly revision: string;
  measure(
    snapshot: VersionSnapshot,
    entry: RowEntry,
    previous: Uint8Array | undefined,
  ): Promise<Uint8Array>;
}

export function neutralRowFactKey(
  registration: Pick<NeutralRowFactRegistration, 'kind' | 'revision'>,
  label: bigint,
): Uint8Array {
  return new TextEncoder().encode(
    `${registration.kind}:${registration.revision}:${label}`,
  );
}

export const NEUTRAL_ROW_FACTS_READY = 'history:neutral-row-facts:1';
export const NEUTRAL_ROW_FACTS_THROUGH = 'history:neutral-row-facts-through:1';

async function* changedEntries(
  ctx: BuildContext,
  appender: RecordAppender,
  offset: number,
  since: number,
): AsyncGenerator<RowEntry> {
  if (offset === 0 || offset < since) return;
  const node = await readRowTreeNode(
    ctx.readGroup(appender.nextOffset),
    offset,
  );
  if (node.kind === 'leaf') yield* node.entries;
  else
    for (const child of node.slots)
      yield* changedEntries(ctx, appender, child.childOffset, since);
}

export async function fillNeutralRowFacts(
  ctx: BuildContext,
  built: BuiltGroup,
  appender: RecordAppender,
): Promise<BuiltGroup> {
  const registration = ctx.neutralRowFacts;
  if (registration === undefined || ctx.deferNeutralRowFacts === true)
    return built;
  await appender.drain();
  const access = ctx.readGroup(appender.nextOffset);
  const metaReader = new KeyedMapReader(
    access,
    ctx.metaCache,
    'meta',
    ctx.hasher,
  );
  const ready = await metaReader.get(
    built.state.metaRoot,
    NEUTRAL_ROW_FACTS_READY,
  );
  const revision = `${registration.kind}:${registration.revision}`;
  const through = await metaReader.get(
    built.state.metaRoot,
    NEUTRAL_ROW_FACTS_THROUGH,
  );
  const source =
    through === undefined
      ? undefined
      : await filledVersion(ctx, Number(decodeDecimal(through)));
  const since =
    new TextDecoder().decode(ready) === revision
      ? (source?.durableEnd ?? 0)
      : 0;
  const batch = new IdFactBatch(
    new IdTrieReader(access, ctx.idCache),
    built.state.idRoot,
    ctx.idDeps,
    0,
    { appender, readGroup: ctx.readGroup },
  );
  const snapshot = snapshotOf(ctx, built, appender);
  try {
    const entries =
      source === ctx.published && since > 0 && built.changedRows !== undefined
        ? built.changedRows
        : changedEntries(ctx, appender, built.state.rowRoot, since);
    for await (const entry of entries) {
      const key = neutralRowFactKey(registration, entry.label);
      const previous = await readNeutralRowFact(batch.queries, key);
      if (entry.recordOffset < since && previous !== undefined) continue;
      const value = await registration.measure(snapshot, entry, previous);
      await writeNeutralRowFact(batch, key, value);
    }
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
    meta.set(NEUTRAL_ROW_FACTS_READY, new TextEncoder().encode(revision));
    meta.set(NEUTRAL_ROW_FACTS_THROUGH, encodeDecimal(ctx.commitSeq));
    return {
      ...built,
      state: {
        ...built.state,
        idRoot: committed.root,
        metaRoot: await meta.commit(appender),
      },
    };
  } finally {
    await snapshot.close();
  }
}
