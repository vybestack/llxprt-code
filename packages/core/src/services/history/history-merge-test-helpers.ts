import { forbidHistoryMaterializationForTest } from '../../test-utils/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { HistoryService } from './HistoryService.js';
import type { IContent, ChronologyMarker } from './IContent.js';
import { rollbackRow } from './chronology-rollback-test-helpers.js';

export class MergeRowHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'merge materialization forbidden',
    );
  }
}

export function mergeRow(
  index: number,
  bytes = 2048,
  marker?: ChronologyMarker,
): IContent {
  return {
    ...rollbackRow(index, bytes),
    metadata: {
      timestamp: 1700000000000 + index,
      model: 'historical-model',
      chronology: marker ?? {
        seq: index + 1,
        userTurn: Math.floor(index / 3) + 1,
        step: index % 3,
        recordedAt: 1700000000000 + index,
      },
    },
  };
}

export async function streamDigest(
  rows: AsyncIterable<IContent>,
): Promise<string> {
  const hash = createHash('sha256');
  for await (const row of rows) hash.update(JSON.stringify(row) + '\n');
  return hash.digest('hex');
}

export function oracleDigest(size: number, copies = 1, prefix = false): string {
  const hash = createHash('sha256');
  if (prefix) hash.update(JSON.stringify(mergeRow(20000)) + '\n');
  for (let copy = 0; copy < copies; copy++)
    for (let index = 0; index < size; index++)
      hash.update(JSON.stringify(mergeRow(index)) + '\n');
  return hash.digest('hex');
}
