/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { EMPTY_AGGREGATE } from './aggregateComposition.js';
import { JournalFormatError } from './errors.js';
import type { RecordAppender } from './groupAppender.js';
import {
  collectFacts,
  existingEntries,
  type FactDeps,
  type GroupFacts,
} from './groupFacts.js';
import type { GroupPlan } from './groupPlan.js';
import type { TrailerState } from './groupWriter.js';
import type { IdNodeCache } from './idTrieCache.js';
import { KeyedMapBatch, KeyedMapReader, type MapKind } from './keyedMap.js';
import type { IdKeyHasher } from './idKeys.js';
import type { LineageChain } from './lineageChain.js';
import type { RecordAccess } from './recordAccess.js';
import type { MutationCode } from './recordKinds.js';
import { encodeRowDraft, entryForNewRow, type EncodedRow } from './rowDraft.js';
import type { RowEntry } from './rowEntry.js';
import {
  appendRowEntries,
  type RightSpine,
  type RowTreeAlgebra,
} from './rowTreeBuilder.js';
import { hasActiveSlot, slotKindsOf, type Version } from './version.js';

/** The seams a group is built with, all supplied by the store. */
export interface BuildContext extends FactDeps {
  readonly access: RecordAccess | undefined;
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
  readonly state: TrailerState;
  readonly spine: RightSpine | undefined;
  readonly chainBase: LineageChain;
}

/** The rows a group puts in the tree, in label order, with the first and last seen. */
class RowStream {
  first: RowEntry | undefined;
  last: RowEntry | undefined;

  constructor(
    private readonly kept: AsyncGenerator<RowEntry> | undefined,
    private readonly written: readonly RowEntry[],
  ) {}

  async *entries(): AsyncGenerator<RowEntry> {
    if (this.kept !== undefined) {
      for await (const entry of this.kept) yield this.note(entry);
    }
    for (const entry of this.written) yield this.note(entry);
  }

  private note(entry: RowEntry): RowEntry {
    this.first ??= entry;
    this.last = entry;
    return entry;
  }
}

async function writeRows(
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

interface TreeResult {
  readonly rowRoot: number;
  readonly aggregate: Version['aggregate'];
  readonly spine: RightSpine | undefined;
  readonly firstLabel: bigint;
  readonly lastRowOffset: number;
  readonly lastOwner: number;
}

async function buildTree(
  ctx: BuildContext,
  plan: GroupPlan,
  appender: RecordAppender,
  written: readonly RowEntry[],
): Promise<TreeResult> {
  const { base } = plan;
  const kept = existingEntries(ctx.access, plan.range);
  if (kept === undefined && written.length === 0) {
    return {
      rowRoot: base.roots.rowRoot,
      aggregate: base.rows === 0 ? EMPTY_AGGREGATE : base.aggregate,
      spine: undefined,
      firstLabel: base.firstLabel,
      lastRowOffset: base.lastRowOffset,
      lastOwner: base.lastOwner,
    };
  }
  const stream = new RowStream(kept, written);
  const spine = base.rows > 0 ? await ctx.spineFor(base) : undefined;
  const algebra = ctx.algebra(slotKindsOf(base.slots));
  const tree = await appendRowEntries(
    appender,
    algebra,
    spine,
    stream.entries(),
  );
  const { first, last } = stream;
  if (first === undefined || last === undefined) {
    throw new JournalFormatError('A row append wrote no entries');
  }
  return {
    rowRoot: tree.root.childOffset,
    aggregate: tree.root.aggregate,
    spine: tree.spine,
    firstLabel: base.rows > 0 ? base.firstLabel : first.label,
    lastRowOffset: last.recordOffset,
    lastOwner: last.owner,
  };
}

async function commitState(
  ctx: BuildContext,
  plan: GroupPlan,
  appender: RecordAppender,
): Promise<number> {
  const root = ctx.published?.roots.stateRoot ?? 0;
  if (plan.stateSets.size === 0) return root;
  const batch = new KeyedMapBatch(mapReader(ctx, 'state'), root);
  for (const [key, value] of plan.stateSets) batch.set(key, value);
  return batch.commit(appender);
}

export function mapReader(ctx: BuildContext, kind: MapKind): KeyedMapReader {
  return new KeyedMapReader(
    ctx.access,
    kind === 'meta' ? ctx.metaCache : ctx.stateCache,
    kind,
    ctx.hasher,
  );
}

async function commitFacts(
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

function hasPendingRows(plan: GroupPlan): boolean {
  return plan.range !== undefined || plan.newRows.length > 0;
}

/**
 * Everything a group writes except the trailer, and the trailer's state.
 * Reads and encoding come first, so a failure there leaves the file untouched
 * (the writer keeps working); then the records are appended in the order row
 * records, id trie, meta map, row tree, state map.
 */
export async function buildGroup(
  ctx: BuildContext,
  plan: GroupPlan,
  mutation: MutationCode,
  appender: RecordAppender,
): Promise<BuiltGroup> {
  const pending = hasPendingRows(plan);
  if (pending && hasActiveSlot(plan.base.slots)) {
    throw new JournalFormatError(
      'A format slot is active, and filling its summaries is not part of this append',
    );
  }
  const encoded = plan.newRows.map(({ label, draft }) =>
    encodeRowDraft(label, draft),
  );
  const facts = pending
    ? await collectFacts(ctx.access, plan, ctx, mapReader(ctx, 'meta'))
    : undefined;
  const chainBase = await ctx.chainFor(plan.parent);
  const written = await writeRows(appender, encoded);
  const { idRoot, metaRoot } = await commitFacts(facts, plan, appender);
  const tree = await buildTree(ctx, plan, appender, written);
  const stateRoot = await commitState(ctx, plan, appender);
  return {
    state: trailerState(ctx, plan, mutation, chainBase, {
      ...tree,
      idRoot,
      metaRoot,
      stateRoot,
    }),
    spine: tree.spine,
    chainBase,
  };
}

function trailerState(
  ctx: BuildContext,
  plan: GroupPlan,
  mutation: MutationCode,
  chain: LineageChain,
  built: TreeResult & { idRoot: number; metaRoot: number; stateRoot: number },
): TrailerState {
  const { parent } = plan;
  return {
    parent: parent?.selfOffset ?? 0,
    skip: chain.skipsForChild(),
    lineage: plan.lineageId ?? BigInt(ctx.commitSeq),
    lineageDepth: parent === undefined ? 0 : parent.lineageDepth + 1,
    mutation,
    mutationArg0: plan.pop?.cut ?? 0n,
    mutationArg1: BigInt(plan.pop?.removed ?? 0),
    rowRoot: built.rowRoot,
    idRoot: built.idRoot,
    metaRoot: built.metaRoot,
    stateRoot: built.stateRoot,
    nextLabel: plan.nextLabel,
    firstLabel: built.firstLabel,
    lastRowOffset: built.lastRowOffset,
    lastOwner: built.lastOwner,
    ckptBytes: (ctx.published?.ckptBytes ?? 0) + plan.ckptDelta,
    rootAggregate: built.aggregate,
    slots: plan.base.slots,
  };
}
