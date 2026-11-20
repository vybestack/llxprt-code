/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { rollbackRow } from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';

export function borrowedRow(index: number, bytes = 2048): IContent {
  const row = rollbackRow(index, bytes);
  return {
    ...row,
    blocks: row.blocks.map((block) =>
      block.type === 'media'
        ? { ...block, filename: `audio-${index}.wav` }
        : block,
    ),
    metadata: {
      id: `row-${index}`,
      model: 'snapshot-model',
      providerBaseURL: 'https://provider.example/v1',
      chronology: {
        seq: index + 1,
        userTurn: 1,
        step: index + 1,
        recordedAt: 1,
      },
    },
  };
}

export function rowDigest(row: IContent): string {
  return createHash('sha256').update(JSON.stringify(row)).digest('hex');
}
