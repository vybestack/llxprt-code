/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';
import { SessionLockManager } from './SessionLockManager.js';
import {
  isJournalFileName,
  RETIRED_SESSION_EXTENSION,
  SESSION_FILE_EXTENSION,
} from './sessionFileExtension.js';

describe('journal session file names', () => {
  it('uses the journal extension and identifies the retired extension separately', () => {
    expect(SESSION_FILE_EXTENSION).toBe('.llxj');
    expect(RETIRED_SESSION_EXTENSION).toBe('.jsonl');
  });

  it('recognises journal files and their archives', () => {
    expect(isJournalFileName('session-a.llxj')).toBe(true);
    expect(isJournalFileName('session-a.llxj.gz')).toBe(true);
    expect(isJournalFileName('session-a.jsonl')).toBe(false);
    expect(isJournalFileName('session-a.jsonl.gz')).toBe(false);
  });

  it('derives a lock path only from journal session files', () => {
    const dir = path.join('/tmp', 'chats');
    expect(
      SessionLockManager.getLockPathFromFilePath(`${dir}/session-abc.llxj`),
    ).toBe(path.join(dir, 'abc.lock'));
    expect(() =>
      SessionLockManager.getLockPathFromFilePath(`${dir}/session-abc.jsonl`),
    ).toThrow('Cannot extract session ID');
  });
});
