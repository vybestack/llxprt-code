/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from '../services/history/HistoryService.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '../services/history/IContent.js';
import { LocalMediaStore } from './local-media-store.js';
import type { MediaLifecycleMetrics } from './media-lifecycle-metrics.js';

export class StreamMetricHistory extends HistoryService {}

export function metricReference(
  index: number,
  bytes = 16,
): MediaReferenceBlock {
  const object = {
    contentId: `sha256:${index.toString(16).padStart(64, '0')}`,
    mimeType: 'image/png',
    byteLength: bytes,
    normalizedBase64Length: Math.ceil(bytes / 3) * 4,
  };
  return {
    type: 'media',
    encoding: 'reference',
    ...object,
    originalContentId: object.contentId,
    selectedContentId: object.contentId,
    originalObject: object,
    selectedObject: object,
    transformation: { policyId: 'identity', policyVersion: 1, parameters: {} },
    semanticMetadata: { source: 'metric-fixture' },
  };
}

export function metricRow(index: number, payloadBytes = 20_000): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'tool',
    blocks: [
      { type: 'text', text: `row:${index}:${'x'.repeat(payloadBytes)}` },
      metricReference(index),
      metricReference(Math.floor(index / 2)),
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'audio/wav',
        data: 'aGVsbG8=',
      },
      {
        type: 'media',
        encoding: 'url',
        mimeType: 'image/png',
        data: 'https://fixture.invalid/image',
      },
      {
        type: 'tool_call',
        id: `call-${index % 3}`,
        name: 'read_file',
        parameters: { index },
      },
      {
        type: 'tool_response',
        callId: `call-${index % 3}`,
        toolName: 'read_file',
        result: { index },
      },
    ],
    metadata: {
      chronology: { seq: index + 1, userTurn: 1, step: index, recordedAt: 0 },
    },
  };
}

export async function withMetricStore<T>(
  action: (store: LocalMediaStore) => Promise<T>,
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), 'media-metric-test-'));
  const store = new LocalMediaStore({
    rootDirectory: directory,
    quotaBytes: 32 * 1024 * 1024,
  });
  try {
    return await action(store);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

export function metricSources(
  store: LocalMediaStore,
  history: HistoryService,
): ConstructorParameters<typeof MediaLifecycleMetrics>[0] {
  return {
    store,
    history,
    requestResolver: { accounting: () => ({ materializedNormalizedBytes: 0 }) },
    recording: { getPendingByteCount: () => 0 },
    persistence: { getPendingByteCount: () => 0 },
    providerFileRetention: { snapshot: () => ({ retainedBytes: 0 }) },
  };
}

export function metricScratch(): string[] {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith('llxprt-media-metric-index-'))
    .sort();
}

export function metricScratchChanges(before: readonly string[]): {
  readonly added: string[];
  readonly removed: string[];
} {
  const after = metricScratch();
  return {
    added: after.filter((path) => !before.includes(path)),
    removed: before.filter((path) => !after.includes(path)),
  };
}
