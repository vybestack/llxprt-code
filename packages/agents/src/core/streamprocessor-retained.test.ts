/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  runRetainedCensus,
  runRetainedScaling,
} from './__tests__/support/streamprocessor-retained-run.js';

const mebibyte = 1_048_576;
// Settled and detached deltas keep the absolute 1 MiB bound. The in-flight
// peak holds request-scoped bodies that are released after the call, so it is
// a constant cost (about 2.3 to 3.4 MB at every tail size) and no absolute
// bound near 1 MiB can hold. It is bounded by how it scales with context
// instead: the same scenario runs at a 2 MiB and an 8 MiB tail in one warmed
// process, and the in-flight peak may grow by less than 1 MiB across the 6 MiB
// tail difference. Retention proportional to context grows by about 6 MiB, so
// it fails; the 1 MiB allowance is not widened.
const smallTail = { mixedChunks: 32 };
const largeTail = { mixedChunks: 128 };

describe('actual StreamProcessor source retained owner census', () => {
  it('releases derived rows, segments and request closures below the strict 1 MiB gate', async () => {
    const scaling = await runRetainedScaling(
      'none',
      smallTail,
      largeTail,
      true,
    );
    const facts = scaling.large;
    expect(facts.output).toBe('finished');
    expect(facts.estimate).toStrictEqual(facts.oracle);
    expect(facts.bodies).toStrictEqual([facts.expected, facts.expected]);
    expect(facts.rows).toBe(130);
    expect(facts.tokens).toBe(3);
    expect(facts.distinctRetryTokens).toBe(true);
    expect(facts.owners.every((owner) => owner.closed)).toBe(true);
    expect(facts.originalSurvivors).toBe(0);
    expect(facts.inputSurvivors).toBe(0);
    expect(facts.activeBodies).toBe(0);
    expect(facts.demand.active).toBe(0);
    expect(facts.segmentsRemaining).toHaveLength(0);
    expect(facts.cleanup.enforcementAttempts).toBe(2);
    expect(facts.cleanup.callbackClearAttempts).toBeGreaterThanOrEqual(2);
    expect(facts.telemetryEnabled).toBe(true);
    expect(facts.logPrompts).toBe(false);
    expect(
      facts.requests.every((request) => request.requestText === undefined),
    ).toBe(true);
    expect(facts.largestRowBytes).toBeGreaterThanOrEqual(0);
    for (const category of [
      'progressive.row-copy',
      'progressive.row-copy.blocks',
      'progressive.row-copy.block',
      'writer.derived-item',
    ]) {
      const observed = facts.final.survivors[category];
      expect(
        observed === undefined ? 0 : observed.observed,
      ).toBeGreaterThanOrEqual(130);
      expect(observed === undefined ? 0 : observed.live).toBe(0);
    }
    for (const category of [
      'source.selection',
      'source.preparer',
      'request.snapshot',
      'snapshot.reader',
      'source.projection',
      'source.segments',
      'source.segment',
      'source.lease-closure',
      'source.prepared',
      'source.options',
      'source.contents-closure',
      'source.release-closure',
      'source.runtime-builder-output',
      'compression.estimate-closure',
      'http.provider-body',
      'http.pull-closure',
      'http.chunk',
    ]) {
      expect(facts.detached.survivors[category]?.live).toBe(0);
    }
    // A single settled-heap reading carries collector noise of about 1.5 MB
    // between runs; retention is present in every reading, so the gate takes
    // the lower of two full-size measurements.
    const repeat = scaling.repeat;
    if (repeat === undefined) throw new Error('Missing repeated measurement');
    expect(Math.min(facts.settledDelta, repeat.settledDelta)).toBeLessThan(
      mebibyte,
    );
    expect(Math.min(facts.detachedDelta, repeat.detachedDelta)).toBeLessThan(
      mebibyte,
    );
    expect(scaling.large.gateDelta - scaling.small.gateDelta).toBeLessThan(
      mebibyte,
    );
  }, 600000);
  it('trap: derived rows held by the test survive the census', async () => {
    const facts = await runRetainedCensus('held', largeTail);
    expect(facts.final.survivors['progressive.row-copy']?.live).toBeGreaterThan(
      0,
    );
    expect(facts.settledDelta).toBeGreaterThanOrEqual(mebibyte);
  }, 600000);
  it('trap: derived rows held only until the call returns grow in-flight with context', async () => {
    const scaling = await runRetainedScaling('in-flight', smallTail, largeTail);
    expect(
      scaling.large.gateDelta - scaling.small.gateDelta,
    ).toBeGreaterThanOrEqual(mebibyte);
  }, 600000);
});
