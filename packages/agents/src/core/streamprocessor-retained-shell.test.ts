/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { runRetainedCensus } from './streamprocessor-retained-run.js';

describe('actual source BODY async-context owner discharge', () => {
  it('does not keep the disk selection reachable when an external consumer keeps the completed BODY shell', async () => {
    const facts = await runRetainedCensus();
    expect(facts.bodyShells).toBe(2);
    expect(facts.output).toBe('finished');
    expect(facts.bodies).toStrictEqual([facts.expected, facts.expected]);
    expect(facts.estimate).toStrictEqual(facts.oracle);
    expect(facts.owners.every((owner) => owner.closed)).toBe(true);
    expect(facts.activeBodies).toBe(0);
    expect(facts.detached.survivors['http.provider-body']?.live).toBe(2);
    expect(facts.detached.survivors['request.snapshot']?.live).toBe(0);
    expect(facts.detached.survivors['source.selection']?.live).toBe(0);
  }, 600000);
});
