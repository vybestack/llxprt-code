/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { BuildContext, BuiltGroup } from './groupBuildShared.js';
import type { RecordAppender } from './groupAppender.js';
import { startFacts } from './groupFacts.js';
import { KeyedMapReader } from './keyedMap.js';
import {
  decodeMistralSlots,
  MISTRAL_GENERATION_KEY,
  MISTRAL_SLOTS_KEY,
} from './mistralMapping.js';
import { encodeDecimal } from './metaFacts.js';
import { iterateRowEntries } from './rowTreeReader.js';
import { readRowIds } from './rowReads.js';
import { plannedFromIds } from './unitContributions.js';
import { observeNormalizedMistralRow } from './normalizedRowOccurrences.js';

export async function fillMistralFormat(
  ctx: BuildContext,
  built: BuiltGroup,
  appender: RecordAppender,
  slot: number,
): Promise<BuiltGroup> {
  await appender.drain();
  const reader = new KeyedMapReader(
    ctx.readGroup(appender.nextOffset),
    ctx.metaCache,
    'meta',
    ctx.hasher,
  );
  const mask = decodeMistralSlots(
    await reader.get(built.state.metaRoot, MISTRAL_SLOTS_KEY),
  );
  if ((mask & (1 << slot)) !== 0) return built;
  const facts = await startFacts(
    ctx.readGroup(appender.nextOffset),
    {
      rowRoot: built.state.rowRoot,
      idRoot: built.state.idRoot,
      metaRoot: built.state.metaRoot,
    },
    ctx,
    reader,
    { appender, readGroup: ctx.readGroup },
    mask | (1 << slot),
  );
  for await (const entry of iterateRowEntries(
    ctx.readGroup(appender.nextOffset),
    { offset: built.state.rowRoot, rows: built.state.rootAggregate.rows },
  )) {
    const row = plannedFromIds(
      await readRowIds(ctx.readGroup(appender.nextOffset), entry),
    );
    await observeNormalizedMistralRow(row, entry, facts, ctx, {
      appender,
      readGroup: ctx.readGroup,
    });
  }
  facts.meta.set(MISTRAL_GENERATION_KEY, encodeDecimal(ctx.commitSeq));
  const ids = await facts.ids.commit(appender);
  const metaRoot = await facts.meta.commit(appender);
  await appender.drain();
  return { ...built, state: { ...built.state, idRoot: ids.root, metaRoot } };
}
