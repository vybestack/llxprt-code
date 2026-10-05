/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { expect } from 'bun:test';
import type { IContent } from './IContent.js';
import { batchRow } from './addbatch-stream-test-helpers.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';

export function exportSummaryRow(index: number, bytes = 2048): IContent {
  const row = batchRow(index, bytes);
  return {
    ...row,
    blocks: [
      ...row.blocks,
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: 'aGVsbG8=',
        caption: `image-${index}`,
      },
      { type: 'text', text: `"\\\n雪${index}` },
    ],
    metadata: {
      ...row.metadata,
      cacheAnchor: index % 7 === 0,
      turnId: `turn-${index}`,
    },
  };
}

export function summaryRow(): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'summary of earlier turns' }],
    metadata: { isSummary: true },
  };
}

export function oracleExport(size: number): string {
  return JSON.stringify(
    Array.from({ length: size }, (_, index) => exportSummaryRow(index)),
    null,
    2,
  );
}

export async function seedRows(
  recorder: {
    commit(type: 'content', payload: { content: IContent }): Promise<unknown>;
  },
  size: number,
): Promise<void> {
  for (let index = 0; index < size; index++)
    await recorder.commit('content', { content: exportSummaryRow(index) });
}

export function recordExportSummaryOwners(
  phase: string,
  size: number,
  owners: RowOwnership,
): void {
  const output = process.env.EXPORT_SUMMARY_OWNER_OUTPUT;
  if (output !== undefined)
    appendFileSync(
      output,
      `${JSON.stringify({ phase, size, ...owners.snapshot() })}\n`,
    );
}

export function assertOwnerBound(owners: RowOwnership): void {
  expect(owners.snapshot().liveRows).toBe(0);
  expect(owners.within({ rows: 80, serializedBytes: 1024 * 1024 })).toBe(true);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
