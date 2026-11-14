/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import { copyForeignRow } from './foreignRows.js';
import type { RecordAppender } from './groupAppender.js';
import type { BuildContext } from './groupBuildShared.js';
import type { SourceRow } from './groupEdits.js';
import { applyDraftRow, applyEntryRow, type GroupFacts } from './groupFacts.js';
import { IdFactBatch } from './idFactBatch.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { IdTrieReader } from './idTrieReader.js';
import { allocateAppendLabels } from './labels.js';
import { encodeRowDraft, entryForNewRow, type RowDraft } from './rowDraft.js';
import type { RowEntry } from './rowEntry.js';
import type { RecordAccess } from './recordAccess.js';
import { rootRef } from './groupSegments.js';
import { entryByLabel } from './rowTreeQueries.js';
import type { Version } from './version.js';
import { plannedFromIds, withUnitContributions } from './unitContributions.js';
import { writeNormalizedRowOccurrences } from './normalizedRowOccurrences.js';
import { readRowIds } from './rowReads.js';
import { ID_NS, fact0Key } from './idKeys.js';
import {
  decodeKimiCounts,
  decodeKimiOccurrence,
  KIMI_FIELD,
  kimiKey,
} from './kimiFactCodec.js';

export type AppendInput =
  | {
      readonly draft: RowDraft;
      readonly label?: bigint;
      readonly admitted?: RowEntry;
    }
  | { readonly foreign: SourceRow }
  | { readonly existing: SourceRow };

/** The raw tail is written once. Only entries, never content, survive a yielded row. */
export class StreamedAppendPass {
  first: RowEntry | undefined;
  last: RowEntry | undefined;
  private readonly affected: IdFactBatch;
  private hasAffected = false;

  constructor(
    private readonly ctx: BuildContext,
    private readonly facts: GroupFacts,
    private readonly appender: RecordAppender,
    private readonly inputs: AsyncIterable<AppendInput>,
    public nextLabel: bigint,
    private readonly baseLastLabel: bigint,
  ) {
    this.affected = new IdFactBatch(
      undefined,
      0,
      {
        ...ctx.idDeps,
        hasher: (_namespace, key) => key,
      },
      0,
      { appender, readGroup: ctx.readGroup },
    );
  }

  nextLabelAfter(adopted: bigint | undefined): bigint {
    return adopted !== undefined && adopted > this.nextLabel
      ? adopted
      : this.nextLabel;
  }

  private async affect(label: bigint): Promise<void> {
    if (label > this.baseLastLabel) return;
    this.hasAffected = true;
    const key = new Uint8Array(16);
    new DataView(key.buffer).setBigUint64(0, label, false);
    await this.affected.setEntry(0, key, new Uint8Array(0));
  }

  private async observe(ids: readonly string[]): Promise<void> {
    for (const id of new Set(ids)) {
      const before = await this.facts.ids.queries.fact(id);
      if (before?.firstCall !== undefined)
        await this.affect(before.firstCall.label);
      if (before?.firstToolResponse !== undefined)
        await this.affect(before.firstToolResponse.label);
      if (this.facts.kimi) await this.kimiHolders(id);
    }
  }

  private async kimiHolders(id: string): Promise<void> {
    const identity = this.ctx.idDeps.hasher(ID_NS.fact, fact0Key(id));
    const stored = await this.facts.ids.queries.getEntry(
      ID_NS.occurrence,
      kimiKey(KIMI_FIELD.counts, 0, identity),
    );
    if (stored === undefined) return;
    const counts = decodeKimiCounts(stored);
    if (counts.eligibleCount !== 0) return;
    for (const [field, count] of [
      [KIMI_FIELD.calls, counts.callCount],
      [KIMI_FIELD.responses, counts.aiResponses + counts.otherResponses],
    ]) {
      for (let ordinal = 1; ordinal <= count; ordinal++) {
        const bytes = await this.facts.ids.queries.getEntry(
          ID_NS.occurrence,
          kimiKey(field, ordinal, identity),
        );
        if (bytes === undefined)
          throw new JournalFormatError('Missing old Kimi fallback holder');
        await this.affect(decodeKimiOccurrence(bytes).position.label);
      }
    }
  }

  async *entries(): AsyncGenerator<RowEntry> {
    let previous = this.baseLastLabel;
    for await (const input of this.inputs) {
      let entry: RowEntry;
      if ('draft' in input) {
        const allocated = allocateAppendLabels(
          this.nextLabel,
          input.label === undefined ? 1 : 0,
        );
        const label = input.label ?? allocated.labels[0];
        this.nextLabel = allocated.nextLabel;
        const encoded = encodeRowDraft(label, input.draft);
        await this.observe(input.draft.ids.map((id) => id.rawId));
        await applyDraftRow(this.facts, this.ctx, label, input.draft);
        const offset =
          input.admitted?.recordOffset ??
          (await this.appender.append(encoded.record));
        entry = entryForNewRow(
          encoded,
          offset,
          input.admitted?.transcriptId ??
            this.appender.transcriptIdentity?.(offset),
        );
      } else {
        const row = 'foreign' in input ? input.foreign : input.existing;
        if (row.entry.label <= previous)
          throw new JournalFormatError(
            'Rows adopted at the end must have ascending labels above the live rows',
          );
        const ids = await readRowIds(row.source, row.entry);
        await this.observe(ids.rawIds);
        await applyEntryRow(row.source, this.facts, this.ctx, row.entry, ids);
        entry =
          'foreign' in input
            ? await copyForeignRow(this.appender, row, ids)
            : row.entry;
      }
      await this.facts.meta.spillWhenFull(this.appender, this.ctx.readGroup);
      previous = entry.label;
      this.first ??= entry;
      this.last = entry;
      yield entry;
    }
  }

  async *affectedEntries(base: Version): AsyncGenerator<RowEntry> {
    for await (const label of this.affectedLabels()) {
      if (this.ctx.access === undefined)
        throw new JournalFormatError('Affected append row has no base');
      const entry = await entryByLabel(this.ctx.access, rootRef(base), label);
      if (entry !== undefined) yield entry;
    }
  }

  async *contributions(
    access: RecordAccess,
    entries: AsyncIterable<RowEntry>,
  ): AsyncGenerator<RowEntry> {
    for await (const entry of entries) {
      const row = plannedFromIds(await readRowIds(access, entry));
      const updated = await withUnitContributions(
        entry,
        row,
        this.facts.ids.queries,
      );
      const counters = await writeNormalizedRowOccurrences(
        row,
        updated,
        this.facts.ids,
        this.ctx,
        { appender: this.appender, readGroup: this.ctx.readGroup },
        this.facts,
      );
      yield {
        ...updated,
        ...(this.facts.kimi ? counters : {}),
        stamp: [
          { gen: 0, imageGen: 0 },
          { gen: 0, imageGen: 0 },
          { gen: 0, imageGen: 0 },
        ],
      };
    }
  }

  private async *affectedLabels(): AsyncGenerator<bigint> {
    if (!this.hasAffected) return;
    const root = (await this.affected.commit(this.appender)).root;
    await this.appender.drain();
    const reader = new IdTrieReader(
      this.ctx.readGroup(this.appender.nextOffset),
      new BoundedIdNodeCache(),
    );
    for await (const entry of reader.entries(root))
      yield new DataView(
        entry.hash.buffer,
        entry.hash.byteOffset,
        entry.hash.byteLength,
      ).getBigUint64(0, false);
  }
}
