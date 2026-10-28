/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { measure } from './conversation-array-memory-probe.js';
describe('ConversationManager array caller suspended after durable ack', () => {
  it('charges caller, stored and returned owners before and after ack against 440/eight MiB', () => {
    const positive = measure(8192, false);
    const trap = measure(8192, true);
    expect(positive.preRows).toBe(8192);
    expect(positive.preBytes).toBeGreaterThan(8 * 1024 * 1024);
    expect(positive.callerRows).toBe(0);
    expect(positive.returnedRows).toBe(0);
    // Caller rows are released; the publication spools to disk, so no row
    // objects may remain owned by the store while finalization is suspended.
    expect(positive.storedRows).toBe(0);
    expect(positive.heldRows).toBeLessThanOrEqual(440);
    expect(positive.heldBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(trap.callerRows).toBe(8192);
    expect(trap.callerBytes).toBeGreaterThan(8 * 1024 * 1024);
    expect(trap.heldRows).toBeGreaterThan(440);
    expect(trap.heldBytes).toBeGreaterThan(8 * 1024 * 1024);
  }, 300_000);
});
