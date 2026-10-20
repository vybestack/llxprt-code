/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as promises from 'node:fs/promises';

export interface OperationFileCreates {
  readonly directories: string[];
  readonly files: string[];
}

function creates(flags: unknown): boolean {
  return typeof flags === 'number'
    ? (flags & fs.constants.O_CREAT) !== 0
    : typeof flags === 'string' && /[wa]/.test(flags);
}

export async function operationFileCreates(
  action: () => Promise<void>,
): Promise<OperationFileCreates> {
  const mkdirSync = spyOn(fs, 'mkdirSync');
  const mkdtempSync = spyOn(fs, 'mkdtempSync');
  const mkdir = spyOn(promises, 'mkdir');
  const mkdtemp = spyOn(promises, 'mkdtemp');
  const openSync = spyOn(fs, 'openSync');
  const open = spyOn(promises, 'open');
  const writeFileSync = spyOn(fs, 'writeFileSync');
  const writeFile = spyOn(promises, 'writeFile');
  const appendFileSync = spyOn(fs, 'appendFileSync');
  const appendFile = spyOn(promises, 'appendFile');
  const callbackMkdir = spyOn(fs, 'mkdir');
  const callbackMkdtemp = spyOn(fs, 'mkdtemp');
  const callbackOpen = spyOn(fs, 'open');
  const callbackWriteFile = spyOn(fs, 'writeFile');
  const callbackAppendFile = spyOn(fs, 'appendFile');
  try {
    await action();
    return {
      directories: [
        ...mkdirSync.mock.calls,
        ...mkdtempSync.mock.calls,
        ...mkdir.mock.calls,
        ...mkdtemp.mock.calls,
        ...callbackMkdir.mock.calls,
        ...callbackMkdtemp.mock.calls,
      ].map(([path]) => String(path)),
      files: [
        ...openSync.mock.calls.filter(([, flags]) => creates(flags)),
        ...open.mock.calls.filter(([, flags]) => creates(flags)),
        ...callbackOpen.mock.calls.filter(([, flags]) => creates(flags)),
        ...writeFileSync.mock.calls,
        ...writeFile.mock.calls,
        ...appendFileSync.mock.calls,
        ...appendFile.mock.calls,
        ...callbackWriteFile.mock.calls,
        ...callbackAppendFile.mock.calls,
      ].map(([path]) => String(path)),
    };
  } finally {
    for (const spy of [
      mkdirSync,
      mkdtempSync,
      mkdir,
      mkdtemp,
      openSync,
      open,
      writeFileSync,
      writeFile,
      appendFileSync,
      appendFile,
      callbackMkdir,
      callbackMkdtemp,
      callbackOpen,
      callbackWriteFile,
      callbackAppendFile,
    ])
      spy.mockRestore();
  }
}
