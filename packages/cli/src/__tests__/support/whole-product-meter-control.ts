/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { generateHeapSnapshot } from 'bun';
import { createHash } from 'node:crypto';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { mixedText } from '../../../../agents/src/core/__tests__/support/journal-retained-growth-text.js';
import {
  evaluateRetainedGrowth,
  median,
} from '../../../../agents/src/core/__tests__/support/journal-retained-growth-predicate.js';
import {
  historyDataCensus,
  measurementMode,
} from './whole-product-measurement.js';

const kind = process.argv[2];
const retaining = process.argv[3] === 'retain';
const held: unknown[] = [];
const ids = new Map<string, number>();
const digest = createHash('sha256');
function allocate(turn: number, keep: boolean): void {
  const text = mixedText(turn, 65536);
  digest.update(text);
  if (kind === 'id-map') {
    for (let index = 0; index < 4096; index++) {
      const id = `history-${turn}-${index}-${createHash('sha256').update(`${turn}:${index}`).digest('hex')}`;
      if (keep) ids.set(id, index);
    }
    return;
  }
  const decoded: unknown = JSON.parse(
    JSON.stringify({ speaker: 'human', blocks: [{ type: 'text', text }] }),
  );
  let value: unknown;
  switch (kind) {
    case 'decoded-row':
      value = decoded;
      break;
    case 'cloned-text':
      value = Buffer.from(text).toString('utf8');
      break;
    case 'offheap-media':
      value = Buffer.from(text);
      break;
    case 'array':
      value = Array.from({ length: 8192 }, (_, index) => index + turn);
      break;
    default:
      throw new Error('Unknown meter control');
  }
  if (keep) held.push(value);
}
async function point(
  turn: number,
): Promise<{ turn: number; heapBytes: number }> {
  const readings = [];
  for (let index = 0; index < 9; index++) readings.push(await settledHeap());
  return { turn, heapBytes: median(readings) };
}
function census(): ReturnType<typeof historyDataCensus> {
  return historyDataCensus(generateHeapSnapshot());
}
const mode = measurementMode();
const measureCensus = process.argv[4] === 'census';
for (let turn = 0; turn < 20; turn++) allocate(turn, false);
const baseline = await point(0);
const censusBefore = measureCensus ? census() : undefined;
const checkpoints = [];
const dataCheckpoints = [];
for (let turn = 1; turn <= 50; turn++) {
  allocate(10000 + turn, retaining);
  if (turn % 10 === 0) {
    checkpoints.push(await point(turn));
    if (censusBefore !== undefined)
      dataCheckpoints.push({ turn, heapBytes: census().dataBytes });
  }
}
const censusAfter = censusBefore === undefined ? undefined : census();
const result = {
  kind,
  retaining,
  mode,
  inputHash: digest.digest('hex'),
  held: held.length,
  ids: ids.size,
  baseline,
  checkpoints,
  verdict: evaluateRetainedGrowth(baseline, checkpoints),
  dataVerdict:
    censusBefore === undefined
      ? undefined
      : evaluateRetainedGrowth(
          { turn: 0, heapBytes: censusBefore.dataBytes },
          dataCheckpoints,
        ),
  censusBefore,
  censusAfter,
};
process.stdout.write(`${JSON.stringify(result)}
`);
