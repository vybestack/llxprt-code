/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stageRequestArtifact } from '../../request-artifact.js';
import { median, settledHeap } from './settled-heap.js';

const SAMPLE_EVERY_ROWS = 4;
/** JSC can count a dead multi-megabyte string for one more round; retention shows in every round. */
const SETTLE_ROUNDS = 3;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

const directory = requiredEnv('REQUEST_ARTIFACT_MEMORY_ROOT');
const ROW_COUNT = Number(requiredEnv('REQUEST_ARTIFACT_MEMORY_ROWS'));
const ROW_CHARS = Number(requiredEnv('REQUEST_ARTIFACT_MEMORY_ROW_CHARS'));
const trap = process.env.REQUEST_ARTIFACT_MEMORY_TRAP;
const retainedRows: object[] = [];
const references: Array<WeakRef<object>> = [];
let measuring = false;
let baseline = 0;
let peakGrowth = 0;

async function growth(): Promise<number> {
  const readings: number[] = [];
  for (let round = 0; round < SETTLE_ROUNDS; round++)
    readings.push((await settledHeap()) - baseline);
  return median(readings);
}

function makeRow(index: number): object {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `${index}:`.padEnd(ROW_CHARS, 'z') }],
  };
}

/** Yields one row at a time; the row being yielded is the only one the producer holds. */
async function* rows(count: number): AsyncGenerator<object> {
  for (let index = 0; index < count; index++) {
    const row = makeRow(index);
    if (measuring) {
      references.push(new WeakRef(row));
      if (trap === 'rows') retainedRows.push(row);
      if (index % SAMPLE_EVERY_ROWS === 0)
        peakGrowth = Math.max(peakGrowth, await growth());
    }
    yield row;
  }
}

await mkdir(directory, { recursive: true });
// Warm the full-size path so one-time allocator and code-block growth is not counted.
for (let warm = 0; warm < 2; warm++)
  await stageRequestArtifact(directory, 'openai', rows(3), { warm });
baseline = await settledHeap();
measuring = true;
const descriptor = await stageRequestArtifact(
  directory,
  'openai',
  rows(ROW_COUNT),
  { measured: true },
);
peakGrowth = Math.max(peakGrowth, await growth());
measuring = false;
const settledGrowth = await growth();
await writeFile(
  join(directory, 'result.json'),
  JSON.stringify({
    peakGrowth,
    settledGrowth,
    liveRows: references.filter((reference) => reference.deref() !== undefined)
      .length,
    retainedRows: retainedRows.length,
    rowCount: descriptor.row_count,
    contentBytes: descriptor.content_bytes,
  }),
);
