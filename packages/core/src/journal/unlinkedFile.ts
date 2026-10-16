/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface UnlinkedFileDependencies {
  readonly platform: NodeJS.Platform;
  readonly constants: Readonly<Record<string, number | undefined>>;
  readonly directory: string;
  readonly open: (
    filePath: string,
    flags: number,
    mode: number,
  ) => Promise<fsp.FileHandle>;
  readonly unlink: (filePath: string) => Promise<void>;
}

const PRIVATE_FILE_MODE = 0o600;

function requireConstant(
  constants: Readonly<Record<string, number | undefined>>,
  name: string,
): number {
  const value = constants[name];
  if (value === undefined) {
    throw new Error(
      `fs.constants.${name} is not available; cannot open an unlinked journal file`,
    );
  }
  return value;
}

function defaultDependencies(): UnlinkedFileDependencies {
  return {
    platform: process.platform,
    constants: { ...fs.constants },
    directory: os.tmpdir(),
    open: (filePath, flags, mode) => fsp.open(filePath, flags, mode),
    unlink: (filePath) => fsp.unlink(filePath),
  };
}

/**
 * A read-write file with no name, for the bare history store (design 4.12 and
 * 12). On POSIX the file is created exclusively and unlinked at once. On
 * Windows it is opened with `UV_FS_O_TEMPORARY`, which deletes it when the last
 * handle closes; the constant is absent from `fs.constants` elsewhere, and
 * missing on win32 is an error, not a reason to leave a file behind. No
 * directory is created.
 */
export async function openUnlinkedFile(
  overrides: Partial<UnlinkedFileDependencies> = {},
): Promise<fsp.FileHandle> {
  const deps = { ...defaultDependencies(), ...overrides };
  const { constants } = deps;
  const isWindows = deps.platform === 'win32';
  const baseFlags =
    requireConstant(constants, 'O_RDWR') |
    requireConstant(constants, 'O_CREAT') |
    requireConstant(constants, 'O_EXCL');
  const flags = isWindows
    ? baseFlags | requireConstant(constants, 'UV_FS_O_TEMPORARY')
    : baseFlags;
  const filePath = path.join(deps.directory, `llxprt-journal-${randomUUID()}`);
  const handle = await deps.open(filePath, flags, PRIVATE_FILE_MODE);
  if (isWindows) return handle;
  try {
    await deps.unlink(filePath);
  } catch (error) {
    await handle.close();
    throw error;
  }
  return handle;
}
