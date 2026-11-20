/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { runRetainedCensus } from './__tests__/support/streamprocessor-retained-run.js';

describe('actual source BODY async-context owner discharge', () => {
  it('does not keep the disk selection reachable when an external consumer keeps the completed BODY shell', async () => {
    // The census only keeps the completed BODY shells when asked to; this test is the one that asks.
    process.env.ISSUE854_RETAIN_BODY_SHELLS = '1';
    const facts = await runRetainedCensus().finally(() => {
      delete process.env.ISSUE854_RETAIN_BODY_SHELLS;
    });
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
