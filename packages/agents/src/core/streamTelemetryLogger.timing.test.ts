/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { StreamTimingTracker } from './streamTelemetryLogger.js';

function textChunk(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

function emptyTextChunk(): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text: '' }] };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('StreamTimingTracker raw token-delta timing (issue #3493)', () => {
  it('visible token-bearing chunks stamp first/last timing when no raw delta arrives (fallback path)', async () => {
    const tracker = new StreamTimingTracker();
    await delay(15);
    tracker.recordChunk(textChunk('Hello'));
    const afterFirst = tracker.measure();
    await delay(15);
    tracker.recordChunk(textChunk(' world'));
    const final = tracker.measure();

    const firstStamp = afterFirst.firstTokenMs;
    if (firstStamp === null) {
      throw new Error('visible token-bearing chunk must stamp firstTokenMs');
    }
    expect(afterFirst.lastTokenMs).toBe(firstStamp);
    expect(final.firstTokenMs).toBe(firstStamp);
    expect(final.lastTokenMs).toBeGreaterThan(firstStamp);
    expect(final.chunkCount).toBe(2);
  });

  it('a raw delta before any visible chunk sets firstTokenMs and a later visible chunk does not overwrite the window', async () => {
    const tracker = new StreamTimingTracker();
    await delay(15);
    tracker.recordRawTokenDelta();
    const rawWindow = tracker.measure();
    await delay(15);
    tracker.recordChunk(textChunk('deferred visible emission'));
    const final = tracker.measure();

    const rawFirst = rawWindow.firstTokenMs;
    const rawLast = rawWindow.lastTokenMs;
    if (rawFirst === null || rawLast === null) {
      throw new Error(
        'raw token delta must stamp firstTokenMs and lastTokenMs',
      );
    }
    expect(final.firstTokenMs).toBe(rawFirst);
    expect(final.lastTokenMs).toBe(rawLast);
    expect(final.chunkCount).toBe(1);
  });

  it('the last raw delta defines lastTokenMs even when a visible token-bearing chunk arrives strictly after it', async () => {
    const tracker = new StreamTimingTracker();
    await delay(15);
    tracker.recordRawTokenDelta();
    const firstRawWindow = tracker.measure();
    await delay(15);
    tracker.recordRawTokenDelta();
    const lastRawWindow = tracker.measure();
    await delay(15);
    tracker.recordChunk(textChunk('reasoning buffer flush'));
    const final = tracker.measure();

    const firstRaw = firstRawWindow.firstTokenMs;
    const lastRaw = lastRawWindow.lastTokenMs;
    if (firstRaw === null || lastRaw === null) {
      throw new Error(
        'raw token deltas must stamp firstTokenMs and lastTokenMs',
      );
    }
    expect(lastRaw).toBeGreaterThan(firstRaw);
    expect(final.firstTokenMs).toBe(firstRaw);
    expect(final.lastTokenMs).toBe(lastRaw);
    expect(final.chunkCount).toBe(1);
  });

  it('visible chunks still advance chunkCount after raw timing has stamped the attempt', () => {
    const tracker = new StreamTimingTracker();
    tracker.recordRawTokenDelta();
    const rawWindow = tracker.measure();
    tracker.recordChunk(textChunk('one'));
    tracker.recordChunk(textChunk('two'));
    tracker.recordChunk(textChunk('three'));
    const final = tracker.measure();

    expect(final.chunkCount).toBe(3);
    expect(final.firstTokenMs).toBe(rawWindow.firstTokenMs);
    expect(final.lastTokenMs).toBe(rawWindow.lastTokenMs);
  });

  it('non-token-bearing visible chunks count toward chunkCount without stamping timing (no raw deltas)', async () => {
    const tracker = new StreamTimingTracker();
    tracker.recordChunk(emptyTextChunk());
    await delay(15);
    tracker.recordChunk(emptyTextChunk());
    const final = tracker.measure();

    expect(final.chunkCount).toBe(2);
    expect(final.firstTokenMs).toBeNull();
    expect(final.lastTokenMs).toBeNull();
  });

  it('non-token-bearing visible chunks count toward chunkCount without moving a raw-stamped window', async () => {
    const tracker = new StreamTimingTracker();
    tracker.recordRawTokenDelta();
    const rawWindow = tracker.measure();
    await delay(15);
    tracker.recordChunk(emptyTextChunk());
    tracker.recordChunk(emptyTextChunk());
    const final = tracker.measure();

    expect(final.chunkCount).toBe(2);
    expect(final.firstTokenMs).toBe(rawWindow.firstTokenMs);
    expect(final.lastTokenMs).toBe(rawWindow.lastTokenMs);
  });

  it('providerRequestMs spans the full stream lifecycle regardless of which timing source stamped the window', async () => {
    const visibleOnly = new StreamTimingTracker();
    await delay(15);
    visibleOnly.recordChunk(textChunk('visible'));
    await delay(15);
    const visibleMeasurement = visibleOnly.measure();

    const rawStamped = new StreamTimingTracker();
    await delay(15);
    rawStamped.recordRawTokenDelta();
    await delay(15);
    rawStamped.recordChunk(textChunk('terminal combined chunk'));
    const rawMeasurement = rawStamped.measure();

    const visibleLast = visibleMeasurement.lastTokenMs;
    const rawLast = rawMeasurement.lastTokenMs;
    if (visibleLast === null || rawLast === null) {
      throw new Error('both timing sources must stamp lastTokenMs');
    }
    expect(visibleMeasurement.providerRequestMs).toBeGreaterThan(visibleLast);
    expect(rawMeasurement.providerRequestMs).toBeGreaterThan(rawLast);
  });
});
