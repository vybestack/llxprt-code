/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { JournalFormatError } from './errors.js';

const writers = new Set<string>();

export async function retainNamedWriter(
  file: string,
  creating: boolean,
): Promise<() => void> {
  const identity = creating
    ? join(await realpath(dirname(file)), basename(file))
    : await realpath(file);
  if (writers.has(identity))
    throw new JournalFormatError(`The journal ${file} already has a writer`);
  writers.add(identity);
  let released = false;
  return (): void => {
    if (released) return;
    released = true;
    writers.delete(identity);
  };
}
