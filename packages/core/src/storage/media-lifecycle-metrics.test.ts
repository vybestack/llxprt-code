/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import {
  assertDefined,
  assertNotNull,
} from '@vybestack/llxprt-code-test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JournalRecordingService } from '../recording/journalRecordingService.js';
import { NativeRecordingProbe } from './native-recording-probe.test-support.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import { LocalMediaStore } from './local-media-store.js';
import { MediaAdmissionService } from './media-admission-service.js';
import {
  maxRssToBytes,
  MediaLifecycleMetrics,
} from './media-lifecycle-metrics.js';
import { RequestMediaResolver } from './request-media-resolver.js';

function imageBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length).fill(0x5a);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes.set([0, 0, 0, 2, 0, 0, 0, 3], 16);
  return bytes;
}

function inlineImage(data: string): IContent {
  return {
    speaker: 'human',
    blocks: [
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data,
      },
    ],
  };
}
function requireAvailableMetric(value: number | null): number {
  assertNotNull(value, 'Expected OS peak footprint measurement');
  return value;
}

class ProviderRetentionSource {
  private retainedBytes: number;

  constructor(retainedBytes: number) {
    this.retainedBytes = retainedBytes;
  }

  snapshot(): { readonly retainedBytes: number } {
    return { retainedBytes: this.retainedBytes };
  }

  release(): void {
    this.retainedBytes = 0;
  }
}

function rssBehavior(): number {
  expect(maxRssToBytes(4096)).toBe(4_194_304);
  expect(maxRssToBytes(0)).toBeNull();
  expect(maxRssToBytes(Number.NaN)).toBeNull();
  return maxRssToBytes(4096) ?? 0;
}

let directory = '';

let recording: JournalRecordingService | undefined;

let persistedRecording: JournalRecordingService | undefined;

async function lifecycleBehavior(): Promise<number> {
  let releasedDiskSpoolBytes = 0;

  const payload = imageBytes(192);
  const encoded = Buffer.from(payload).toString('base64');
  const store = new LocalMediaStore({
    rootDirectory: join(directory, 'media'),
    quotaBytes: 1024 * 1024,
  });
  const history = new HistoryService();
  const admission = new MediaAdmissionService(store);
  await admission.addToHistory(history, inlineImage(encoded), {
    turnId: 'turn-1',
    source: 'metrics-test',
  });
  history.add(inlineImage(encoded));
  const resolver = new RequestMediaResolver(store);
  const resolved = await resolver.resolve({
    contents: await collectRawHistory(history),
    requestId: 'request-1',
    turnId: 'turn-1',
    aggregateBudgetBytes: encoded.length * 3,
  });
  const probe = new NativeRecordingProbe();
  const activeRecording = await startMetricRecording(probe);
  recording = activeRecording;
  const persistence = new NativeRecordingProbe();
  persistedRecording = JournalRecordingService.create({
    sessionId: 'metrics-persisted',
    projectHash: 'metrics-project',
    chatsDir: join(directory, 'persisted'),
    journal: persistence.options,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  const persistedSession = await persistedRecording.session();
  await collectRowsForAssertions(
    history.streamRawHistory(),
    async (contentsForAssertions) => {
      const providerRetention = new ProviderRetentionSource(321);
      const metrics = new MediaLifecycleMetrics({
        store,
        history,
        requestResolver: resolver,
        recording: probe,
        persistence,
        providerFileRetention: providerRetention,
      });

      const admittedHistory = contentsForAssertions.find(
        (content) => content.blocks.length > 0,
      );
      assertDefined(admittedHistory, 'Expected admitted media history');
      const session = await activeRecording.session();
      await probe.measureWrite(
        async () => {
          await session.append([admittedHistory]);
        },
        async () => {
          await persistence.measureWrite(
            async () => {
              await persistedSession.append([admittedHistory]);
            },
            async () => {
              const active = await metrics.snapshot();
              assertActiveMetrics(active, payload.byteLength, encoded.length);
            },
          );
        },
      );

      await resolved.release();
      await history.clear();
      providerRetention.release();
      await persistedRecording?.flush();
      await activeRecording.flush();
      const released = await metrics.snapshot();

      expect({
        localRetainedBlobBytes: released.localRetainedBlobBytes,
        residentEncodedBytes: released.residentEncodedBytes,
        activeRequestMaterializationBytes:
          released.activeRequestMaterializationBytes,
        recordingQueueBytes: released.recordingQueueBytes,
        persistenceQueueBytes: released.persistenceQueueBytes,
        diskSpoolBytes: released.diskSpoolBytes,
        providerFileRetainedBytes: released.providerFileRetainedBytes,
      }).toStrictEqual({
        localRetainedBlobBytes: 0,
        residentEncodedBytes: 0,
        activeRequestMaterializationBytes: 0,
        recordingQueueBytes: 0,
        persistenceQueueBytes: 0,
        diskSpoolBytes: payload.byteLength,
        providerFileRetainedBytes: 0,
      });
      releasedDiskSpoolBytes = released.diskSpoolBytes;
    },
  );

  return releasedDiskSpoolBytes;
}

async function cacheBehavior(): Promise<number> {
  const store = new LocalMediaStore({
    rootDirectory: join(directory, 'media'),
    quotaBytes: 1024,
  });
  const metrics = new MediaLifecycleMetrics({
    store,
    history: new HistoryService(),
    requestResolver: new RequestMediaResolver(store),
    recording: { getPendingByteCount: () => 0 },
    persistence: { getPendingByteCount: () => 0 },
    decodedImageCache: { snapshot: () => ({ entries: 2, bytes: 640 }) },
    providerFileRetention: { snapshot: () => ({ retainedBytes: 0 }) },
  });

  const snapshot = await metrics.snapshot();

  expect(snapshot.decodedImageCache).toStrictEqual({
    available: true,
    entries: 2,
    bytes: 640,
  });
  return snapshot.decodedImageCache.bytes ?? 0;
}

describe('MediaLifecycleMetrics', () => {
  it('converts maxRSS from KiB to bytes', () => {
    expect(rssBehavior()).toBeGreaterThan(0);
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-media-metrics-'));
  });

  afterEach(async () => {
    const failures: unknown[] = [];
    try {
      await persistedRecording?.dispose();
    } catch (error: unknown) {
      failures.push(error);
    }
    try {
      await recording?.dispose();
    } catch (error: unknown) {
      failures.push(error);
    }
    recording = undefined;
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error: unknown) {
      failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Media metrics test cleanup failed');
    }
  });

  it('measures independent live lifecycle, process, and unavailable cache state', async () => {
    expect(await lifecycleBehavior()).toBeGreaterThan(0);
  });

  it('measures a present decoded-image cache independently', async () => {
    expect(await cacheBehavior()).toBeGreaterThan(0);
  });
});

function assertActiveMetrics(
  active: Awaited<ReturnType<MediaLifecycleMetrics['snapshot']>>,
  payloadBytes: number,
  encodedBytes: number,
): void {
  expect(active.localRetainedBlobBytes).toBe(payloadBytes);
  expect(active.residentEncodedBytes).toBe(encodedBytes);
  expect(active.activeRequestMaterializationBytes).toBe(encodedBytes);
  expect(active.recordingQueueBytes).toBeGreaterThan(0);
  expect(active.persistenceQueueBytes).toBeGreaterThan(0);
  expect(active.diskSpoolBytes).toBe(payloadBytes);
  expect(active.decodedImageCache).toStrictEqual({
    available: false,
    entries: null,
    bytes: null,
  });
  expect(active.providerFileRetainedBytes).toBe(321);
  expect(active.process.heapUsed).toBeGreaterThan(0);
  expect(active.process.external).toBeGreaterThan(0);
  expect(active.process.arrayBuffers).toBeGreaterThanOrEqual(0);
  expect(active.process.rss).toBeGreaterThan(0);
  const peakFootprint = requireAvailableMetric(active.osPeakFootprintBytes);
  expect(peakFootprint).toBeGreaterThanOrEqual(active.process.rss);
  expect(peakFootprint).toBeLessThan(active.process.rss * 10);
}

async function startMetricRecording(
  probe: NativeRecordingProbe,
): Promise<JournalRecordingService> {
  const activeRecording = JournalRecordingService.create({
    sessionId: 'metrics-session',
    projectHash: 'metrics-project',
    chatsDir: join(directory, 'recording'),
    journal: probe.options,
    workspaceDirs: [directory],
    provider: 'test',
    model: 'test',
  });
  activeRecording.recordProviderSwitch('provider', 'model');
  await activeRecording.session();
  return activeRecording;
}
