/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { getU64, putU64, viewOf } from './bytes.js';
import { JournalFormatError } from './errors.js';
import type { IdFactBatch } from './idFactBatch.js';
import type { IdFactQueries } from './idFactQueries.js';
import type { MistralCandidate, MistralMapping } from './mistralMapping.js';

import { ID_NS } from './idKeys.js';

const MAPPING_NS = ID_NS.mistralScopeMapping;
const USED_NS = ID_NS.mistralScopeUsed;
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder('utf-8', { fatal: true });
const VERSION = 1;

export interface MistralScopeFill {
  readonly scope: string;
  readonly slot: number;
  readonly observe: () => AsyncIterable<string>;
  readonly convert: () => AsyncIterable<string>;
}

function key(scope: string, slot: number, id?: string): Uint8Array {
  return ENCODER.encode(JSON.stringify([VERSION, scope, slot, id]));
}

export async function requireMistralScope(
  facts: IdFactQueries,
  scope: string,
  slot: number,
): Promise<boolean> {
  const marker = await facts.getEntry(MAPPING_NS, key(scope, slot));
  if (marker === undefined) return false;
  if (marker.length !== 1 || marker[0] !== VERSION)
    throw new JournalFormatError('Invalid Mistral conversion scope version');
  return true;
}

export async function scopedMistralMapping(
  facts: IdFactQueries,
  scope: string,
  slot: number,
  rawId: string,
): Promise<MistralMapping | undefined> {
  const bytes = await facts.getEntry(MAPPING_NS, key(scope, slot, rawId));
  if (bytes === undefined) return undefined;
  if (bytes.length !== 18 || bytes[0] !== VERSION)
    throw new JournalFormatError('Invalid scoped Mistral mapping version');
  const id = DECODER.decode(bytes.subarray(1, 10));
  if (!/^[a-zA-Z0-9]{9}$/.test(id))
    throw new JournalFormatError('Invalid scoped Mistral id');
  const salt = getU64(viewOf(bytes), 10, 'Mistral scope salt');
  return { id, salt: salt === 0 ? null : salt - 1 };
}

async function assignScopedMapping(
  ids: IdFactBatch,
  scope: string,
  slot: number,
  rawId: string,
  candidate: MistralCandidate,
): Promise<void> {
  if (
    (await scopedMistralMapping(ids.queries, scope, slot, rawId)) !== undefined
  )
    return;
  const passthrough = /^[a-zA-Z0-9]{9}$/.test(rawId);
  let salt = 0;
  let id = passthrough ? rawId : candidate(rawId, salt);
  while (
    !passthrough &&
    (await ids.queries.getEntry(USED_NS, key(scope, slot, id))) !== undefined
  ) {
    salt++;
    if (!Number.isSafeInteger(salt + 1))
      throw new JournalFormatError('Mistral salt exhausted');
    id = candidate(rawId, salt);
  }
  const bytes = new Uint8Array(18);
  bytes[0] = VERSION;
  bytes.set(ENCODER.encode(id), 1);
  putU64(viewOf(bytes), 10, 'Mistral scope salt', passthrough ? 0 : salt + 1);
  await ids.setEntry(MAPPING_NS, key(scope, slot, rawId), bytes);
  await ids.setEntry(USED_NS, key(scope, slot, id), Uint8Array.of(VERSION));
}

export async function fillMistralScope(
  ids: IdFactBatch,
  fill: MistralScopeFill,
  candidate: MistralCandidate,
): Promise<void> {
  const { scope, slot } = fill;
  if (await requireMistralScope(ids.queries, scope, slot)) return;
  for (const phase of [fill.observe, fill.convert]) {
    for await (const rawId of phase())
      await assignScopedMapping(ids, scope, slot, rawId, candidate);
  }
  await ids.setEntry(MAPPING_NS, key(scope, slot), Uint8Array.of(VERSION));
}
