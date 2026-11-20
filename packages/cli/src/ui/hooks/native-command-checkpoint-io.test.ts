/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { dirname } from 'node:path';
import { readdir } from 'node:fs/promises';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { TRAILER_RECORD_BYTES } from '@vybestack/llxprt-code-core/journal/trailerRecord.js';
import { loadFlushRecords } from '@vybestack/llxprt-code-core/journal/flushRecords.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import {
  durable,
  nativeCommandFixture,
  recording,
  turn,
} from '../../__tests__/native-command-fixture.js';

describe('native CLI checkpoint child file failures', () => {
  for (const { stage, failures, message } of [
    {
      stage: 'write',
      failures: { failWriteAt: 0 },
      message: 'injected write failure',
    },
    {
      stage: 'pre-trailer-flush',
      failures: { failFlushAt: 0 },
      message: 'injected flush failure',
    },
    {
      stage: 'trailer-write',
      failures: {},
      message: 'injected trailer write failure',
    },
  ] as const) {
    it(`releases a prepared child after native ${stage} failure and continues the original recording`, async () => {
      const fixture = await nativeCommandFixture();
      try {
        await fixture.live.session.setRecording({ enabled: true });
        await turn(fixture.live, 'checkpoint source');
        await fixture.command('/chat save io-cut');
        const path = await recording(fixture.live);
        const before = {
          rows: await durable(path),
          files: (await readdir(dirname(path))).sort(),
        };
        const seams = testJournalSeams(failures);
        const flush = await loadFlushRecords();
        const open = JournalSession.open;
        const fault = vi
          .spyOn(JournalSession, 'open')
          .mockImplementation((file, options) =>
            open(file, {
              ...options,
              journal: {
                ...options?.journal,
                ...seams.dependencies,
                open: async (file, flags) => {
                  const handle = await seams.dependencies.open(file, flags);
                  return {
                    ...handle,
                    write: async (buffer, offset, length, position) => {
                      if (
                        stage === 'trailer-write' &&
                        length === TRAILER_RECORD_BYTES
                      )
                        throw new Error('injected trailer write failure');
                      return handle.write(buffer, offset, length, position);
                    },
                  };
                },
                flush: (fd): void => {
                  seams.dependencies.flush(fd);
                  flush(fd);
                },
              },
            }),
          );
        try {
          await fixture.command('/continue io-cut');
        } finally {
          fault.mockRestore();
        }
        expect(fixture.errors).toHaveLength(1);
        expect(
          fixture.errors
            .map((message) =>
              'content' in message ? message.content : message.type,
            )
            .join('; '),
        ).toContain(message);
        expect(fixture.live.session.getRecording()).toMatchObject({
          enabled: true,
          path,
        });
        expect(fixture.live.session.getSessionId()).toBe('cli-fault-current');
        expect(await durable(path)).toStrictEqual(before.rows);
        expect((await readdir(dirname(path))).sort()).toStrictEqual(
          before.files,
        );
        await turn(fixture.live, 'after child I/O failure');
        expect((await durable(await recording(fixture.live))).count).toBe(
          before.rows.count + 2,
        );
        await fixture.live.dispose();
        expect(
          (await readdir(dirname(path))).filter((file) =>
            file.endsWith('.lock'),
          ),
        ).toStrictEqual([]);
      } finally {
        await fixture.close();
      }
    }, 30000);
  }
});
