/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
// Ownership test. Settled heap retention across turns is proven by
// journal-retained-growth.test.ts (real ChatSession with compression, 400
// measured turns, a 1 MiB gate per checkpoint, failing traps). This file proves
// that one send releases what it owns, by identity: derived rows, segments,
// readers and request closures are observed through WeakRefs and must be
// collected, so a retained object fails whatever the heap noise. A single
// settled heap delta around one send is not asserted here because collector
// and code-block noise on shared CI exceeded 1 MiB with nothing retained.
// Context-sized retention while a send is in flight is bounded by identity too:
// the live count of row objects, segments and readers at every in-flight
// checkpoint must stay inside the streaming window at a small and a large tail.
import { describe, expect, it } from 'bun:test';
import { inFlightPeakLive } from './__tests__/support/streamprocessor-retained-census.js';
import {
  runRetainedCensus,
  runRetainedScaling,
} from './__tests__/support/streamprocessor-retained-run.js';

// The in-flight peak holds request-scoped bodies (design R2 allows them), so
// its heap is a constant cost that no absolute byte bound near 1 MiB can hold
// and that a heap comparison between sizes cannot separate from collector
// noise. What must not exist in flight is a derived row, segment or reader held
// beyond the streaming window. The same scenario runs at a 2 MiB and an 8 MiB
// tail in one warmed process; at every in-flight checkpoint, after a settled
// collection, the live count of each such category must be inside the same
// window at both sizes. A row held for the call fails because the scenario
// streams 130 rows through that window.
const smallTail = { mixedChunks: 32 };
const largeTail = { mixedChunks: 128 };
// A row being serialised, the row the reader has yielded, and settle lag for
// the one the collector has not yet drained.
const ROW_WINDOW = 2;
const ROW_CATEGORIES = [
  'native.row',
  'native.row.blocks',
  'native.row.metadata',
  'snapshot.row',
] as const;
// The native prompts across the retry and the one active serialization reader.
const PROMPT_WINDOW = 2;
const SEGMENT_WINDOW = 2;
const READER_WINDOW = 1;

type ScalingFacts = Awaited<ReturnType<typeof runRetainedScaling>>['large'];

function expectInFlightWithinWindow(facts: ScalingFacts): void {
  for (const category of ROW_CATEGORIES)
    expect(inFlightPeakLive(facts, category)).toBeLessThanOrEqual(ROW_WINDOW);
  expect(inFlightPeakLive(facts, 'native.prompt')).toBeLessThanOrEqual(
    PROMPT_WINDOW,
  );
  expect(inFlightPeakLive(facts, 'source.segment')).toBeLessThanOrEqual(
    SEGMENT_WINDOW,
  );
  expect(inFlightPeakLive(facts, 'snapshot.reader')).toBeLessThanOrEqual(
    READER_WINDOW,
  );
}

describe('actual StreamProcessor source retained owner census', () => {
  it('releases derived rows, segments, readers and request closures by identity', async () => {
    const scaling = await runRetainedScaling('none', smallTail, largeTail);
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
      'native.row',
      'native.row.blocks',
      'native.row.block',
      'native.item',
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
      'native.prompt',
      'native.item',
      'native.row',
      'native.row.blocks',
      'snapshot.row',
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
    // The scenario streams every row at both sizes, so a bound that holds at
    // both is a bound on the window and not on a short run.
    expect(scaling.small.rows).toBe(130);
    expectInFlightWithinWindow(scaling.small);
    expectInFlightWithinWindow(scaling.large);
  }, 600000);
  it('trap: derived rows held by the test survive the census', async () => {
    const facts = await runRetainedCensus('held', largeTail);
    expect(facts.final.survivors['native.row']?.live).toBeGreaterThan(0);
  }, 600000);
  it('trap: derived rows held only until the call returns exceed the in-flight window at both sizes', async () => {
    const scaling = await runRetainedScaling('in-flight', smallTail, largeTail);
    for (const facts of [scaling.small, scaling.large]) {
      expect(inFlightPeakLive(facts, 'native.row')).toBeGreaterThan(ROW_WINDOW);
      expect(() => expectInFlightWithinWindow(facts)).toThrow(
        /toBeLessThanOrEqual/,
      );
    }
  }, 600000);
});
