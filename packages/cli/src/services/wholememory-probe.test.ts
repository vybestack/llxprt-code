/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  settledHeapCensus,
  settleHeap,
  type HeapCensus,
} from './__tests__/support/wholememory-probe.js';

declare const Bun: { gc(force: boolean): void };
const payloadBytes = 16 * 1024 * 1024;
const releaseLimit = 1048576;
const liveFloor = 15728640;
let retainedPayload: Uint8Array | undefined;

async function boundary(): Promise<HeapCensus> {
  return settledHeapCensus();
}

async function ownPayload(retain = false): Promise<WeakRef<Uint8Array>> {
  const payload = new Uint8Array(payloadBytes);
  payload.fill(97);
  const weak = new WeakRef(payload);
  if (retain) retainedPayload = payload;
  Bun.gc(false);
  await settleHeap();
  expect(payload[0]).toBe(97);
  return weak;
}

function expectReleased(before: HeapCensus, after: HeapCensus): void {
  expect(after.heapSize - before.heapSize).toBeLessThan(releaseLimit);
  expect(after.extraMemorySize - before.extraMemorySize).toBeLessThan(
    releaseLimit,
  );
}

function expectLive(before: HeapCensus, after: HeapCensus): void {
  expect(after.heapSize - before.heapSize).toBeGreaterThan(liveFloor);
  expect(after.extraMemorySize - before.extraMemorySize).toBeGreaterThan(
    liveFloor,
  );
}

describe('settled heap census in a grouped registration process', () => {
  it('does not report retained memory when no payload was allocated', async () => {
    const before = await boundary();
    Bun.gc(false);
    await settleHeap();
    const after = await boundary();
    expect(after.heapSize - before.heapSize).toBeLessThan(releaseLimit);
    expect(after.extraMemorySize - before.extraMemorySize).toBeLessThan(
      releaseLimit,
    );
  });

  it('measures released backing storage after full collection, not the previous Eden size', async () => {
    const before = await boundary();
    const weak = await ownPayload();
    const after = await boundary();
    expectReleased(before, after);
    expect(weak.deref()).toBeUndefined();
  });

  it('includes backing storage while its owner remains live', async () => {
    const before = await boundary();
    const payload = new Uint8Array(payloadBytes);
    payload.fill(98);
    await settleHeap();
    const after = await boundary();
    expectLive(before, after);
    expect(payload[payload.length - 1]).toBe(98);
  });

  it('rejects a deliberately retained backing store', async () => {
    const before = await boundary();
    const weak = await ownPayload(true);
    const after = await boundary();
    expectLive(before, after);
    expect(weak.deref()).toBe(retainedPayload);
    expect(retainedPayload?.[retainedPayload.length - 1]).toBe(97);
  });
});
