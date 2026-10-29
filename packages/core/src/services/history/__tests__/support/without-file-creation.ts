/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spyOn } from 'bun:test';
import * as fs from 'node:fs';

export async function withoutFileCreation(
  action: () => Promise<void>,
): Promise<void> {
  const denied = (): never => {
    throw new Error('Operation attempted to create a file or directory');
  };
  const originalOpen = fs.promises.open;
  const guards = [
    spyOn(fs, 'mkdirSync').mockImplementation(denied),
    spyOn(fs, 'mkdtempSync').mockImplementation(denied),
    spyOn(fs, 'openSync').mockImplementation(denied),
    spyOn(fs, 'writeFileSync').mockImplementation(denied),
    spyOn(fs, 'appendFileSync').mockImplementation(denied),
    spyOn(fs.promises, 'mkdir').mockImplementation(denied),
    spyOn(fs.promises, 'mkdtemp').mockImplementation(denied),
    spyOn(fs.promises, 'writeFile').mockImplementation(denied),
    spyOn(fs.promises, 'appendFile').mockImplementation(denied),
    spyOn(fs.promises, 'open').mockImplementation((path, flags, mode) => {
      if (typeof flags === 'string' && /[wax]/.test(flags)) denied();
      if (typeof flags === 'number' && (flags & fs.constants.O_CREAT) !== 0)
        denied();
      return originalOpen(path, flags, mode);
    }),
  ];
  try {
    await action();
  } finally {
    for (const guard of guards) guard.mockRestore();
  }
}
