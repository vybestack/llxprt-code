/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test fixtures that make the operating system really refuse a filesystem
 * operation, so tests can exercise production failure handling against a
 * genuine OS error rather than a mocked throw.
 *
 * POSIX drops the owner's write bit on the directory. Windows ignores mode
 * bits entirely, so it gets explicit deny ACEs for the current user's SID
 * (icacls), which also bind an elevated token. Every denial is proven with a
 * probe that attempts the refused operation before the code under test runs,
 * so a fixture that silently denies nothing fails here with a clear message
 * instead of surfacing later as a confusing assertion.
 */

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';

const IS_WINDOWS = process.platform === 'win32';

let cachedSid: string | undefined;

/** SID of the user running the tests, as `whoami /user` reports it. */
function currentUserSid(): string {
  if (cachedSid !== undefined) return cachedSid;
  const output = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], {
    encoding: 'utf8',
  });
  const match = /S-1-\d+(?:-\d+)+/.exec(output);
  if (match === null) {
    throw new Error(`whoami /user returned no SID: ${output}`);
  }
  cachedSid = match[0];
  return cachedSid;
}

function icaclsDeny(target: string, rights: string): void {
  execFileSync(
    'icacls',
    [target, '/deny', `*${currentUserSid()}:(${rights})`],
    {
      stdio: 'pipe',
    },
  );
}

function icaclsRemoveDeny(target: string): void {
  execFileSync('icacls', [target, '/remove:d', `*${currentUserSid()}`], {
    stdio: 'pipe',
  });
}

/**
 * Renaming needs the same DELETE access as removing the file (DELETE on the
 * file or DELETE_CHILD on its parent), but leaves the file in place when the
 * denial works. If the rename succeeds the file is put back before throwing.
 */
function assertDeletionDenied(file: string): void {
  const probePath = `${file}.deletion-probe`;
  try {
    renameSync(file, probePath);
  } catch {
    return;
  }
  renameSync(probePath, file);
  throw new Error(`Deletion fixture did not deny removal of ${file}`);
}

function assertCreationDenied(directory: string): void {
  const probeDirectory = path.join(directory, 'creation-probe-directory');
  try {
    mkdirSync(probeDirectory);
  } catch {
    const probeFile = path.join(directory, 'creation-probe-file');
    try {
      closeSync(openSync(probeFile, 'wx'));
    } catch {
      return;
    }
    rmSync(probeFile, { force: true });
    throw new Error(`Creation fixture did not deny new files in ${directory}`);
  }
  rmSync(probeDirectory, { recursive: true, force: true });
  throw new Error(
    `Creation fixture did not deny new subdirectories in ${directory}`,
  );
}

/**
 * Makes removal of `file` (a direct child of `parent`) fail with a permission
 * error. Returns the function that lifts the denial; call it in `finally`
 * before any teardown that must delete the file.
 */
export function denyDeletion(file: string, parent: string): () => void {
  if (!IS_WINDOWS) {
    chmodSync(parent, 0o500);
    const restore = (): void => chmodSync(parent, 0o700);
    try {
      assertDeletionDenied(file);
    } catch (error) {
      restore();
      throw error;
    }
    return restore;
  }
  // Windows lets either DELETE on the file or DELETE_CHILD on the parent
  // authorise a removal, so both must be denied.
  const restore = (): void => {
    icaclsRemoveDeny(file);
    icaclsRemoveDeny(parent);
  };
  try {
    icaclsDeny(file, 'DE');
    icaclsDeny(parent, 'DC');
    assertDeletionDenied(file);
  } catch (error) {
    restore();
    throw error;
  }
  return restore;
}

/**
 * Makes creating files and subdirectories directly inside `directory` fail
 * with a permission error. Returns the function that lifts the denial.
 */
export function denyEntryCreation(directory: string): () => void {
  if (!IS_WINDOWS) {
    chmodSync(directory, 0o500);
    const restore = (): void => chmodSync(directory, 0o700);
    try {
      assertCreationDenied(directory);
    } catch (error) {
      restore();
      throw error;
    }
    return restore;
  }
  // WD/AD are "add file" / "add subdirectory" on a directory. No inheritance
  // flags, so only this directory is affected.
  const restore = (): void => icaclsRemoveDeny(directory);
  try {
    icaclsDeny(directory, 'WD,AD');
    assertCreationDenied(directory);
  } catch (error) {
    restore();
    throw error;
  }
  return restore;
}
