/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { PlannedRow } from './groupEdits.js';
import type { IdFactBatch } from './idFactBatch.js';
import type { IdFactQueries } from './idFactQueries.js';
import { assertLength, getU64Big, putU32, putU64Big, viewOf } from './bytes.js';
import { ID_NS } from './idKeys.js';
import { ROW_FLAG, ROW_ID_KIND, ROW_SPEAKER } from './rowRecord.js';

export const DENSITY_CALL_INDEX_READY = 'history:density-call-index:1';
const utf8 = new TextEncoder();

export interface DensityCallPosition {
  readonly label: bigint;
  readonly block: number;
}

export function encodeDensityCallPosition(at: DensityCallPosition): Uint8Array {
  const bytes = new Uint8Array(12);
  const view = viewOf(bytes);
  putU64Big(view, 0, 'label', at.label);
  putU32(view, 8, 'block', at.block);
  return bytes;
}

export function decodeDensityCallPosition(
  bytes: Uint8Array,
): DensityCallPosition {
  assertLength(bytes, 12, 'Density call position');
  const view = viewOf(bytes);
  return { label: getU64Big(view, 0), block: view.getUint32(8, true) };
}

function key(id: string, response: boolean): Uint8Array {
  return utf8.encode(`${Number(response)}:${id}`);
}

export class DensityCallFacts {
  constructor(private readonly facts: IdFactQueries) {}

  async firstCall(id: string): Promise<DensityCallPosition | undefined> {
    const bytes = await this.facts.getEntry(ID_NS.densityCall, key(id, false));
    if (bytes === undefined) return undefined;
    return decodeDensityCallPosition(bytes);
  }

  async lastResponse(id: string): Promise<bigint | undefined> {
    const bytes = await this.facts.getEntry(ID_NS.densityCall, key(id, true));
    return bytes === undefined
      ? undefined
      : decodeDensityCallPosition(bytes).label;
  }
}

export async function applyDensityCallFacts(
  batch: IdFactBatch,
  row: PlannedRow,
): Promise<void> {
  if ((row.flags & ROW_FLAG.curated) === 0) return;
  const facts = new DensityCallFacts(batch.queries);
  for (const id of row.ids) {
    if (row.speaker === ROW_SPEAKER.ai && id.kind === ROW_ID_KIND.call) {
      const first = await facts.firstCall(id.rawId);
      if (
        first === undefined ||
        row.label < first.label ||
        (row.label === first.label && id.block < first.block)
      )
        await batch.setEntry(
          ID_NS.densityCall,
          key(id.rawId, false),
          encodeDensityCallPosition({ label: row.label, block: id.block }),
        );
    }
    if (row.speaker === ROW_SPEAKER.tool && id.kind === ROW_ID_KIND.response) {
      const last = await facts.lastResponse(id.rawId);
      if (last === undefined || row.label > last)
        await batch.setEntry(
          ID_NS.densityCall,
          key(id.rawId, true),
          encodeDensityCallPosition({ label: row.label, block: 0 }),
        );
    }
  }
}
