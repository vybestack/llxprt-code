/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';
import { SessionLockManager } from './SessionLockManager.js';
import {
  isJournalFileName,
  sessionFileExtension,
} from './sessionFileExtension.js';
import { useBackendEnv } from './__tests__/support/backendEnv.js';

describe('the session file extension is one function of the backend', () => {
  const setBackend = useBackendEnv();

  it('names the extension each backend writes', () => {
    expect(sessionFileExtension('old')).toBe('.jsonl');
    expect(sessionFileExtension('journal')).toBe('.llxj');
  });

  it('recognises journal files and their archives', () => {
    expect(isJournalFileName('session-a.llxj')).toBe(true);
    expect(isJournalFileName('session-a.llxj.gz')).toBe(true);
    expect(isJournalFileName('session-a.jsonl')).toBe(false);
    expect(isJournalFileName('session-a.jsonl.gz')).toBe(false);
  });

  it('derives the lock path from a file of the current backend only', () => {
    const dir = path.join('/tmp', 'chats');
    setBackend('old');
    expect(
      SessionLockManager.getLockPathFromFilePath(`${dir}/session-abc.jsonl`),
    ).toBe(path.join(dir, 'abc.lock'));
    expect(() =>
      SessionLockManager.getLockPathFromFilePath(`${dir}/session-abc.llxj`),
    ).toThrow('Cannot extract session ID');

    setBackend('journal');
    expect(
      SessionLockManager.getLockPathFromFilePath(`${dir}/session-abc.llxj`),
    ).toBe(path.join(dir, 'abc.lock'));
    expect(() =>
      SessionLockManager.getLockPathFromFilePath(`${dir}/session-abc.jsonl`),
    ).toThrow('Cannot extract session ID');
  });
});
