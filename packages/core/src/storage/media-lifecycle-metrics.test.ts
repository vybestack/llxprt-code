/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { SessionRecordingService } from '../recording/SessionRecordingService.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import { SessionPersistenceService } from './SessionPersistenceService.js';
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
  if (value === null) throw new Error('Expected OS peak footprint measurement');
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

type PersistenceSaveOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown };

function observePersistenceSave(
  work: Promise<void>,
): Promise<PersistenceSaveOutcome> {
  return work.then(
    (): PersistenceSaveOutcome => ({ ok: true }),
    (error: unknown): PersistenceSaveOutcome => ({ ok: false, error }),
  );
}

describe('MediaLifecycleMetrics', () => {
  it('converts maxRSS using Darwin byte and other-platform KiB semantics', () => {
    expect(maxRssToBytes(4096, 'darwin')).toBe(4096);
    expect(maxRssToBytes(4096, 'linux')).toBe(4_194_304);
    expect(maxRssToBytes(4096, 'win32')).toBe(4_194_304);
    expect(maxRssToBytes(0, 'darwin')).toBeNull();
  });

  let directory = '';
  let recording: SessionRecordingService | undefined;
  let persistenceSave: Promise<PersistenceSaveOutcome> | undefined;

  async function finishPersistenceSave(): Promise<void> {
    const pending = persistenceSave;
    persistenceSave = undefined;
    if (pending === undefined) return;
    const outcome = await pending;
    if (!outcome.ok) throw outcome.error;
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-media-metrics-'));
  });

  afterEach(async () => {
    const failures: unknown[] = [];
    try {
      await finishPersistenceSave();
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
      contents: history.getRawHistory(),
      requestId: 'request-1',
      turnId: 'turn-1',
      aggregateBudgetBytes: encoded.length * 3,
    });
    recording = new SessionRecordingService({
      sessionId: 'metrics-session',
      projectHash: 'metrics-project',
      chatsDir: join(directory, 'recording'),
      workspaceDirs: [directory],
      provider: 'test',
      model: 'test',
    });
    recording.recordProviderSwitch('provider', 'model');
    const admittedHistory = history
      .getRawHistory()
      .find((content) => content.blocks.length > 0);
    if (admittedHistory === undefined) {
      throw new Error('Expected admitted media history');
    }
    recording.recordContent(admittedHistory);
    const persistence = new SessionPersistenceService(
      new Storage(directory),
      'metrics-session',
      { mediaStore: store },
    );
    persistenceSave = observePersistenceSave(
      persistence.save(history.getAll()),
    );
    const providerRetention = new ProviderRetentionSource(321);
    const metrics = new MediaLifecycleMetrics({
      store,
      history,
      requestResolver: resolver,
      recording,
      persistence,
      providerFileRetention: providerRetention,
    });

    const active = await metrics.snapshot();

    expect(active.localRetainedBlobBytes).toBe(payload.byteLength);
    expect(active.residentEncodedBytes).toBe(encoded.length);
    expect(active.activeRequestMaterializationBytes).toBe(encoded.length);
    expect(active.recordingQueueBytes).toBeGreaterThan(0);
    expect(active.persistenceQueueBytes).toBeGreaterThan(0);
    expect(active.diskSpoolBytes).toBe(payload.byteLength);
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

    await resolved.release();
    history.clear();
    providerRetention.release();
    await finishPersistenceSave();
    await recording.flush();
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
  });

  it('measures a present decoded-image cache independently', async () => {
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
  });
});
