/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
// Ownership test. Settled heap retention across turns is proven by
// journal-retained-growth.test.ts. This file proves that one send releases
// derived rows, segments, readers and request closures by identity, independent
// of heap noise. In-flight identity windows also bound serialized block bytes;
// those charges are not measurements of the process heap.
import { describe, expect, it } from 'bun:test';
import { inFlightPeakLive } from './__tests__/support/streamprocessor-retained-census.js';
import { runRetainedScaling } from './__tests__/support/streamprocessor-retained-run.js';

// Both sizes distribute mixed text over 64 rows, rather than enlarging one row.
// The route tokenizer verifies each row and the full 1M-token request window.
const smallRows = { rowCodeUnits: 11_264 };
const largeRows = { rowCodeUnits: 45_056 };
// A row being serialised and the row the reader has yielded.
const ROW_WINDOW = 2;
const ROW_CATEGORIES = [
  'native.row',
  'native.row.blocks',
  'native.row.metadata',
  'snapshot.row',
];
// The native prompts across the retry and the one active serialization reader.
const PROMPT_WINDOW = 2;
const SEGMENT_WINDOW = 2;
const READER_WINDOW = 1;
const MAX_CONTEXT_TOKENS = 1_000_000;
// The effective default tool-output budget, also below model output limits.
const MAX_ROW_TOKENS = 40_000;
// Census charges use UTF-8 JSON bytes, not UTF-16 heap estimates. One row's
// conversion costs its serialized bytes; the unchanged window permits two.
const UTF8_JSON_ENCODING_FACTOR = 1;
const MIN_PAYLOAD_ALLOWANCE_RATIO = 4;
const MIN_TRAP_ALLOWANCE_RATIO = 3;

type Scaling = Awaited<ReturnType<typeof runRetainedScaling>>;
type ScalingFacts = Scaling['large'];

function blockAllowance(scaling: Scaling): number {
  const fixedOwnershipOverhead = scaling.small.baseline.liveBlockBytes;
  expect(fixedOwnershipOverhead).toBe(0);
  return (
    fixedOwnershipOverhead +
    ROW_WINDOW * UTF8_JSON_ENCODING_FACTOR * scaling.large.largestRowBytes
  );
}

function peakBlockBytes(facts: ScalingFacts): number {
  return Math.max(
    facts.first.liveBlockBytes,
    facts.receiver.liveBlockBytes,
    facts.last.liveBlockBytes,
  );
}

function expectInFlightWithinWindow(
  facts: ScalingFacts,
  allowance: number,
): void {
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
  expect(peakBlockBytes(facts)).toBeLessThanOrEqual(allowance);
}

function expectRealWindow(facts: ScalingFacts, allowance: number): void {
  expect(facts.contextLimit).toBeLessThanOrEqual(MAX_CONTEXT_TOKENS);
  expect(facts.oracle.estimatorMethod).toBe('exact');
  expect(facts.oracle.estimatedPromptTokens).toBeLessThan(facts.contextLimit);
  expect(facts.largestRowTokens).toBeLessThanOrEqual(MAX_ROW_TOKENS);
  expect(facts.expected.bytes).toBeGreaterThanOrEqual(
    MIN_PAYLOAD_ALLOWANCE_RATIO * allowance,
  );
}

function expectReleased(facts: ScalingFacts): void {
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
  expect(facts.largestRowBytes).toBeGreaterThan(0);
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
  expect(facts.detached.liveBlockBytes).toBe(0);
}

describe('actual StreamProcessor source retained owner census', () => {
  it('releases derived rows, segments, readers and request closures by identity', async () => {
    const scaling = await runRetainedScaling('none', smallRows, largeRows);
    expect(scaling.large.expected.bytes).toBeGreaterThan(
      scaling.small.expected.bytes,
    );
    const allowance = blockAllowance(scaling);
    for (const facts of [scaling.small, scaling.large]) {
      expectRealWindow(facts, allowance);
      expectReleased(facts);
      expectInFlightWithinWindow(facts, allowance);
    }
  }, 180000);
  it('trap: derived rows held by the test survive the census at both sizes', async () => {
    const scaling = await runRetainedScaling('held', smallRows, largeRows);
    const allowance = blockAllowance(scaling);
    for (const facts of [scaling.small, scaling.large]) {
      expectRealWindow(facts, allowance);
      expect(facts.final.survivors['native.row']?.live).toBeGreaterThan(0);
      expect(facts.detached.liveBlockBytes).toBeGreaterThanOrEqual(
        MIN_TRAP_ALLOWANCE_RATIO * allowance,
      );
      expect(() => expectReleased(facts)).toThrow(/toBe/);
    }
  }, 180000);
  it('trap: derived rows held only until the call returns exceed the in-flight window at both sizes', async () => {
    const scaling = await runRetainedScaling('in-flight', smallRows, largeRows);
    const allowance = blockAllowance(scaling);
    for (const facts of [scaling.small, scaling.large]) {
      expectRealWindow(facts, allowance);
      expect(inFlightPeakLive(facts, 'native.row')).toBeGreaterThan(ROW_WINDOW);
      expect(peakBlockBytes(facts)).toBeGreaterThanOrEqual(
        MIN_TRAP_ALLOWANCE_RATIO * allowance,
      );
      expect(() => expectInFlightWithinWindow(facts, allowance)).toThrow(
        /toBeLessThanOrEqual/,
      );
      expectReleased(facts);
    }
  }, 180000);
});
