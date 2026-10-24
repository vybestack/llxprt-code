/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect, spyOn } from 'bun:test';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { nativeFileRows } from './native-file-rows.js';
import { compressionValueDigest } from '../compression-value-fixture.js';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import type { SessionRecordingPort } from '@vybestack/llxprt-code-core/recording/recordingPort.js';

export async function assertFallbackCommitted(
  history: HistoryService,
  recorder: SessionRecordingPort,
  root: string,
): Promise<void> {
  await history.waitForCommit();
  await recorder.flush();
  const path = recorder.getFilePath();
  if (path === null) throw new Error('Missing native fallback mirror');
  const live = await compressionValueDigest(history.streamRawHistory());
  expect(
    await compressionValueDigest(nativeFileRows(join(root, 'primary.llxj'))),
  ).toStrictEqual(live);
  expect(await compressionValueDigest(nativeFileRows(path))).toStrictEqual(
    live,
  );
}
export async function fallbackRecordingFault(root: string): Promise<{
  failure: Error;
  failAdmissionAfter(successes: number): void;
  attach<T>(create: () => T): T;
}> {
  let remaining: number | undefined;
  const failure = new Error('injected journal admission failure');
  const admit = (): void => {
    if (remaining === 0) {
      remaining = undefined;
      throw failure;
    }
    if (remaining !== undefined) remaining--;
  };
  const session = await JournalSession.create(join(root, 'primary.llxj'), {
    journal: {
      open: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          fd: handle.fd,
          read: (...args) => handle.read(...args),
          stat: () => handle.stat(),
          truncate: (length) => handle.truncate(length),
          close: () => handle.close(),
          write: (...args) => {
            admit();
            return handle.write(...args);
          },
          writev: (buffers, position) => {
            admit();
            return handle.writev([...buffers], position);
          },
        };
      },
    },
  });
  return {
    failure,
    failAdmissionAfter: (successes) => {
      remaining = successes;
    },
    attach: (create) => {
      const opener = spyOn(JournalSession, 'createUnlinked').mockResolvedValue(
        session,
      );
      try {
        return create();
      } finally {
        opener.mockRestore();
      }
    },
  };
}
