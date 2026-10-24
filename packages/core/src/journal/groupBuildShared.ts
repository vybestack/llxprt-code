/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { NeutralRowFactRegistration } from './neutralRowFacts.js';
import type { LabelSorter } from './ordered-labels.js';
import type { Aggregate } from './aggregate.js';
import type { RecordAppender } from './groupAppender.js';
import type { FactDeps, GroupFacts } from './groupFacts.js';
import type { ReadGroup } from './idFactBatch.js';
import type { GroupPlan } from './groupPlanTypes.js';
import type { TrailerState } from './groupWriter.js';
import type { IdKeyHasher } from './idKeys.js';
import type { IdNodeCache } from './idTrieCache.js';
import { KeyedMapBatch, KeyedMapReader, type MapKind } from './keyedMap.js';
import type { LineageChain } from './lineageChain.js';
import type { RecordAccess } from './recordAccess.js';
import type { MutationCode } from './recordKinds.js';
import { entryForNewRow, type EncodedRow } from './rowDraft.js';
import type { RowEntry } from './rowEntry.js';
import type { RightSpine, RowTreeAlgebra } from './rowTreeBuilder.js';
import type { slotKindsOf, Version } from './version.js';

/** The seams a group is built with, all supplied by the store. */
export interface BuildContext extends FactDeps {
  readonly sortedLabels: LabelSorter;
  readonly neutralRowFacts?: NeutralRowFactRegistration;
  readonly deferNeutralRowFacts?: boolean;
  readonly measureFormats?: boolean;
  readonly access: RecordAccess | undefined;
  /** Reads the file up to `writtenEnd`, which reaches records the current group has written and drained. */
  readonly readGroup: ReadGroup;
  readonly published: Version | undefined;
  readonly hasher: IdKeyHasher;
  readonly metaCache: IdNodeCache;
  readonly stateCache: IdNodeCache;
  readonly algebra: (kinds: ReturnType<typeof slotKindsOf>) => RowTreeAlgebra;
  readonly spineFor: (version: Version) => Promise<RightSpine>;
  readonly chainFor: (parent: Version | undefined) => Promise<LineageChain>;
  /** The `commitSeq` the group will get; a new lineage takes it as its id. */
  readonly commitSeq: number;
}

/** What the store keeps after the group is acked, and nothing before. */
export interface BuiltGroup {
  readonly changedRows?: Iterable<RowEntry>;
  readonly state: TrailerState;
  readonly spine: RightSpine | undefined;
  readonly chainBase: LineageChain;
}

/** What the row tree of a group contributes to its trailer. */
export interface TreeResult {
  readonly rowRoot: number;
  readonly aggregate: Aggregate;
  readonly spine: RightSpine | undefined;
  readonly firstLabel: bigint;
  readonly lastRowOffset: number;
  readonly lastOwner: number;
}

/** Everything the trailer needs besides the plan and the lineage. */
export interface GroupTotals extends TreeResult {
  readonly idRoot: number;
  readonly metaRoot: number;
  readonly stateRoot: number;
  /** The next label after the group; a replace allocates labels while it streams. */
  readonly nextLabel: bigint;
}

/** Appends the record of each row and returns the entry that points at it. */
export async function writeRows(
  appender: RecordAppender,
  encoded: readonly EncodedRow[],
): Promise<RowEntry[]> {
  const entries: RowEntry[] = [];
  for (const row of encoded) {
    const offset = await appender.append(row.record);
    entries.push(entryForNewRow(row, offset));
  }
  return entries;
}

export function mapReader(ctx: BuildContext, kind: MapKind): KeyedMapReader {
  return new KeyedMapReader(
    ctx.access,
    kind === 'meta' ? ctx.metaCache : ctx.stateCache,
    kind,
    ctx.hasher,
  );
}

export async function commitState(
  ctx: BuildContext,
  plan: GroupPlan,
  appender: RecordAppender,
): Promise<number> {
  const root = ctx.published?.roots.stateRoot ?? 0;
  if (plan.stateSets.size === 0) return root;
  const batch = new KeyedMapBatch(mapReader(ctx, 'state'), root);
  for (const [key, { value, storage }] of plan.stateSets) {
    if (storage === 'body') batch.setBody(key, value);
    else batch.set(key, value);
  }
  return batch.commit(appender);
}

/** The id trie and meta map roots a group leaves: the facts' merge, or the base's roots when the group has none. */
export async function commitFacts(
  facts: GroupFacts | undefined,
  plan: GroupPlan,
  appender: RecordAppender,
): Promise<{ idRoot: number; metaRoot: number }> {
  if (facts === undefined) {
    return {
      idRoot: plan.base.roots.idRoot,
      metaRoot: plan.base.roots.metaRoot,
    };
  }
  const { root } = await facts.ids.commit(appender);
  return { idRoot: root, metaRoot: await facts.meta.commit(appender) };
}

export function trailerState(
  ctx: BuildContext,
  plan: GroupPlan,
  mutation: MutationCode,
  chain: LineageChain,
  built: GroupTotals,
): TrailerState {
  const { parent } = plan;
  const args = plan.args;
  return {
    parent: parent?.selfOffset ?? 0,
    skip: chain.skipsForChild(),
    lineage: plan.lineageId ?? BigInt(ctx.commitSeq),
    lineageDepth: parent === undefined ? 0 : parent.lineageDepth + 1,
    mutation,
    mutationArg0: args?.cut ?? 0n,
    mutationArg1: BigInt(args?.removed ?? 0),
    rowRoot: built.rowRoot,
    idRoot: built.idRoot,
    metaRoot: built.metaRoot,
    stateRoot: built.stateRoot,
    nextLabel: built.nextLabel,
    firstLabel: built.firstLabel,
    lastRowOffset: built.lastRowOffset,
    lastOwner: built.lastOwner,
    ckptBytes: (ctx.published?.ckptBytes ?? 0) + plan.ckptDelta,
    rootAggregate: built.aggregate,
    slots: plan.base.slots,
  };
}
