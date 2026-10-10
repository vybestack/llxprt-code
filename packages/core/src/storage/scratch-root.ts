/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Process-owned scratch root (issue #854).
 *
 * Every disk scratch directory the product creates lives under one directory,
 * `<tmpdir>/llxprt-scratch-<pid>-<random>`, so a single exit hook removes all
 * of it and a later process can reclaim the roots of processes that were
 * killed before they could clean up.
 */
const ROOT_PREFIX = 'llxprt-scratch-';
const ROOT_NAME = /^llxprt-scratch-(\d+)-[A-Za-z0-9]{6}$/;

let root: string | undefined;
let exitHookInstalled = false;

export function getScratchRoot(): string {
  if (root === undefined) {
    root = fs.mkdtempSync(join(tmpdir(), `${ROOT_PREFIX}${process.pid}-`));
    if (!exitHookInstalled) {
      exitHookInstalled = true;
      process.once('exit', removeScratchRoot);
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
      fs.rmSync(join(directory, name), { recursive: true, force: true });
      removed.push(name);
    }
  }
  return removed;
}
