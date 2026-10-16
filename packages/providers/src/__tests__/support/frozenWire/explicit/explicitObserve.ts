/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import { createHash } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { MediaBinding } from '../../wireBodyCapture.js';
import { formatById } from '../frozenCases.js';
import { normalizedRows } from '../normalizedRows.js';
import type { Observation, UnitStreamObservation } from './explicitCase.js';
import {
  sendFresh,
  type ExplicitSend,
  type Observed,
  type ObservedBody,
} from './explicitSend.js';

/** JSON with object keys sorted at every level. */
export function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) {
      return inner;
    }
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(inner).sort()) {
      sorted[key] = Reflect.get(inner, key);
    }
    return sorted;
  });
}

export async function unitStreamOf(
  rows: readonly IContent[],
): Promise<UnitStreamObservation> {
  const units = await normalizedRows(rows);
  const json = sortedJson(units);
  return {
    units: units.length,
    sha256: createHash('sha256').update(json).digest('hex'),
    json,
  };
}

/**
 * The same send on each format with the rows as given (`raw`) and with the
 * rows core normalization hands a provider (`normalized`).
 */
export async function observeForms(
  formatIds: readonly string[],
  send: ExplicitSend,
  media?: MediaBinding,
): Promise<Observation> {
  const observation: Record<string, Observed[]> = {};
  const normalized = await normalizedRows(send.rows);
  for (const id of formatIds) {
    const format = formatById(id);
    observation[`${id}/raw`] = await sendFresh(format, send, media);
    observation[`${id}/normalized`] = await sendFresh(
      format,
      { ...send, rows: normalized },
      media,
    );
  }
  return observation;
}

/** The first body recorded under `label`; fails when the send threw. */
export function bodyOf(observation: Observation, label: string): ObservedBody {
  const entry = observation[label];
  if (!Array.isArray(entry)) throw new Error(`no sends recorded for ${label}`);
  const first: unknown = entry[0];
  if (typeof first !== 'object' || first === null || !('length' in first)) {
    throw new Error(`${label} did not produce a request body`);
  }
  return first as ObservedBody;
}
