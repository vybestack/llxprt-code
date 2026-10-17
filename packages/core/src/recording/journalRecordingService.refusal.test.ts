/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { RetiredJournalError } from '../journal/errors.js';
import { encodeJournalHeader } from '../journal/fileHeader.js';
import { retiredJournalMessage } from '../journal/journalRefusal.js';
import { testJournalSeams } from '../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import {
  JournalRecordingService,
  type JournalRecordingConfig,
} from './journalRecordingService.js';
import { SessionLockManager } from './SessionLockManager.js';

function wrongVersionHeader(): Uint8Array {
  const bytes = encodeJournalHeader({
    fileId: new Uint8Array(16),
    syncMarker: new Uint8Array(8).fill(1),
    createdAtMs: 1,
  });
  bytes[8] = 2;
  return bytes;
}

const RETIRED_FILES: ReadonlyArray<
  readonly [string, string, () => Uint8Array | string]
> = [
  [
    'a JSONL session',
    'session-2026-01-01T00-00-00-a-aaaaaaaa.jsonl',
    () =>
      '{"v":2,"seq":1,"type":"session_start","payload":{"sessionId":"s"}}\n',
  ],
  [
    'a file with another magic',
    'session-b.llxj',
    () => new Uint8Array(100).fill(0x41),
  ],
  ['a file of an older format version', 'session-c.llxj', wrongVersionHeader],
];

describe('opening a retired session file', () => {
  const directory = useTempDir('journal-recording-refusal-');

  function config(): JournalRecordingConfig {
    return {
      sessionId: 'session-aaaaaaaa-1111',
      projectHash: 'project',
      chatsDir: path.join(directory(), 'chats'),
      workspaceDirs: ['/work/a'],
      provider: 'anthropic',
      model: 'model-1',
      journal: { journal: testJournalSeams().dependencies },
    };
  }

  for (const [label, name, content] of RETIRED_FILES) {
    it(`refuses ${label} with the one message and leaves the file as it was`, async () => {
      const settings = config();
      await fsp.mkdir(settings.chatsDir, { recursive: true });
      const file = path.join(settings.chatsDir, name);
      await fsp.writeFile(file, content());
      const before = await fsp.readFile(file);

      const failure = await JournalRecordingService.open(settings, file).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(RetiredJournalError);
      expect(failure instanceof Error && failure.message).toBe(
        retiredJournalMessage(file),
      );
      expect(await fsp.readFile(file)).toStrictEqual(before);
      expect(
        await SessionLockManager.isLocked(
          settings.chatsDir,
          settings.sessionId,
        ),
      ).toBe(false);
    });
  }
});
