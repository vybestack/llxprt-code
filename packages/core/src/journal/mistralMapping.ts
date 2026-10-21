/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { bytesEqual, getU64, putU64, viewOf } from './bytes.js';
import { JournalFormatError } from './errors.js';
import type { RecordAppender } from './groupAppender.js';
import type { PlannedRow } from './groupEdits.js';
import type { GroupFacts } from './groupFacts.js';
import type { IdFactQueries } from './idFactQueries.js';
import { comparePositions } from './idFactUpdate.js';
import type { IdOccurrence } from './idFactUpdate.js';
import { ID_NS, fact0Key, type IdKeyHasher } from './idKeys.js';
import type { RecordAccess } from './recordAccess.js';
import { RECORD_KIND } from './recordKinds.js';
import { ROW_ID_KIND, ROW_SPEAKER } from './rowRecord.js';
import { FORMAT_SLOTS } from './slotTable.js';

export const MISTRAL_SLOTS_KEY = 'mistral:slots';
export const MISTRAL_GENERATION_KEY = 'mistral:conversion-generation-v1';
const UTF8 = new TextEncoder();
const DECODER = new TextDecoder('utf-8', { fatal: true });
const SLOT_BYTES = 17;
export interface MistralMapping {
  readonly id: string;
  readonly salt: number | null;
}
export type MistralCandidate = (rawId: string, salt: number) => string;

export function assertMistralSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= FORMAT_SLOTS)
    throw new JournalFormatError('Mistral mapping slot must be 0, 1 or 2');
}

export function decodeMistralSlots(bytes: Uint8Array | undefined): number {
  if (bytes === undefined) return 0;
  if (bytes.length !== 1 || bytes[0] === 0 || bytes[0] >= 1 << FORMAT_SLOTS)
    throw new JournalFormatError('Invalid Mistral mapping slot mask');
  return bytes[0];
}

function encodeMappings(
  mappings: ReadonlyArray<MistralMapping | undefined>,
): Uint8Array {
  const mask = mappings.reduce(
    (bits, mapping, slot) => bits | (mapping === undefined ? 0 : 1 << slot),
    0,
  );
  const bytes = new Uint8Array(
    1 + mappings.filter((mapping) => mapping !== undefined).length * SLOT_BYTES,
  );
  bytes[0] = mask;
  let at = 1;
  for (const mapping of mappings) {
    if (mapping === undefined) continue;
    bytes.set(UTF8.encode(mapping.id), at);
    putU64(
      viewOf(bytes),
      at + 9,
      'Mistral salt',
      mapping.salt === null ? 0 : mapping.salt + 1,
    );
    at += SLOT_BYTES;
  }
  return bytes;
}

function decodeMappings(
  bytes: Uint8Array,
): ReadonlyArray<MistralMapping | undefined> {
  const mask = decodeMistralSlots(bytes.slice(0, 1));
  const result: Array<MistralMapping | undefined> = [];
  let at = 1;
  for (let slot = 0; slot < FORMAT_SLOTS; slot++) {
    if ((mask & (1 << slot)) === 0) {
      result.push(undefined);
      continue;
    }
    if (at + SLOT_BYTES > bytes.length)
      throw new JournalFormatError('Truncated Mistral mapping value');
    const id = DECODER.decode(bytes.subarray(at, at + 9));
    if (!/^[a-zA-Z0-9]{9}$/.test(id))
      throw new JournalFormatError('Invalid Mistral mapped id');
    const salt = getU64(viewOf(bytes), at + 9, 'Mistral salt');
    result.push({ id, salt: salt === 0 ? null : salt - 1 });
    at += SLOT_BYTES;
  }
  if (at !== bytes.length)
    throw new JournalFormatError('Trailing Mistral mapping bytes');
  return result;
}

async function readMappings(
  access: RecordAccess,
  offset: number,
  rawId: string,
  hasher: IdKeyHasher,
): Promise<ReadonlyArray<MistralMapping | undefined>> {
  const head = await access.readRecordHead(offset, 'Mistral mapping', 128);
  if (
    head.kind !== RECORD_KIND.VALUE ||
    !bytesEqual(head.kindHeader, hasher(ID_NS.fact, fact0Key(rawId)))
  )
    throw new JournalFormatError('Mistral mapping belongs to another raw id');
  if (head.bodyLen > 1 + FORMAT_SLOTS * SLOT_BYTES)
    throw new JournalFormatError('Oversized Mistral mapping value');
  const chunks: Uint8Array[] = [];
  for await (const chunk of access.readRecordBody(
    head,
    undefined,
    'Mistral mapping',
  ))
    chunks.push(chunk);
  return decodeMappings(Buffer.concat(chunks));
}

export async function readMistralMapping(
  access: RecordAccess,
  facts: IdFactQueries,
  rawId: string,
  slot: number,
  hasher: IdKeyHasher,
): Promise<MistralMapping | undefined> {
  assertMistralSlot(slot);
  const fact = await facts.fact(rawId);
  return fact === undefined || fact.mappedRef === 0
    ? undefined
    : (await readMappings(access, fact.mappedRef, rawId, hasher))[slot];
}

async function assignMapping(
  facts: GroupFacts,
  rawId: string,
  appender: RecordAppender,
  readGroup: (end: number) => RecordAccess,
  hasher: IdKeyHasher,
  candidate: MistralCandidate,
): Promise<void> {
  const fact = await facts.ids.queries.fact(rawId);
  if (fact === undefined)
    throw new JournalFormatError('Mistral call has no raw id fact');
  if (fact.mappedRef !== 0) await appender.drain();
  const mappings =
    fact.mappedRef === 0
      ? []
      : await readMappings(
          readGroup(appender.nextOffset),
          fact.mappedRef,
          rawId,
          hasher,
        );
  const updated = [...mappings];
  let changed = false;
  for (let slot = 0; slot < FORMAT_SLOTS; slot++) {
    if (
      (facts.mistralSlots & (1 << slot)) === 0 ||
      mappings[slot] !== undefined
    )
      continue;
    const passthrough = /^[a-zA-Z0-9]{9}$/.test(rawId);
    let salt = 0;
    let id = passthrough ? rawId : candidate(rawId, salt);
    while (
      !passthrough &&
      (await facts.ids.queries.mistralUsedBy(slot, id)) !== undefined
    ) {
      salt++;
      if (!Number.isSafeInteger(salt + 1))
        throw new JournalFormatError('Mistral salt exhausted');
      id = candidate(rawId, salt);
    }
    updated[slot] = { id, salt: passthrough ? null : salt };
    facts.ids.markMistralUsed(slot, id, rawId);
    changed = true;
  }
  if (!changed) return;
  const body = encodeMappings(updated);
  const offset = await appender.append({
    kind: RECORD_KIND.VALUE,
    kindHeader: hasher(ID_NS.fact, fact0Key(rawId)),
    body: { length: body.length, chunks: [body] },
  });
  await appender.drain();
  await facts.ids.setMappedRef(rawId, offset);
}

async function isObservedCall(
  facts: GroupFacts,
  row: PlannedRow,
  occurrence: IdOccurrence,
): Promise<boolean> {
  if (occurrence.rawId === '') return false;
  if (occurrence.kind === ROW_ID_KIND.call) return true;
  const fact = await facts.ids.queries.fact(occurrence.rawId);
  const reconstructed =
    row.speaker === ROW_SPEAKER.tool &&
    fact?.firstToolResponse?.label === row.label;
  return (
    reconstructed &&
    (fact.firstCall === undefined ||
      comparePositions(fact.firstCall, { ...occurrence.at, block: 0 }) >= 0)
  );
}

export async function observeMistralRow(
  facts: GroupFacts,
  row: PlannedRow,
  occurrences: readonly IdOccurrence[],
  appender: RecordAppender,
  readGroup: (end: number) => RecordAccess,
  hasher: IdKeyHasher,
  candidate: MistralCandidate,
): Promise<void> {
  for (const occurrence of occurrences) {
    if (!(await isObservedCall(facts, row, occurrence))) continue;
    await assignMapping(
      facts,
      occurrence.rawId,
      appender,
      readGroup,
      hasher,
      candidate,
    );
  }
}
