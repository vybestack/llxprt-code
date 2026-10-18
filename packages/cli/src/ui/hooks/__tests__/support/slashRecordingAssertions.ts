/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, expect, spyOn } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { debugLogger } from '@vybestack/llxprt-code-core';
import { readJournalFileFacts } from '@vybestack/llxprt-code-core/recording/journalSessionListing.js';

export async function assertNativeSlashEvent(
  path: string,
  before: Uint8Array,
  message: string,
  logs: readonly string[],
): Promise<void> {
  expect(new Uint8Array(await readFile(path))).toStrictEqual(
    new Uint8Array(before),
  );
  const expected = `[SessionRecording] error: ${message}`;
  expect(logs.filter((entry) => entry === expected)).toStrictEqual([expected]);
}

export async function assertJsonlSlashEvent(
  path: string,
  _before: Uint8Array,
  message: string,
  _logs: readonly string[],
): Promise<void> {
  expect((await readFile(path, 'utf8')).split(message)).toHaveLength(2);
}

export async function assertNativeDirectories(
  path: string,
  addedDirectory: string,
): Promise<void> {
  const found = await readJournalFileFacts(path);
  expect(
    found?.facts.directories.filter(
      (directory) => directory === addedDirectory,
    ),
  ).toStrictEqual([addedDirectory]);
}

export async function assertJsonlDirectories(
  path: string,
  addedDirectory: string,
): Promise<void> {
  const lines = (await readFile(path, 'utf8')).split('\n');
  expect(
    lines.filter((line) => line.includes('directories_changed')),
  ).toHaveLength(1);
  expect(lines.join('\n')).toContain(addedDirectory);
}

export function useRecordingLogCapture(): () => string[] {
  let restoreLog: (() => void) | undefined;
  afterEach(() => {
    restoreLog?.();
    restoreLog = undefined;
  });
  function captureRecordingLog(): string[] {
    const entries: string[] = [];
    const spy = spyOn(debugLogger, 'log').mockImplementation(
      (...values: unknown[]) => {
        if (typeof values[0] === 'string') entries.push(values[0]);
      },
    );
    restoreLog = () => spy.mockRestore();
    return entries;
  }
  return captureRecordingLog;
}
