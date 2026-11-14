/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { SessionRecordingPort } from '@vybestack/llxprt-code-core/recording/recordingPort.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { exactTokenizer } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCoreSuffixFixtureGraph } from '../../../../../core/src/services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import { compressionValueDigest } from '../compression-value-fixture.js';
import { nativeFileRows } from './native-file-rows.js';

export interface ValueFixture {
  readonly history: HistoryService;
  durable(): Promise<Awaited<ReturnType<typeof compressionValueDigest>>>;
}

export interface NativeValueFixture extends ValueFixture {
  readonly owners: RowOwnership;
  readonly recording: SessionRecordingPort;
}

export async function withNativeValueFixture(
  action: (fixture: NativeValueFixture) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'native-compression-values-'));
  const {
    service: history,
    recording,
    ownership: owners,
  } = createCoreSuffixFixtureGraph(root, undefined, undefined);
  history.setTokenizerFactory(exactTokenizer());
  try {
    await action({
      history,
      owners,
      recording,
      durable: async () => {
        await history.waitForCommit();
        const path = recording.getFilePath();
        if (path === null) throw new Error('Missing native value mirror');
        return compressionValueDigest(nativeFileRows(path));
      },
    });
  } finally {
    await history.dispose();
    await recording.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}
