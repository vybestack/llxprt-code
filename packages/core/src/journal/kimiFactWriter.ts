/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { bytesEqual } from './bytes.js';
import { JournalFormatError } from './errors.js';
import type { GroupFacts } from './groupFacts.js';
import type { IdFactBatch } from './idFactBatch.js';
import { decodeCountValue, encodeCountValue } from './idEntryCodecs.js';
import { ID_NS } from './idKeys.js';
import {
  decodeKimiCounts,
  decodeKimiOccurrence,
  EMPTY_KIMI_COUNTS,
  encodeKimiCounts,
  encodeKimiOccurrence,
  KIMI_AI_KEY,
  KIMI_FIELD,
  KIMI_FLAG,
  kimiKey,
  type KimiCounts,
  type KimiOccurrence,
} from './kimiFactCodec.js';

export interface KimiRowId {
  readonly identity: Uint8Array;
  readonly calls: readonly KimiOccurrence[];
  readonly responses: readonly KimiOccurrence[];
}

function countsOf(
  calls: readonly KimiOccurrence[],
  responses: readonly KimiOccurrence[],
): KimiCounts {
  const eligibleCount = calls.filter(
    (call) => (call.flags & KIMI_FLAG.eligible) !== 0,
  ).length;
  const aiCalls = calls.filter(
    (call) => (call.flags & KIMI_FLAG.ai) !== 0,
  ).length;
  const aiResponses = responses.filter(
    (response) => (response.flags & KIMI_FLAG.ai) !== 0,
  ).length;
  return {
    callCount: calls.length,
    eligibleCount,
    aiCalls,
    aiResponses,
    otherResponses: responses.length - aiResponses,
  };
}

class KimiListWriter {
  constructor(
    private readonly ids: IdFactBatch,
    private readonly identity: Uint8Array,
  ) {}

  key(field: number, ordinal = 0): Uint8Array {
    return kimiKey(field, ordinal, this.identity);
  }

  async read(field: number, ordinal: number): Promise<KimiOccurrence> {
    const value = await this.ids.queries.getEntry(
      ID_NS.occurrence,
      this.key(field, ordinal),
    );
    if (value === undefined)
      throw new JournalFormatError('Missing emitted Kimi occurrence');
    return decodeKimiOccurrence(value);
  }

  private async boundary(
    field: number,
    count: number,
    label: bigint,
    inclusive: boolean,
  ): Promise<number> {
    let low = 1;
    let high = count + 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const at = (await this.read(field, middle)).position.label;
      if (at < label || (inclusive && at === label)) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  async replace(
    field: number,
    count: number,
    label: bigint,
    positions: readonly KimiOccurrence[],
  ): Promise<readonly KimiOccurrence[]> {
    const first = await this.boundary(field, count, label, false);
    const end = await this.boundary(field, count, label, true);
    const removed: KimiOccurrence[] = [];
    for (let index = first; index < end; index++)
      removed.push(await this.read(field, index));
    const shift = positions.length - (end - first);
    const move = async (ordinal: number): Promise<void> => {
      await this.ids.setEntry(
        ID_NS.occurrence,
        this.key(field, ordinal + shift),
        encodeKimiOccurrence(await this.read(field, ordinal)),
      );
    };
    if (shift > 0)
      for (let ordinal = count; ordinal >= end; ordinal--) await move(ordinal);
    if (shift < 0)
      for (let ordinal = end; ordinal <= count; ordinal++) await move(ordinal);
    for (const [index, at] of positions.entries()) {
      const bytes = encodeKimiOccurrence(at);
      const existing = await this.ids.queries.getEntry(
        ID_NS.occurrence,
        this.key(field, first + index),
      );
      if (existing === undefined || !bytesEqual(existing, bytes))
        await this.ids.setEntry(
          ID_NS.occurrence,
          this.key(field, first + index),
          bytes,
        );
    }
    return removed;
  }

  async last(count: number): Promise<Uint8Array> {
    for (let ordinal = count; ordinal > 0; ordinal--) {
      const occurrence = await this.read(KIMI_FIELD.calls, ordinal);
      if ((occurrence.flags & KIMI_FLAG.eligible) !== 0)
        return encodeKimiOccurrence(occurrence);
    }
    return new Uint8Array(0);
  }
}

export async function replaceKimiRow(
  facts: GroupFacts,
  label: bigint,
  id: KimiRowId,
): Promise<void> {
  const { ids } = facts;
  const writer = new KimiListWriter(ids, id.identity);
  const value = await ids.queries.getEntry(
    ID_NS.occurrence,
    writer.key(KIMI_FIELD.counts),
  );
  const before =
    value === undefined ? EMPTY_KIMI_COUNTS : decodeKimiCounts(value);
  const removedCalls = await writer.replace(
    KIMI_FIELD.calls,
    before.callCount,
    label,
    id.calls,
  );
  const removedResponses = await writer.replace(
    KIMI_FIELD.responses,
    before.aiResponses + before.otherResponses,
    label,
    id.responses,
  );
  const removed = countsOf(removedCalls, removedResponses);
  const added = countsOf(id.calls, id.responses);
  const after: KimiCounts = {
    callCount: before.callCount - removed.callCount + added.callCount,
    eligibleCount:
      before.eligibleCount - removed.eligibleCount + added.eligibleCount,
    aiCalls: before.aiCalls - removed.aiCalls + added.aiCalls,
    aiResponses: before.aiResponses - removed.aiResponses + added.aiResponses,
    otherResponses:
      before.otherResponses - removed.otherResponses + added.otherResponses,
  };
  await ids.setEntry(
    ID_NS.occurrence,
    writer.key(KIMI_FIELD.counts),
    encodeKimiCounts(after),
  );
  await ids.setEntry(
    ID_NS.occurrence,
    writer.key(KIMI_FIELD.last),
    await writer.last(after.callCount),
  );
  const clean =
    after.callCount === 1 && after.eligibleCount === 1 && after.aiCalls === 1;
  if (
    after.callCount > 0 &&
    !clean &&
    (await ids.queries.getEntry(
      ID_NS.occurrence,
      writer.key(KIMI_FIELD.exception),
    )) === undefined
  ) {
    ids.appendKimiException(id.identity);
    await ids.setEntry(
      ID_NS.occurrence,
      writer.key(KIMI_FIELD.exception),
      Uint8Array.of(1),
    );
  }
  const ai = await facts.meta.get(KIMI_AI_KEY);
  const total = ai === undefined ? 0 : decodeCountValue(ai);
  facts.meta.set(
    KIMI_AI_KEY,
    encodeCountValue(total - removed.aiCalls + added.aiCalls),
  );
}
