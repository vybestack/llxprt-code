/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContentBlock, IContent } from '../services/history/IContent.js';
import type { LocalMediaStore } from './local-media-store.js';

export interface PendingByteMetricSource {
  getPendingByteCount(): number;
}

export interface HistoryMetricSource {
  getRawHistory(): readonly IContent[];
}

export interface RequestMaterializationMetricSource {
  accounting(): { readonly materializedNormalizedBytes: number };
}

export interface ProviderFileRetentionMetricSource {
  snapshot(): { readonly retainedBytes: number };
}

export interface DecodedImageCacheMetricSource {
  snapshot(): {
    readonly entries: number;
    readonly bytes: number;
  };
}

export type DecodedImageCacheMetrics =
  | {
      readonly available: true;
      readonly entries: number;
      readonly bytes: number;
    }
  | {
      readonly available: false;
      readonly entries: null;
      readonly bytes: null;
    };

export interface MediaProcessMemoryMetrics {
  readonly heapUsed: number;
  readonly external: number;
  readonly arrayBuffers: number;
  readonly rss: number;
}

export interface MediaLifecycleMetricsSnapshot {
  readonly localRetainedBlobBytes: number;
  readonly residentEncodedBytes: number;
  readonly activeRequestMaterializationBytes: number;
  readonly recordingQueueBytes: number;
  readonly persistenceQueueBytes: number;
  readonly diskSpoolBytes: number;
  readonly decodedImageCache: DecodedImageCacheMetrics;
  readonly providerFileRetainedBytes: number;
  readonly process: MediaProcessMemoryMetrics;
  readonly osPeakFootprintBytes: number | null;
}

export interface MediaLifecycleMetricsSources {
  readonly store: LocalMediaStore;
  readonly history: HistoryMetricSource;
  readonly requestResolver: RequestMaterializationMetricSource;
  readonly recording: PendingByteMetricSource;
  readonly persistence: PendingByteMetricSource;
  readonly providerFileRetention: ProviderFileRetentionMetricSource;
  readonly decodedImageCache?: DecodedImageCacheMetricSource;
}

interface RetainedHistoryMetrics {
  readonly localRetainedBlobBytes: number;
  readonly residentEncodedBytes: number;
}

function requireByteCount(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function addBytes(name: string, total: number, bytes: number): number {
  return requireByteCount(name, total + requireByteCount(name, bytes));
}

function measureRetainedBlock(
  block: ContentBlock,
  referenceBytes: Map<string, number>,
  residentEncodedBytes: number,
): number {
  if (block.type !== 'media') return residentEncodedBytes;
  if (block.encoding === 'base64') {
    return addBytes(
      'residentEncodedBytes',
      residentEncodedBytes,
      Buffer.byteLength(block.data, 'ascii'),
    );
  }
  if (block.encoding !== 'reference') return residentEncodedBytes;
  const retained = referenceBytes.get(block.contentId);
  if (retained !== undefined && retained !== block.byteLength) {
    throw new Error(
      `Media reference ${block.contentId} has inconsistent byte lengths`,
    );
  }
  referenceBytes.set(
    block.contentId,
    requireByteCount('localRetainedBlobBytes', block.byteLength),
  );
  return residentEncodedBytes;
}

function measureRetainedHistory(
  history: readonly IContent[],
): RetainedHistoryMetrics {
  const referenceBytes = new Map<string, number>();
  let residentEncodedBytes = 0;
  for (const content of history) {
    for (const block of content.blocks) {
      residentEncodedBytes = measureRetainedBlock(
        block,
        referenceBytes,
        residentEncodedBytes,
      );
    }
  }
  let localRetainedBlobBytes = 0;
  for (const bytes of referenceBytes.values()) {
    localRetainedBlobBytes = addBytes(
      'localRetainedBlobBytes',
      localRetainedBlobBytes,
      bytes,
    );
  }
  return { localRetainedBlobBytes, residentEncodedBytes };
}

function decodedImageCacheMetrics(
  source: DecodedImageCacheMetricSource | undefined,
): DecodedImageCacheMetrics {
  if (source === undefined) {
    return { available: false, entries: null, bytes: null };
  }
  const snapshot = source.snapshot();
  return {
    available: true,
    entries: requireByteCount('decodedImageCacheEntries', snapshot.entries),
    bytes: requireByteCount('decodedImageCacheBytes', snapshot.bytes),
  };
}

function processMemoryMetrics(): MediaProcessMemoryMetrics {
  const memory = process.memoryUsage();
  return {
    heapUsed: requireByteCount('heapUsed', memory.heapUsed),
    external: requireByteCount('external', memory.external),
    arrayBuffers: requireByteCount('arrayBuffers', memory.arrayBuffers),
    rss: requireByteCount('rss', memory.rss),
  };
}

export function maxRssToBytes(
  maxRSS: number,
  platform: NodeJS.Platform,
): number | null {
  if (!Number.isFinite(maxRSS) || maxRSS <= 0) return null;
  const bytes = platform === 'darwin' ? maxRSS : maxRSS * 1024;
  return requireByteCount('osPeakFootprintBytes', Math.round(bytes));
}

function osPeakFootprintBytes(): number | null {
  return maxRssToBytes(process.resourceUsage().maxRSS, process.platform);
}

/**
 * Samples independent media lifecycle owners before awaiting the filesystem
 * spool measurement, preserving one coherent view of in-process queues.
 */
export class MediaLifecycleMetrics {
  constructor(private readonly sources: MediaLifecycleMetricsSources) {}

  async snapshot(): Promise<MediaLifecycleMetricsSnapshot> {
    const retained = measureRetainedHistory(
      this.sources.history.getRawHistory(),
    );
    const request = this.sources.requestResolver.accounting();
    const recordingQueueBytes = requireByteCount(
      'recordingQueueBytes',
      this.sources.recording.getPendingByteCount(),
    );
    const persistenceQueueBytes = requireByteCount(
      'persistenceQueueBytes',
      this.sources.persistence.getPendingByteCount(),
    );
    const provider = this.sources.providerFileRetention.snapshot();
    const decodedImageCache = decodedImageCacheMetrics(
      this.sources.decodedImageCache,
    );
    const processMetrics = processMemoryMetrics();
    const peakFootprint = osPeakFootprintBytes();
    const diskSpoolBytes = requireByteCount(
      'diskSpoolBytes',
      await this.sources.store.getStoredByteLength(),
    );
    return {
      ...retained,
      activeRequestMaterializationBytes: requireByteCount(
        'activeRequestMaterializationBytes',
        request.materializedNormalizedBytes,
      ),
      recordingQueueBytes,
      persistenceQueueBytes,
      diskSpoolBytes,
      decodedImageCache,
      providerFileRetainedBytes: requireByteCount(
        'providerFileRetainedBytes',
        provider.retainedBytes,
      ),
      process: processMetrics,
      osPeakFootprintBytes: peakFootprint,
    };
  }
}
