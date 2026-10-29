/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import type { HistoryService } from './HistoryService.js';
import type { ChronologyMarker, IContent } from './IContent.js';
import type { BatchOwnerCensus } from './__tests__/support/addbatch-stream-test-helpers.js';
import { batchGate } from './__tests__/support/addbatch-stream-test-helpers.js';
import { journalMediaParticipant as mediaParticipant } from './chronology-rollback-test-helpers.js';
import type { DetachedFixture } from './detached-rollback-test-helpers.js';

import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';

const jsc: unknown = createRequire(import.meta.url)('bun:jsc');

function collectTransformRows(): void {
  if (
    typeof jsc !== 'object' ||
    jsc === null ||
    !('gcAndSweep' in jsc) ||
    typeof jsc.gcAndSweep !== 'function'
  )
    throw new Error('Bun JSC gcAndSweep is required');
  jsc.gcAndSweep();
}

export interface TransformProbes {
  readonly rows: Array<WeakRef<IContent>>;
  readonly markers: Array<WeakRef<ChronologyMarker>>;
}

export function transformProbes(): TransformProbes {
  return { rows: [], markers: [] };
}

export function probeTransformRow(
  row: IContent,
  probes: TransformProbes,
): void {
  probes.rows.push(new WeakRef(row));
  const marker = row.metadata?.chronology;
  if (marker === undefined) throw new Error('Missing fixture chronology');
  probes.markers.push(new WeakRef(marker));
}

export async function sweepTransformRows(): Promise<void> {
  for (let turn = 0; turn < 8; turn++) {
    await setImmediate();
    collectTransformRows();
  }
  await setImmediate();
}

export function recordTransformPhase(
  route: string,
  phase: string,
  size: number,
  owners: BatchOwnerCensus,
  probes: TransformProbes,
): { callerRows: number; callerMarkers: number } {
  const weak = {
    callerRows: probes.rows.filter((row) => row.deref() !== undefined).length,
    callerMarkers: probes.markers.filter((row) => row.deref() !== undefined)
      .length,
  };
  const output = process.env.TRANSFORM_VALUE_OUTPUT;
  if (output !== undefined)
    appendFileSync(
      output,
      JSON.stringify({
        route,
        phase,
        size,
        aggregate: owners.snapshot(),
        external: owners.external.snapshot(),
        internal: owners.internal.snapshot(),
        ...weak,
      }) + '\n',
    );
  return weak;
}

export function transformPhaseSampler(
  route: string,
  size: number,
  owners: BatchOwnerCensus,
  probes: TransformProbes,
): (phase: string) => Promise<void> {
  return (phase) => expectTransformReleased(route, phase, size, owners, probes);
}

export async function expectTransformReleased(
  route: string,
  phase: string,
  size: number,
  owners: BatchOwnerCensus,
  probes: TransformProbes,
): Promise<void> {
  await sweepTransformRows();
  expect(
    recordTransformPhase(route, phase, size, owners, probes),
  ).toStrictEqual({
    callerRows: 0,
    callerMarkers: 0,
  });
  expectTransformBound(owners);
}

export function expectTransformBound(owners: BatchOwnerCensus): void {
  expect(owners.snapshot().liveRows).toBeLessThanOrEqual(440);
  expect(owners.snapshot().liveSerializedBytes).toBeLessThanOrEqual(
    8 * 1024 * 1024,
  );
}

export async function withValueTransformFixture<T>(
  action: (fixture: DetachedFixture) => Promise<T>,
): Promise<T> {
  return withNativeDetachedFixture((fixture) =>
    action({
      ...fixture,
      recorder: fixture.recording,
    }),
  );
}

export async function pauseTransformFinalization(
  history: HistoryService,
  failure?: Error,
): Promise<{ acknowledged: Promise<void>; release(): void }> {
  const reached = batchGate();
  const gate = batchGate();
  await history.registerMediaOwner(
    mediaParticipant(() => ({
      publish: (): void => {},
      rollback: (): void => {},
      finalize: async (): Promise<void> => {
        reached.resolve();
        await gate.promise;
        if (failure !== undefined) throw failure;
      },
    })),
  );
  return { acknowledged: reached.promise, release: () => gate.resolve() };
}
