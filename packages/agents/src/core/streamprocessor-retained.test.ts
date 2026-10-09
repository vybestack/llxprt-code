/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { runRetainedCensus } from './streamprocessor-retained-run.js';

describe('actual StreamProcessor source retained owner census', () => {
  it('releases derived rows, segments and request closures below the strict 1 MiB gate', async () => {
    const facts = await runRetainedCensus();
    expect(facts.output).toBe('finished');
    expect(facts.estimate).toStrictEqual(facts.oracle);
    expect(facts.bodies).toStrictEqual([facts.expected, facts.expected]);
    expect(facts.rows).toBe(facts.mode === 'none' ? 0 : 130);
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
    expect(facts.largestRowBytes).toBeGreaterThanOrEqual(
      facts.mode === 'large' ? 10 * 1024 * 1024 + 1 : 0,
    );
    for (const category of [
      'progressive.row-copy',
      'progressive.row-copy.blocks',
      'progressive.row-copy.block',
      'writer.derived-item',
    ]) {
      const observed = facts.final.survivors[category];
      expect(
        observed === undefined ? 0 : observed.observed,
      ).toBeGreaterThanOrEqual(facts.mode === 'none' ? 0 : 130);
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
    expect(facts.settledDelta).toBeLessThan(1_048_576);
    expect(facts.detachedDelta).toBeLessThan(1_048_576);
    expect(facts.gateDelta).toBeLessThan(1_048_576);
  }, 600000);
});
