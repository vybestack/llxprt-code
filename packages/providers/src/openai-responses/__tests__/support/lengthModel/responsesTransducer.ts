/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the OpenAI Responses `input` array as a finite-state
 * transducer over the unit stream.
 *
 * Boundary state (2 states): `E` nothing has been written yet, `W` an item was
 * written and a comma is due. The one position-dependent quantity that is not
 * a state is the generated reasoning id `rs_<time>_<n>`. It is additive (`r`
 * is the number of items that receive one), and its digit cost over the whole
 * stream is the closed form `sumDigits(r)`, independent of how the stream was
 * split, so it needs no counter in the state.
 *
 * A node summary is a total function from the 2 incoming states. Composition
 * is function composition; the additive fields add. Test-side code.
 */

import {
  sumDigits,
  utf8Bytes,
} from '../../../../__tests__/support/lengthModel/bytes.js';
import type { PairPolicy } from './normalizedIdIndex.js';
import type { ResponsesUnit } from './responsesUnitFacts.js';

/** Incoming states: 0 = E, 1 = W. */
export interface ResponsesSummary {
  readonly out: readonly [number, number];
  readonly bytes: readonly [number, number];
  readonly items: readonly [number, number];
  /** Items that receive a generated `rs_` id. */
  readonly generatedIds: number;
  /** Bytes of the `input_file` parts written, for the PDF aggregate limit. */
  readonly pdfBytes: number;
}

export const RESPONSES_IDENTITY: ResponsesSummary = {
  out: [0, 1],
  bytes: [0, 0],
  items: [0, 0],
  generatedIds: 0,
  pdfBytes: 0,
};

export function composeResponses(
  left: ResponsesSummary,
  right: ResponsesSummary,
): ResponsesSummary {
  const [a0, a1] = left.out;
  return {
    out: [right.out[a0], right.out[a1]],
    bytes: [left.bytes[0] + right.bytes[a0], left.bytes[1] + right.bytes[a1]],
    items: [left.items[0] + right.items[a0], left.items[1] + right.items[a1]],
    generatedIds: left.generatedIds + right.generatedIds,
    pdfBytes: left.pdfBytes + right.pdfBytes,
  };
}

export function sameResponsesSummary(
  left: ResponsesSummary,
  right: ResponsesSummary,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface Written {
  count: number;
  bytes: number;
  generatedIds: number;
  pdfBytes: number;
}

/** An unpaired call is not written; an output needs a call unless a parent is sent. */
function isWritten(
  item: ResponsesUnit['items'][number],
  serverSideParent: boolean,
  pairs: PairPolicy,
): boolean {
  const ids = [item.normalizedId ?? '', item.rawId ?? ''] as const;
  if (item.kind === 'call') return pairs.hasResponse(...ids);
  if (item.kind === 'output') return serverSideParent || pairs.hasCall(...ids);
  return true;
}

function writtenItems(
  unit: ResponsesUnit,
  serverSideParent: boolean,
  pairs: PairPolicy,
): Written {
  const written: Written = { count: 0, bytes: 0, generatedIds: 0, pdfBytes: 0 };
  const add = (item: { bytes: number; pdfBytes: number }): void => {
    written.count += 1;
    written.bytes += item.bytes;
    written.pdfBytes += item.pdfBytes;
  };
  let wroteOutput = false;
  for (const item of unit.items) {
    if (!isWritten(item, serverSideParent, pairs)) continue;
    if (item.kind === 'output') wroteOutput = true;
    if (
      item.kind === 'reasoning' &&
      item.genuineId !== true &&
      !serverSideParent
    ) {
      written.generatedIds += 1;
    }
    add(item);
  }
  if (unit.speaker === 'tool' && wroteOutput && unit.media !== undefined) {
    add(unit.media);
  }
  return written;
}

/**
 * The summary of one unit. `serverSideParent` is whether a previous response
 * id is sent (then an output needs no local call, and reasoning ids are the
 * server's); `pairs` answers the two membership tests for this unit's ids.
 */
export function responsesLeaf(
  unit: ResponsesUnit,
  serverSideParent: boolean,
  pairs: PairPolicy,
): ResponsesSummary {
  const { count, bytes, generatedIds, pdfBytes } = writtenItems(
    unit,
    serverSideParent,
    pairs,
  );
  const empty = count === 0;
  return {
    out: [empty ? 0 : 1, 1],
    bytes: [empty ? 0 : bytes + (count - 1), bytes + count],
    items: [count, count],
    generatedIds,
    pdfBytes,
  };
}

/**
 * Bytes of the `input` array from its root summary: the brackets, and the
 * generated reasoning ids `,"id":"rs_<time>_<n>"`, one per counted item, with
 * `n` counting from zero.
 */
export function responsesTotalBytes(
  root: ResponsesSummary,
  reasoningIdTime: number,
): number {
  const fixed =
    utf8Bytes(',"id":"rs_') +
    utf8Bytes(String(reasoningIdTime)) +
    utf8Bytes('_"');
  return (
    root.bytes[0] + 2 + root.generatedIds * fixed + sumDigits(root.generatedIds)
  );
}
