/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { HistoryMediaOwnership } from '../../storage/history-media-ownership.js';
import { batchRow, withBatchFixture } from './addbatch-stream-test-helpers.js';
import type { IContent, MediaReferenceBlock } from './IContent.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';

export type RemovalFixture = Parameters<
  Parameters<typeof withBatchFixture>[0]
>[0];

export async function withRemovalFixture(
  action: (fixture: RemovalFixture, store: LocalMediaStore) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(process.cwd(), 'tmp/history-removals-media-'));
  const store = new LocalMediaStore({ rootDirectory: root, quotaBytes: 1024 });
  try {
    await withBatchFixture(async (fixture) => {
      fixture.history.registerMediaOwner(new HistoryMediaOwnership(store));
      try {
        await action(fixture, store);
      } finally {
        fixture.releaseWriter();
        fixture.history.dispose();
        await fixture.history.waitForOwnershipSettlement();
        expect(fixture.owners.snapshot().liveRows).toBe(0);
        expect(fixture.owners.snapshot().liveSerializedBytes).toBe(0);
      }
    });
  } finally {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  }
}

export function removalRow(
  index: number,
  reference: MediaReferenceBlock,
): IContent {
  const row = batchRow(index, 256);
  return { ...row, blocks: [...row.blocks, reference, reference] };
}

export async function removalReferences(
  store: LocalMediaStore,
): Promise<readonly MediaReferenceBlock[]> {
  const references: MediaReferenceBlock[] = [];
  for (const byte of [1, 2])
    references.push(
      await store.admit({
        bytes: new Uint8Array([byte]),
        mimeType: 'application/octet-stream',
        semanticMetadata: {},
      }),
    );
  return references;
}

export async function assertRemovalRows(
  rows: AsyncIterable<IContent>,
  expected: readonly IContent[],
): Promise<void> {
  let index = 0;
  for await (const row of rows) {
    expect(row).toStrictEqual(expected[index]);
    expect(row.metadata?.chronology).toStrictEqual(
      expected[index].metadata?.chronology,
    );
    index++;
  }
  expect(index).toBe(expected.length);
}

export function recordRemovalOwners(
  phase: string,
  size: number,
  owners: RowOwnership,
): void {
  const output = process.env.REMOVAL_OWNER_OUTPUT;
  if (output !== undefined)
    appendFileSync(
      output,
      `${JSON.stringify({ phase, size, ...owners.snapshot() })}\n`,
    );
}
