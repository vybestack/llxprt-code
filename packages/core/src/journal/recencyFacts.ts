/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { assertLength, putU32, viewOf } from './bytes.js';
import { JournalFormatError } from './errors.js';
import type { IdFactBatch } from './idFactBatch.js';
import type { IdFactQueries } from './idFactQueries.js';
import { ID_NS } from './idKeys.js';
import type { RecordAccess } from './recordAccess.js';
import type { RowDraft } from './rowDraft.js';
import type { RowEntry } from './rowEntry.js';
import type { RowIds } from './rowReads.js';
import { readStoredBlock } from './rowRangeReads.js';
import { ROW_BLOCK_TYPE, ROW_SPEAKER } from './rowRecord.js';

export const RECENCY_INDEX_READY = 'history:recency-index';
const utf8 = new TextEncoder();

export interface RecencyFactPolicy {
  readonly revision: string;
  readonly bucket: (bytes: Uint8Array) => string | undefined;
}

function key(revision: string, parts: readonly string[]): Uint8Array {
  return utf8.encode(JSON.stringify([revision, ...parts]));
}
function scalar(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  putU32(viewOf(bytes), 0, 'recency count', value);
  return bytes;
}

export class RecencyFacts {
  constructor(
    private readonly facts: IdFactQueries,
    readonly revision: string,
  ) {}

  private async value(parts: readonly string[]): Promise<number | undefined> {
    const bytes = await this.facts.getEntry(
      ID_NS.recency,
      key(this.revision, parts),
    );
    if (bytes === undefined) return undefined;
    assertLength(bytes, 4, 'Recency count');
    return viewOf(bytes).getUint32(0, true);
  }
  async maximum(): Promise<number> {
    return (await this.value(['maximum'])) ?? 0;
  }
  async count(bucket: string): Promise<number> {
    return (await this.value(['count', bucket])) ?? 0;
  }
  async ordinal(label: bigint, block: number): Promise<number> {
    const value = await this.value(['ordinal', String(label), String(block)]);
    if (value === undefined)
      throw new JournalFormatError('Missing eligible recency occurrence');
    return value;
  }
}

async function observe(
  batch: IdFactBatch,
  policy: RecencyFactPolicy,
  label: bigint,
  block: number,
  bytes: Uint8Array,
): Promise<void> {
  const bucket = policy.bucket(bytes);
  if (bucket === undefined) return;
  const facts = new RecencyFacts(batch.queries, policy.revision);
  const count = (await facts.count(bucket)) + 1;
  await batch.setEntry(
    ID_NS.recency,
    key(policy.revision, ['count', bucket]),
    scalar(count),
  );
  await batch.setEntry(
    ID_NS.recency,
    key(policy.revision, ['ordinal', String(label), String(block)]),
    scalar(count),
  );
  if (count > (await facts.maximum()))
    await batch.setEntry(
      ID_NS.recency,
      key(policy.revision, ['maximum']),
      scalar(count),
    );
}

export async function applyDraftRecency(
  batch: IdFactBatch,
  policy: RecencyFactPolicy | undefined,
  label: bigint,
  draft: RowDraft,
): Promise<void> {
  if (policy === undefined || draft.speaker !== ROW_SPEAKER.tool) return;
  for (let block = 0; block < draft.blocks.length; block++) {
    const value = draft.blocks[block];
    if (value.type === ROW_BLOCK_TYPE.tool_response)
      await observe(batch, policy, label, block, value.bytes);
  }
}

export async function applyStoredRecency(
  access: RecordAccess,
  batch: IdFactBatch,
  policy: RecencyFactPolicy | undefined,
  entry: RowEntry,
  row: RowIds,
): Promise<void> {
  if (policy === undefined || row.header.speaker !== ROW_SPEAKER.tool) return;
  for (let block = 0; block < row.header.blocks.length; block++) {
    if (row.header.blocks[block].type === ROW_BLOCK_TYPE.tool_response)
      await observe(
        batch,
        policy,
        entry.label,
        block,
        await readStoredBlock(access, entry, block),
      );
  }
}
