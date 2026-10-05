/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import { isSpeakerContent } from '@vybestack/llxprt-code-core/services/history/historyJournalGuards.js';

export const publicDefaultBounds = {
  rows: 440,
  serializedBytes: 8 * 1024 * 1024,
};

export function isHistoryStream(
  value: unknown,
): value is AsyncGenerator<IContent, void, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  return Symbol.asyncIterator in value && 'next' in value && 'return' in value;
}

function releasePublicArray(value: unknown, external: RowOwnership): void {
  if (!Array.isArray(value)) return;
  for (const row of value) if (isSpeakerContent(row)) external.release(row);
}

function recordDefaultOwner(
  size: number,
  phase: string,
  external: RowOwnership,
): void {
  const output = process.env.PUBLIC_DEFAULT_OUTPUT;
  if (output !== undefined)
    appendFileSync(
      output,
      JSON.stringify({ size, phase, ...external.snapshot() }) + '\n',
    );
}

async function drainDefaultHistory(
  source: AsyncIterable<IContent>,
  external: RowOwnership,
  retained: IContent[],
  bytes: number,
): Promise<{ count: number; digest: string; expected: string }> {
  const actual = createHash('sha256');
  const expected = createHash('sha256');
  const trap = process.env.PUBLIC_DEFAULT_RETAINING_TRAP;
  let count = 0;
  for await (const row of source) {
    const owned = trap === 'copy' ? structuredClone(row) : row;
    external.retain(owned);
    if (trap !== undefined) retained.push(owned);
    try {
      actual.update(JSON.stringify(row));
      expected.update(JSON.stringify(accountingRow(count++, bytes)));
    } finally {
      if (trap === undefined) external.release(owned);
    }
  }
  return {
    count,
    digest: actual.digest('hex'),
    expected: expected.digest('hex'),
  };
}

export async function assertDefaultHistory(
  value: unknown,
  size: number,
  reader: RowOwnership,
  bytes = 2048,
): Promise<void> {
  const external = new RowOwnership();
  const retained: IContent[] = [];
  if (Array.isArray(value)) {
    for (const row of value) {
      if (!isSpeakerContent(row)) throw new Error('Invalid public history row');
      external.retain(row);
    }
  }
  try {
    recordDefaultOwner(size, 'returned', external);
    expect(external.snapshot().peakRows).toBeLessThanOrEqual(
      publicDefaultBounds.rows,
    );
    expect(external.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
      publicDefaultBounds.serializedBytes,
    );
    if (!isHistoryStream(value))
      throw new Error('Public default history must be a cold stream');
    const result = await drainDefaultHistory(value, external, retained, bytes);
    recordDefaultOwner(size, 'consumed', external);
    expect({ count: result.count, digest: result.digest }).toStrictEqual({
      count: size,
      digest: result.expected,
    });
    expect(external.snapshot().peakRows).toBe(1);
    expect(reader.snapshot().liveRows).toBe(0);
    expect(external.snapshot().liveRows).toBe(0);
    if (bytes === 2048) expect(external.within(publicDefaultBounds)).toBe(true);
  } finally {
    releasePublicArray(value, external);
    for (const row of retained) external.release(row);
    if (isHistoryStream(value)) await value.return();
  }
}
