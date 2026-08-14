/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Round-trip tests for the Sample record (issue #3230): a request ID attached
 * to a requested sample survives collect -> format -> parse so request-keyed
 * side effects can be traced in samples.jsonl, while tick/startup samples
 * carry no request ID.
 */

import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_TOP_TYPES,
  type JscHeapStats,
  type Sample,
  collectSample,
  formatSample,
  normalizeTopTypes,
  parseSampleLine,
  parseSamples,
} from '../../memory/sample.ts';

const stats: JscHeapStats = {
  heapSize: 1024,
  heapCapacity: 2048,
  extraMemorySize: 0,
  objectCount: 10,
  protectedObjectCount: 1,
  objectTypeCounts: { Object: 5, String: 5 },
};

describe('collectSample / formatSample / parseSampleLine — requestId', () => {
  it('attaches a request id when provided and round-trips it through JSONL', () => {
    const sample = collectSample({
      tag: 'manual',
      pid: 42,
      rss: 4096,
      stats,
      nowMs: 1_700_000_000_000,
      requestId: 'req-abc-1',
    });
    expect(sample.requestId).toBe('req-abc-1');
    const parsed = parseSampleLine(formatSample(sample));
    expect(parsed).not.toBeNull();
    expect(parsed?.requestId).toBe('req-abc-1');
    expect(parsed?.tag).toBe('manual');
  });

  it('omits the request id entirely when not provided', () => {
    const sample = collectSample({
      tag: 'tick',
      pid: 42,
      rss: 4096,
      stats,
      nowMs: 1_700_000_000_000,
    });
    expect(sample.requestId).toBeUndefined();
    // The serialized line must not carry a stray field.
    expect(formatSample(sample)).not.toContain('requestId');
    const parsed = parseSampleLine(formatSample(sample));
    expect(parsed?.requestId).toBeUndefined();
  });

  it('round-trips a post-snapshot sample with its request id', () => {
    const sample = collectSample({
      tag: 'post-snapshot',
      pid: 7,
      rss: 8192,
      stats,
      nowMs: 1_700_000_000_500,
      requestId: 'req-snap-9',
    });
    const parsed = parseSampleLine(formatSample(sample));
    expect(parsed?.tag).toBe('post-snapshot');
    expect(parsed?.requestId).toBe('req-snap-9');
  });
});

/** A fully valid sample whose fields can be selectively corrupted. */
function validLine(): string {
  return formatSample(
    collectSample({
      tag: 'tick',
      pid: 7,
      rss: 8192,
      stats,
      nowMs: 1_700_000_000_500,
    }),
  );
}

describe('parseSampleLine — corrupt and torn lines fail safely', () => {
  const requiredNumericFields = [
    'rss',
    'heapSize',
    'heapCapacity',
    'extraMemorySize',
    'objectCount',
    'protectedObjectCount',
  ] as const;

  it('rejects a non-JSON line', () => {
    expect(parseSampleLine('{"t": "20')).toBeNull();
  });

  it('rejects a non-object line', () => {
    expect(parseSampleLine('[1,2,3]')).toBeNull();
    expect(parseSampleLine('42')).toBeNull();
  });

  it('rejects a bad or unparseable timestamp', () => {
    const base = JSON.parse(validLine()) as Record<string, unknown>;
    expect(
      parseSampleLine(JSON.stringify({ ...base, t: 'not-a-date' })),
    ).toBeNull();
    expect(
      parseSampleLine(JSON.stringify({ ...base, t: 1_700_000_000_000 })),
    ).toBeNull();
  });

  it('rejects negative or nonfinite numeric fields', () => {
    const base = JSON.parse(validLine()) as Record<string, unknown>;
    for (const field of requiredNumericFields) {
      expect(
        parseSampleLine(JSON.stringify({ ...base, [field]: -1 })),
      ).toBeNull();
      expect(
        parseSampleLine(JSON.stringify({ ...base, [field]: 'x' })),
      ).toBeNull();
    }
    // Nonfinite JSON spellings arrive as null after JSON.parse.
    expect(
      parseSampleLine(JSON.stringify({ ...base, heapSize: null })),
    ).toBeNull();
  });

  it('rejects the WHOLE line when any types entry is invalid', () => {
    const base = JSON.parse(validLine()) as Record<string, unknown>;
    const torn = {
      ...base,
      types: [
        ['Object', 5],
        ['String', 'not-a-number'],
      ],
    };
    // A partially invalid types array is not partially accepted.
    expect(parseSampleLine(JSON.stringify(torn))).toBeNull();
    const wrongShape = { ...base, types: [['Object'], [5]] };
    expect(parseSampleLine(JSON.stringify(wrongShape))).toBeNull();
    const notAnArray = { ...base, types: { Object: 5 } };
    expect(parseSampleLine(JSON.stringify(notAnArray))).toBeNull();
  });

  it('parseSamples skips corrupt lines and keeps good ones', () => {
    const good = validLine();
    const corruptLine = '"{""t"": torn json';
    const text = [
      good,
      corruptLine,
      '',
      JSON.stringify({ no: 'fields' }),
      good,
    ].join(String.fromCharCode(10));
    const samples = parseSamples(text);
    expect(samples).toHaveLength(2);
    expect(samples[0]?.tag).toBe('tick');
    expect(samples[1]?.tag).toBe('tick');
  });
});

describe('normalizeTopTypes / collectSample — injectable cutoff clamping', () => {
  it('uses the default when undefined, nonfinite, or below 1', () => {
    expect(normalizeTopTypes(undefined)).toBe(DEFAULT_TOP_TYPES);
    expect(normalizeTopTypes(Number.NaN)).toBe(DEFAULT_TOP_TYPES);
    expect(normalizeTopTypes(Number.POSITIVE_INFINITY)).toBe(DEFAULT_TOP_TYPES);
    expect(normalizeTopTypes(0)).toBe(DEFAULT_TOP_TYPES);
    expect(normalizeTopTypes(-3)).toBe(DEFAULT_TOP_TYPES);
  });

  it('floors fractional values and passes valid ones through', () => {
    expect(normalizeTopTypes(7.9)).toBe(7);
    expect(normalizeTopTypes(1)).toBe(1);
    expect(normalizeTopTypes(500)).toBe(500);
  });

  it('collectSample honors the clamped cutoff', () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 60; i++) {
      wide[`Type${i}`] = 100 - i;
    }
    const bigStats: JscHeapStats = { ...stats, objectTypeCounts: wide };
    const sample = collectSample({
      tag: 'tick',
      pid: 7,
      rss: 8192,
      stats: bigStats,
      nowMs: 1_700_000_000_500,
      topTypes: 10.5,
    });
    expect(sample.types).toHaveLength(10);
    // Sorted by count descending: the largest entries survive the cutoff.
    expect(sample.types[0]).toEqual(['Type0', 100]);
    const defaulted: Sample = collectSample({
      tag: 'tick',
      pid: 7,
      rss: 8192,
      stats: bigStats,
      nowMs: 1_700_000_000_500,
    });
    expect(defaulted.types).toHaveLength(DEFAULT_TOP_TYPES);
  });
});
