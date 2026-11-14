/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IdFactBatch } from './idFactBatch.js';
import type { UnitPosition } from './idEntryCodecs.js';
import type { VersionSnapshot } from './versionSnapshot.js';
import { JournalFormatError } from './errors.js';
import { ID_NS } from './idKeys.js';
import { getU64Big, putU64Big, viewOf } from './bytes.js';

const encoder = new TextEncoder();
export interface MistralClaim {
  readonly rawId: string;
  readonly position: UnitPosition;
  readonly block: number;
}
function key(kind: string, slot: number, id: string): Uint8Array {
  return encoder.encode(JSON.stringify(['native-claim-v1', kind, slot, id]));
}
export function compareMistralClaims(
  left: MistralClaim,
  right: MistralClaim,
): number {
  const a = left.position;
  const b = right.position;
  if (a.label !== b.label) return a.label < b.label ? -1 : 1;
  if (a.part !== b.part) return a.part - b.part;
  if (a.unit !== b.unit) return a.unit - b.unit;
  return left.block - right.block;
}
export async function readMistralClaim(
  snapshot: VersionSnapshot,
  kind: 'raw' | 'hashed',
  slot: number,
  id: string,
): Promise<MistralClaim | undefined> {
  const bytes = await snapshot.facts.getEntry(
    ID_NS.mistralScopeUsed,
    key(kind, slot, id),
  );
  if (bytes === undefined) return undefined;
  if (bytes.length !== 15)
    throw new JournalFormatError('Invalid Mistral claim');
  const view = viewOf(bytes);
  const label = getU64Big(view, 0);
  let rawId = id;
  if (kind === 'hashed') {
    const entry = await snapshot.entryByLabel(label);
    if (entry === undefined)
      throw new JournalFormatError('Mistral owner source is absent');
    const ids = await snapshot.readIds(entry);
    const raw = ids.rawIds.find(
      (_raw, index) => index === view.getUint16(13, true),
    );
    if (raw === undefined)
      throw new JournalFormatError('Mistral owner id is absent');
    rawId = raw;
  }
  return {
    rawId,
    position: { label, part: bytes[8], unit: view.getUint16(9, true) },
    block: view.getUint16(11, true),
  };
}
export async function writeMistralClaim(
  ids: IdFactBatch,
  slot: number,
  id: string,
  claim: MistralClaim,
  rawIndex: number,
): Promise<void> {
  if (claim.rawId === '' || rawIndex < 0 || rawIndex > 65535)
    throw new JournalFormatError('Invalid observe claim source');
  if (
    (await ids.queries.getEntry(
      ID_NS.mistralScopeUsed,
      key('raw', slot, claim.rawId),
    )) !== undefined
  )
    return;
  const bytes = new Uint8Array(15);
  const view = viewOf(bytes);
  putU64Big(view, 0, 'Mistral claim label', claim.position.label);
  bytes[8] = claim.position.part;
  view.setUint16(9, claim.position.unit, true);
  view.setUint16(11, claim.block, true);
  view.setUint16(13, rawIndex, true);
  await ids.setEntry(
    ID_NS.mistralScopeUsed,
    key('raw', slot, claim.rawId),
    bytes,
  );
  if (!/^[a-zA-Z0-9]{9}$/.test(claim.rawId))
    await ids.setEntry(ID_NS.mistralScopeUsed, key('hashed', slot, id), bytes);
}
