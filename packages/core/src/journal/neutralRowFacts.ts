/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  encodeNeutralRowFact,
  decodeNeutralRowFact,
} from './neutral-row-fact-codec.js';
import type { BuildContext, BuiltGroup } from './groupBuildShared.js';
import type { RecordAppender } from './groupAppender.js';
import { snapshotOf } from './formatFill.js';
import { IdFactBatch } from './idFactBatch.js';
import { IdTrieReader } from './idTrieReader.js';
import { ID_NS } from './idKeys.js';
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
  if (registration === undefined) return built;
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
  const since =
    new TextDecoder().decode(ready) === revision
      ? (ctx.published?.durableEnd ?? 0)
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
    for await (const entry of changedEntries(
      ctx,
      appender,
      built.state.rowRoot,
      since,
    )) {
      const key = neutralRowFactKey(registration, entry.label);
      const previous = await batch.queries.getEntry(ID_NS.neutralRow, key);
      const value = await registration.measure(
        snapshot,
        entry,
        previous === undefined ? undefined : decodeNeutralRowFact(previous),
      );
      await batch.setEntry(ID_NS.neutralRow, key, encodeNeutralRowFact(value));
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
