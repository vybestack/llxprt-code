/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ChronologyFacts } from './chronologyFacts.js';
import type { BuildContext } from './groupBuildShared.js';
import { IdFactQueries } from './idFactQueries.js';
import { IdTrieReader } from './idTrieReader.js';
import { readNeutralRowFact } from './neutral-row-fact-storage.js';
import {
  neutralRowFactKey,
  type NeutralRowFactRegistration,
} from './neutralRowFacts.js';
import { ROW_ENTRY_NO_CHRONOLOGY_SEQ, type RowEntry } from './rowEntry.js';

export function previousNeutralFacts(
  ctx: BuildContext,
): IdFactQueries | undefined {
  const version = ctx.published;
  if (version === undefined || ctx.access === undefined) return undefined;
  const reader = new IdTrieReader(ctx.access, ctx.idCache);
  return new IdFactQueries(
    { get: (hash) => reader.lookup(version.roots.idRoot, hash) },
    ctx.idDeps,
  );
}

export async function reusableNeutralFact(
  current: IdFactQueries,
  previous: IdFactQueries | undefined,
  registration: NeutralRowFactRegistration,
  entry: RowEntry,
): Promise<Uint8Array | undefined> {
  const stored = await readNeutralRowFact(
    current,
    neutralRowFactKey(registration, entry.label),
  );
  if (
    stored !== undefined ||
    previous === undefined ||
    entry.chronologySeq === ROW_ENTRY_NO_CHRONOLOGY_SEQ
  )
    return stored;
  const chronology = new ChronologyFacts(previous);
  if ((await chronology.count(entry.chronologySeq, false)) !== 1)
    return undefined;
  const label = await chronology.label(entry.chronologySeq, false, 1);
  return label === undefined
    ? undefined
    : readNeutralRowFact(previous, neutralRowFactKey(registration, label));
}
