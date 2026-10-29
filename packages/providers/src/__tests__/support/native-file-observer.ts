/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as promises from 'node:fs/promises';

function creates(flags: unknown): boolean {
  return typeof flags === 'number'
    ? (flags & fs.constants.O_CREAT) !== 0
    : typeof flags === 'string' && /[wa]/.test(flags);
}

export function observeNativeFileCreates(): {
  count(): number;
  restore(): void;
} {
  const writes = [
    spyOn(fs, 'mkdirSync'),
    spyOn(fs, 'mkdtempSync'),
    spyOn(fs, 'mkdir'),
    spyOn(fs, 'mkdtemp'),
    spyOn(promises, 'mkdir'),
    spyOn(promises, 'mkdtemp'),
    spyOn(fs, 'writeFileSync'),
    spyOn(fs, 'appendFileSync'),
    spyOn(fs, 'writeFile'),
    spyOn(fs, 'appendFile'),
    spyOn(promises, 'writeFile'),
    spyOn(promises, 'appendFile'),
  ];
  const opens = [
    spyOn(fs, 'openSync'),
    spyOn(fs, 'open'),
    spyOn(promises, 'open'),
  ];
  return {
    count: () =>
      writes.reduce((sum, spy) => sum + spy.mock.calls.length, 0) +
      opens.reduce(
        (sum, spy) =>
          sum + spy.mock.calls.filter(([, flags]) => creates(flags)).length,
        0,
      ),
    restore(): void {
      for (const spy of [...writes, ...opens]) spy.mockRestore();
    },
  };
}
