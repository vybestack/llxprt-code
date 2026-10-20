/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import type { SessionRecordingPort } from '@vybestack/llxprt-code-core/recording/recordingPort.js';
import { isJsonlRecorder } from '@vybestack/llxprt-code-core/services/history/recorderBackend.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { SemanticPurgeRowSource } from '@vybestack/llxprt-code-core/services/history/semantic-purge-disk-rows.js';
import type { SemanticMediaPurgeFrontier } from '@vybestack/llxprt-code-core/services/history/semantic-media-purge.js';
import { nativeFileRows } from '../../../compression/__tests__/support/native-file-rows.js';
import { compressionValueDigest } from '../../../compression/__tests__/compression-value-fixture.js';

function isMaterializer(
  value: unknown,
): value is { materialize(): Promise<unknown> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'materialize' in value &&
    typeof value.materialize === 'function'
  );
}

export function observeNativeMaterializationGuard(
  history: HistoryService,
): Promise<unknown> {
  const journal: unknown = Reflect.get(history, 'journal');
  if (!isMaterializer(journal)) throw new Error('Missing native materializer');
  return journal.materialize();
}

export async function persistPurgeFixture(
  recording: SessionRecordingPort | undefined,
  rows: SemanticPurgeRowSource,
  frontier: SemanticMediaPurgeFrontier,
): Promise<void> {
  if (recording === undefined) throw new Error('Missing shared recorder');
  if (isJsonlRecorder(recording)) {
    await recording.recordSemanticMediaPurgeRows(rows.streamRows(), frontier, {
      requireLiveFold: true,
    });
  }
}

export async function verifyNativePurgeDurability(
  history: HistoryService,
  recording: SessionRecordingPort | undefined,
): Promise<void> {
  if (recording === undefined) throw new Error('Missing shared recorder');
  if (isJsonlRecorder(recording)) return;
  await history.waitForCommit();
  await recording.flush();
  const path = recording.getFilePath();
  if (path === null) throw new Error('Missing native recording');
  const expected = await compressionValueDigest(history.streamRawHistory());
  expect(await compressionValueDigest(nativeFileRows(path))).toStrictEqual(
    expected,
  );
}
