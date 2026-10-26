/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { EMPTY_AGGREGATE } from './aggregateComposition.js';
import { rebuildContributions } from './contributionRebuild.js';
import { JournalFormatError } from './errors.js';
import { mapRowStream } from './mapped-row-stream.js';
import { kimiEnabled, KIMI_ELIGIBLE_KEY } from './kimiOrdinals.js';
import {
  decodeMistralSlots,
  MISTRAL_SLOTS_KEY,
  MISTRAL_GENERATION_KEY,
} from './mistralMapping.js';
import { encodeDecimal } from './metaFacts.js';
import type { RecordAppender } from './groupAppender.js';
import {
  commitState,
  mapReader,
  trailerState,
  type BuildContext,
  type BuiltGroup,
} from './groupBuildShared.js';
import { copyForeignRow } from './foreignRows.js';
import type { SourceRow } from './groupEdits.js';
import {
  NO_FACT_ROOTS,
  applyDraftRow,
  applyEntryRow,
  rangeEntries,
  finishFacts,
  startFacts,
  type GroupFacts,
} from './groupFacts.js';
import type {
  ForeignStreamSegment,
  FreshSegment,
  GroupPlan,
  Segment,
} from './groupPlanTypes.js';
import { allocateAppendLabels } from './labels.js';
import type { RecordAccess } from './recordAccess.js';
import type { MutationCode } from './recordKinds.js';
import {
  encodeRowDraft,
  entryForNewRow,
  entryForRewrittenRow,
  type EncodedRow,
} from './rowDraft.js';
import type { RowDraft } from './rowDraft.js';
import { ENTRY_FLAG, type RowEntry } from './rowEntry.js';
import { ROW_FLAG } from './rowRecord.js';
import { CONTRIBUTION_FLAGS } from './unitContributions.js';
import { bulkBuildRowTree } from './rowTreeBuilder.js';
import { readRowIds } from './rowReads.js';
import { slotKindsOf } from './version.js';

/** Writes the record of a fresh row and returns its entry. */
export async function writeFresh(
  appender: RecordAppender,
  segment: FreshSegment,
  encoded: EncodedRow,
): Promise<RowEntry> {
  const offset = await appender.append(encoded.record);
  return segment.replaces === undefined
    ? entryForNewRow(encoded, offset, appender.transcriptIdentity?.(offset))
    : entryForRewrittenRow(
        encoded,
        offset,
        segment.replaces,
        appender.transcriptIdentity?.(offset),
      );
}

/**
 * The rows of the whole new history in label order, as one pass: each row is
 * read from the file or written to it, its facts are applied, and its entry
 * goes to the tree builder. Memory is the builders' depth and one chunk of
 * id facts, which the batch merges into the trie as it fills (design 4.6).
 */
class RebuildPass {
  first: RowEntry | undefined;
  last: RowEntry | undefined;
  nextLabel: bigint;
  private readonly encoded = new Map<FreshSegment, EncodedRow>();

  constructor(
    private readonly ctx: BuildContext,
    startLabel: bigint,
    private readonly segments: readonly Segment[],
    private readonly appender: RecordAppender,
    readonly facts: GroupFacts,
  ) {
    this.nextLabel = startLabel;
    // Encoding comes first, so a row that cannot be encoded fails before a byte is written.
    for (const segment of segments) {
      if (segment.kind === 'fresh') {
        this.encoded.set(segment, encodeRowDraft(segment.label, segment.draft));
      }
    }
  }

  async *entries(): AsyncGenerator<RowEntry> {
    for (const segment of this.segments) {
      switch (segment.kind) {
        case 'existing':
          yield* this.existing(segment);
          break;
        case 'entry':
          yield await this.known(segment.entry);
          break;
        case 'fresh':
          yield await this.fresh(segment);
          break;
        case 'stream':
          yield* this.stream(segment.rows);
          break;
        case 'foreign':
          yield await this.foreign(segment.row);
          break;
        case 'foreignStream':
          yield* this.foreignStream(segment);
          break;
        default: {
          const unknown: never = segment;
          throw new JournalFormatError(
            `Unknown segment ${JSON.stringify(unknown)}`,
          );
        }
      }
    }
  }

  private async *existing(
    range: Extract<Segment, { kind: 'existing' }>,
  ): AsyncGenerator<RowEntry> {
    for await (const entry of rangeEntries(this.requireAccess(), range)) {
      yield await this.known(entry);
    }
  }

  private requireAccess(): RecordAccess {
    if (this.ctx.access === undefined) {
      throw new JournalFormatError(
        'Kept rows need a committed journal to read',
      );
    }
    return this.ctx.access;
  }

  private async known(entry: RowEntry): Promise<RowEntry> {
    await applyEntryRow(this.requireAccess(), this.facts, this.ctx, entry);
    return this.note(entry);
  }

  private async fresh(segment: FreshSegment): Promise<RowEntry> {
    const encoded = this.encoded.get(segment);
    if (encoded === undefined) {
      throw new JournalFormatError(`Row ${segment.label} was not encoded`);
    }
    const entry = await writeFresh(this.appender, segment, encoded);
    await applyDraftRow(this.facts, this.ctx, segment.label, segment.draft);
    return this.note(entry);
  }

  private stream(
    rows: Iterable<RowDraft> | AsyncIterable<RowDraft>,
  ): AsyncGenerator<RowEntry> {
    return mapRowStream(rows, (draft) => this.streamedRow(draft));
  }

  private async streamedRow(draft: RowDraft): Promise<RowEntry> {
    const allocated = allocateAppendLabels(this.nextLabel, 1);
    const label = allocated.labels[0];
    this.nextLabel = allocated.nextLabel;
    const encoded = encodeRowDraft(label, draft);
    const segment: FreshSegment = {
      kind: 'fresh',
      label,
      draft,
      role: 'append',
    };
    const entry = await writeFresh(this.appender, segment, encoded);
    await applyDraftRow(this.facts, this.ctx, label, draft);
    return this.note(entry);
  }

  /** Copies the row's record and applies its facts from the header and id piece, read once. */
  private async foreign(row: SourceRow): Promise<RowEntry> {
    const ids = await readRowIds(row.source, row.entry);
    await applyEntryRow(row.source, this.facts, this.ctx, row.entry, ids);
    return this.note(await copyForeignRow(this.appender, row, ids));
  }

  private async *foreignStream(
    segment: ForeignStreamSegment,
  ): AsyncGenerator<RowEntry> {
    let previous = 0n;
    for await (const row of segment.rows) {
      if (row.entry.label <= previous) {
        throw new JournalFormatError(
          `Rows copied in one stream must have ascending labels, but ${row.entry.label} follows ${previous}`,
        );
      }
      previous = row.entry.label;
      yield await this.foreign(row);
    }
    if (segment.nextLabel > this.nextLabel) this.nextLabel = segment.nextLabel;
  }

  private note(entry: RowEntry): RowEntry {
    const plain = entry.toolCallBlocks === 0 && entry.responseBlocks === 0;
    const result = plain
      ? ({
          ...entry,
          flags:
            (entry.flags & ~CONTRIBUTION_FLAGS) |
            ((entry.flags & ROW_FLAG.curated) === 0 ? 0 : ENTRY_FLAG.self),
          reconBlocks: 0,
          answered: 0,
          stamp: [
            { gen: 0, imageGen: 0 },
            { gen: 0, imageGen: 0 },
            { gen: 0, imageGen: 0 },
          ],
        } satisfies RowEntry)
      : entry;
    this.first ??= result;
    this.last = result;
    return result;
  }
}

/**
 * A rebuild (design 4.6): the new history streams once through the bulk
 * builders. The tree is built bottom-up from the entries, the id trie and the
 * versioned meta map start empty and take every row's facts in label order,
 * and the state map is carried forward unchanged. Compress, density, replace,
 * a purge that changes id tuples, an insert that is not a monotone add, and a
 * pop below a lineage start all come here.
 */
export async function buildRebuilt(
  ctx: BuildContext,
  plan: GroupPlan,
  segments: readonly Segment[],
  mutation: MutationCode,
  appender: RecordAppender,
): Promise<BuiltGroup> {
  const metaReader = mapReader(ctx, 'meta');
  const previousSlots = decodeMistralSlots(
    await metaReader.get(
      plan.bookkeepingMetaRoot ?? plan.base.roots.metaRoot,
      MISTRAL_SLOTS_KEY,
    ),
  );
  const mappingSlots =
    previousSlots |
    (plan.mistralSlot === undefined ? 0 : 1 << plan.mistralSlot);
  if (mappingSlots !== 0 && ctx.idDeps.mistralCandidate === undefined)
    throw new JournalFormatError('Mistral mapping candidate is not registered');
  const kimi =
    plan.kimi === true ||
    kimiEnabled(
      await metaReader.get(
        plan.bookkeepingMetaRoot ?? plan.base.roots.metaRoot,
        KIMI_ELIGIBLE_KEY,
      ),
    );
  const facts = await startFacts(
    ctx.access,
    NO_FACT_ROOTS,
    ctx,
    metaReader,
    {
      appender,
      readGroup: ctx.readGroup,
    },
    mappingSlots,
    kimi,
  );
  const chainBase = await ctx.chainFor(plan.parent);
  if (mappingSlots !== 0)
    facts.meta.set(MISTRAL_GENERATION_KEY, encodeDecimal(ctx.commitSeq));
  const pass = new RebuildPass(ctx, plan.nextLabel, segments, appender, facts);
  const algebra = ctx.algebra(slotKindsOf(plan.base.slots));
  let tree = await bulkBuildRowTree(appender, algebra, pass.entries());
  let roots = await commitRebuiltFacts(finishFacts(facts), appender);
  if (
    tree !== undefined &&
    (tree.root.aggregate.toolCallBlocks > 0 ||
      tree.root.aggregate.responseBlocks > 0)
  ) {
    tree = await rebuildContributions(
      ctx,
      appender,
      algebra,
      { offset: tree.root.childOffset, rows: tree.root.count },
      facts,
    );
    if (tree === undefined)
      throw new JournalFormatError('Contribution rebuild lost its rows');
    roots = await commitRebuiltFacts(finishFacts(facts), appender);
  }
  const stateRoot = await commitState(ctx, plan, appender);
  const { first, last } = pass;
  return {
    state: trailerState(ctx, plan, mutation, chainBase, {
      ...roots,
      stateRoot,
      nextLabel: pass.nextLabel,
      rowRoot: tree?.root.childOffset ?? 0,
      aggregate: tree?.root.aggregate ?? EMPTY_AGGREGATE,
      spine: tree?.spine,
      firstLabel: first?.label ?? 0n,
      lastRowOffset: last?.recordOffset ?? 0,
      lastOwner: last?.owner ?? 0,
    }),
    spine: tree?.spine,
    chainBase,
  };
}

async function commitRebuiltFacts(
  facts: GroupFacts,
  appender: RecordAppender,
): Promise<{ idRoot: number; metaRoot: number }> {
  const { root } = await facts.ids.commit(appender);
  return { idRoot: root, metaRoot: await facts.meta.commit(appender) };
}
