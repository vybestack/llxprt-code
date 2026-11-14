import { createTestScratchOwner } from '@vybestack/llxprt-code-core/storage/__tests__/support/scratch-owner.js';
import { testJournalOptions } from '../../../__tests__/support/named-writer-owner.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect, spyOn } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { open } from 'node:fs/promises';

import { join } from 'node:path';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { TRAILER_RECORD_BYTES } from '@vybestack/llxprt-code-core/journal/trailerRecord.js';
import { nativeFileRows } from '../../../compression/__tests__/support/native-file-rows.js';
const testScratchRoots = createTestScratchOwner();

export function observeNativeDeferredAcknowledgement(options: {
  armed(): boolean;
  fail(): boolean;
  pause(): Promise<void>;
}): { restore(): void; verifyDurable(text: string): Promise<void> } {
  const directory = mkdtempSync(
    join(testScratchRoots.getRoot(), 'native-deferred-ack-'),
  );
  let index = 0;
  const opener = spyOn(JournalSession, 'createUnlinked').mockImplementation(
    async () =>
      JournalSession.create(
        join(directory, `candidate-${index++}.llxj`),
        testJournalOptions({
          journal: {
            open: async (path, flags) => {
              const handle = await open(path, flags);
              return {
                fd: handle.fd,
                read: (...args) => handle.read(...args),
                writev: (buffers, position) =>
                  handle.writev([...buffers], position),
                stat: () => handle.stat(),
                truncate: (length) => handle.truncate(length),
                close: () => handle.close(),
                write: async (buffer, offset, length, position) => {
                  if (length === TRAILER_RECORD_BYTES && options.armed()) {
                    if (options.fail())
                      throw new Error('final write acknowledgement failed');
                    await options.pause();
                  }
                  return handle.write(buffer, offset, length, position);
                },
              };
            },
          },
        }),
      ),
  );
  return {
    restore: () => opener.mockRestore(),
    verifyDurable: async (text): Promise<void> => {
      let count = 0;
      for await (const row of nativeFileRows(
        join(directory, `candidate-${index - 1}.llxj`),
      )) {
        expect(row.blocks).toStrictEqual([{ type: 'text', text }]);
        count++;
      }
      expect(count).toBe(1);
    },
  };
}
