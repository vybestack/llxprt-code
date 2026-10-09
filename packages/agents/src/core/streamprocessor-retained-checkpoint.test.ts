/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  RetainedOwnerCensus,
  retainedCheckpoint,
} from './streamprocessor-retained-census.js';

function releasedTarget(census: RetainedOwnerCensus): void {
  census.observe('control', { text: 'unreachable' });
}

describe('retained checkpoint event-loop settlement', () => {
  it('crosses a host event-loop turn so WeakRef observation does not keep an otherwise released target alive', async () => {
    const census = new RetainedOwnerCensus();
    releasedTarget(census);
    const checkpoint = await retainedCheckpoint(census);
    expect(checkpoint.survivors.control?.observed).toBe(1);
    expect(checkpoint.survivors.control?.live).toBe(0);
  });
  it('does not clear a target that still has an ordinary strong owner', async () => {
    const census = new RetainedOwnerCensus();
    const owner = { text: 'still owned' };
    census.observe('control', owner);
    const checkpoint = await retainedCheckpoint(census);
    expect(checkpoint.survivors.control?.observed).toBe(1);
    expect(checkpoint.survivors.control?.live).toBe(1);
    expect(owner.text).toBe('still owned');
  });
});
