/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep } from 'bun:jsc';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ChronologyStamper } from '../../packages/core/src/services/history/historyChronology.js';
import type {
  ChronologyMarker,
  IContent,
} from '../../packages/core/src/services/history/IContent.js';
import {
  rejectedValue,
  rollbackRow,
  withRollbackFixture,
} from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';

const markerSchema = z.object({
  seq: z.number(),
  userTurn: z.number(),
  step: z.number(),
  recordedAt: z.number(),
});
const count = Number(process.argv[2]);
const mode = process.argv[3];
const pin = readFileSync(
  new URL('../../.bun-version', import.meta.url),
  'utf8',
).trim();
if (Bun.version !== pin)
  throw new Error(`Expected Bun ${pin}; got ${Bun.version}`);
if (!Number.isSafeInteger(count) || count < 1)
  throw new Error('Expected positive count');
if (mode !== 'actual' && mode !== 'disk-weak' && mode !== 'disk-strong')
  throw new Error('Expected identity mode');
const identities = new WeakSet<ChronologyMarker>();
const witnesses: Array<WeakRef<ChronologyMarker>> = [];

async function collect(): Promise<void> {
  for (let index = 0; index < 4; index++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    gcAndSweep();
  }
}

function alive(): number {
  let total = 0;
  for (const witness of witnesses) if (witness.deref() !== undefined) total++;
  return total;
}

function makeRows(): IContent[] {
  return Array.from({ length: count }, (_unused, index) => {
    const marker = {
      seq: index + 1,
      userTurn: index + 1,
      step: 1,
      recordedAt: 0,
    };
    identities.add(marker);
    witnesses.push(new WeakRef(marker));
    return { ...rollbackRow(index), metadata: { chronology: marker } };
  });
}

function replacedMarker(index: number): ChronologyMarker {
  return {
    seq: count + index + 1,
    userTurn: count + index + 1,
    step: 2,
    recordedAt: 0,
  };
}

function recognized(rows: readonly IContent[]): number {
  let total = 0;
  for (const row of rows) {
    const marker = row.metadata?.chronology;
    if (marker !== undefined && identities.has(marker)) total++;
  }
  return total;
}

interface IdentityObservation {
  readonly aliveWhileDisplaced: number;
  readonly restoredIdentities: number;
  readonly restoredValues: number;
}

async function actual(): Promise<IdentityObservation> {
  return withRollbackFixture(async (history) => {
    const rows = makeRows();
    const primary = new Error('identity publication failure');
    let aliveWhileDisplaced = -1;
    const error = await rejectedValue(
      history.replaceBatch(rows, undefined, {
        afterPublication: async () => {
          for (const [index, row] of rows.entries()) {
            if (row.metadata === undefined)
              throw new Error('Missing stamped metadata');
            row.metadata.chronology = replacedMarker(index);
          }
          await collect();
          aliveWhileDisplaced = alive();
          throw primary;
        },
      }),
    );
    if (error !== primary) throw new Error('Changed primary failure');
    await history.waitForCommit();
    const observation = {
      aliveWhileDisplaced,
      restoredIdentities: recognized(rows),
      restoredValues: restoredValues(rows),
    };
    rows.length = 0;
    return observation;
  });
}

function storeDescriptors(rows: readonly IContent[], directory: string): void {
  for (const [index, row] of rows.entries()) {
    const descriptor = openSync(join(directory, String(index)), 'wx');
    try {
      writeSync(descriptor, JSON.stringify(row.metadata?.chronology));
    } finally {
      closeSync(descriptor);
    }
  }
}

function restoreDescriptors(
  rows: readonly IContent[],
  directory: string,
): void {
  for (const [index, row] of rows.entries()) {
    const descriptor = markerSchema.parse(
      JSON.parse(readFileSync(join(directory, String(index)), 'utf8')),
    );
    if (row.metadata === undefined)
      throw new Error('Missing inherited metadata');
    row.metadata.chronology = witnesses[index].deref() ?? descriptor;
  }
}

function restoredValues(rows: readonly IContent[]): number {
  let total = 0;
  for (const [index, row] of rows.entries()) {
    const marker = row.metadata?.chronology;
    if (
      marker?.seq === index + 1 &&
      marker.userTurn === index + 1 &&
      marker.step === 1 &&
      marker.recordedAt === 0
    )
      total++;
  }
  return total;
}

function originalMarker(row: IContent): ChronologyMarker {
  const marker = row.metadata?.chronology;
  if (marker === undefined) throw new Error('Missing original marker');
  return marker;
}

async function disk(strong: boolean): Promise<IdentityObservation> {
  const directory = mkdtempSync(
    join(import.meta.dir, '../../tmp/chronology-identity-disk-'),
  );
  try {
    const rows = makeRows();
    const retained: ChronologyMarker[] = strong ? rows.map(originalMarker) : [];
    storeDescriptors(rows, directory);
    const stamper = new ChronologyStamper(() => 0);
    for (const [index, row] of rows.entries())
      stamper.inherit(row, replacedMarker(index));
    await collect();
    const aliveWhileDisplaced = alive();
    restoreDescriptors(rows, directory);
    const restoredIdentities = recognized(rows);
    if (strong && retained.length !== rows.length)
      throw new Error('Lost strong control');
    const observation = {
      aliveWhileDisplaced,
      restoredIdentities,
      restoredValues: restoredValues(rows),
    };
    retained.length = 0;
    rows.length = 0;
    return observation;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function report(result: IdentityObservation): Promise<void> {
  await collect();
  process.stdout.write(
    JSON.stringify({ mode, count, ...result, aliveAfterSettlement: alive() }) +
      '\n',
  );
}

function reportFailure(error: unknown): void {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
}

void (mode === 'actual' ? actual() : disk(mode === 'disk-strong')).then(
  (result) => {
    setTimeout(() => {
      void report(result).catch(reportFailure);
    }, 0);
  },
  reportFailure,
);
