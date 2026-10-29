/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DebugLogger } from '../debug/index.js';

const logger = new DebugLogger('llxprt:storage:scratch-root');

/**
 * Process-owned scratch root (issue #854).
 *
 * Every disk scratch directory the product creates lives under one directory,
 * `<tmpdir>/llxprt-scratch-<pid>-<random>`, so a single exit hook removes all
 * of it and a later process can reclaim the roots of processes that were
 * killed before they could clean up. The first root a process creates also
 * sweeps the dead roots left by earlier processes, once per process.
 */
const ROOT_PREFIX = 'llxprt-scratch-';
const ROOT_NAME = /^llxprt-scratch-(\d+)-[A-Za-z0-9]{6}$/;

let root: string | undefined;
let exitHookInstalled = false;
let swept = false;

export function getScratchRoot(): string {
  if (root === undefined) {
    root = fs.mkdtempSync(join(tmpdir(), `${ROOT_PREFIX}${process.pid}-`));
    if (!exitHookInstalled) {
      exitHookInstalled = true;
      process.once('exit', removeScratchRoot);
    }
    if (!swept) {
      swept = true;
      sweepDeadScratchRoots();
    }
  }
  return root;
}

export function createScratchDirSync(prefix: string): string {
  return fs.mkdtempSync(join(getScratchRoot(), prefix));
}

export function createScratchDir(prefix: string): Promise<string> {
  return mkdtemp(join(getScratchRoot(), prefix));
}

/** Removes this process's scratch root. A later use creates a fresh root. */
export function removeScratchRoot(): void {
  if (root === undefined) return;
  const owned = root;
  root = undefined;
  fs.rmSync(owned, { recursive: true, force: true });
}

/**
 * Removes a scratch directory whose complete contents the caller created:
 * the named files, then the directory itself. It issues plain unlink and
 * rmdir calls instead of a recursive walk, so a failure reports its real
 * errno (Bun 1.3.x reports several recursive-walk failures as EFAULT) and an
 * entry the caller did not create is an error rather than silently deleted.
 * A missing path is not an error: `removeScratchRoot` may have already
 * removed the whole root.
 */
export function removeScratchDir(
  directory: string,
  files: readonly string[],
): void {
  for (const file of files)
    ignoreMissing(() => fs.unlinkSync(join(directory, file)));
  ignoreMissing(() => fs.rmdirSync(directory));
}

function ignoreMissing(remove: () => void): void {
  try {
    remove();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    // EPERM: the process exists but belongs to another user.
    return true;
  }
}

/**
 * Deletes scratch roots in `directory` whose owning pid no longer exists.
 * Only entries matching the exact root naming pattern are considered.
 * Entries that cannot be removed are logged and skipped.
 * Returns the names removed.
 */
export function sweepDeadScratchRoots(
  directory: string = tmpdir(),
  alive: (pid: number) => boolean = isProcessAlive,
): string[] {
  const removed: string[] = [];
  for (const name of fs.readdirSync(directory)) {
    const match = ROOT_NAME.exec(name);
    if (match !== null && !alive(Number(match[1]))) {
      try {
        fs.rmSync(join(directory, name), { recursive: true, force: true });
        removed.push(name);
      } catch (error) {
        // OS-level variance (EBUSY on Windows, permissions): one stuck root
        // must not block the others or abort startup.
        logger.debug(
          () => `Could not remove dead scratch root ${name}:`,
          error,
        );
      }
    }
  }
  return removed;
}
