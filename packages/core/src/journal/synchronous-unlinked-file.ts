/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JournalFileHandle } from './positionalFile.js';

export function openSynchronousUnlinkedFile(
  directory = tmpdir(),
): JournalFileHandle {
  const path = join(directory, `llxprt-journal-${randomUUID()}`);
  const temporary = process.platform === 'win32';
  const constants: Readonly<Record<string, number | undefined>> = fs.constants;
  const temporaryFlag = constants.UV_FS_O_TEMPORARY;
  if (temporary && temporaryFlag === undefined)
    throw new Error('UV_FS_O_TEMPORARY is unavailable');
  const flags =
    fs.constants.O_RDWR |
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    (temporary ? (temporaryFlag ?? 0) : 0);
  const fd = fs.openSync(path, flags, 0o600);
  try {
    if (!temporary) fs.unlinkSync(path);
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
  return {
    fd,
    read: (buffer, offset, length, position) =>
      new Promise((resolve, reject) => {
        fs.read(fd, buffer, offset, length, position, (error, bytesRead) => {
          if (error) reject(error);
          else resolve({ bytesRead });
        });
      }),
    write: (buffer, offset, length, position) =>
      new Promise((resolve, reject) => {
        fs.write(
          fd,
          buffer,
          offset,
          length,
          position,
          (error, bytesWritten) => {
            if (error) reject(error);
            else resolve({ bytesWritten });
          },
        );
      }),
    writev: (buffers, position) =>
      new Promise((resolve, reject) => {
        fs.writev(fd, [...buffers], position, (error, bytesWritten) => {
          if (error) reject(error);
          else resolve({ bytesWritten });
        });
      }),
    stat: () =>
      new Promise((resolve, reject) => {
        fs.fstat(fd, (error, stat) => {
          if (error) reject(error);
          else resolve(stat);
        });
      }),
    truncate: (length) =>
      new Promise((resolve, reject) => {
        fs.ftruncate(fd, length, (error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
    close: () =>
      new Promise((resolve, reject) => {
        fs.close(fd, (error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
