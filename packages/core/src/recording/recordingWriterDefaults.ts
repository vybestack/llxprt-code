/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs/promises';
import type { RecordingWriterIo } from './types.js';

/** Default write seam: journal appends go through `fs/promises.appendFile`. */
export const defaultWriterIo: RecordingWriterIo = {
  appendFile(filePath, data, encoding) {
    return fs.appendFile(filePath, data, encoding);
  },
};

/** Whether a write error indicates disk space or permission issues. */
export function isDiskSpaceError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOSPC' || code === 'EACCES';
}
