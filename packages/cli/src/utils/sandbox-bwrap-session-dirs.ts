/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import {
  buildCurrentSandboxOwner,
  parseSandboxOwner,
  sandboxOwnerIsDead,
  type SandboxOwnerMetadata,
} from './sandbox-owner-labels.js';

/** Prefix of the per-launch directory that holds the credential proxy socket. */
export const BWRAP_SESSION_DIR_PREFIX = 'llxprt-bwrap-';
/** Process-instance record that lets a later launch prove the owner is gone. */
export const BWRAP_SESSION_OWNER_FILE = 'owner.json';

/**
 * A directory with no owner record is either being created right now (the
 * record is written a few microseconds after mkdtemp) or predates owner
 * records. Younger than this it is left alone, which covers a launch that is
 * stalled on a loaded machine between the two steps.
 */
const UNOWNED_GRACE_MS = 10 * 60 * 1000;

/**
 * Creates the private directory for one launch and records the creating
 * process as its owner. SIGKILL gives the host no chance to remove the
 * directory, so the record is what lets the next launch tell a leaked
 * directory from a live session's.
 */
export function createBwrapSessionDir(root: string = os.tmpdir()): string {
  const sessionDir = fs.mkdtempSync(path.join(root, BWRAP_SESSION_DIR_PREFIX));
  try {
    fs.chmodSync(sessionDir, 0o700);
    fs.writeFileSync(
      path.join(sessionDir, BWRAP_SESSION_OWNER_FILE),
      JSON.stringify(buildCurrentSandboxOwner()),
      { mode: 0o600 },
    );
  } catch (error) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    throw error;
  }
  return sessionDir;
}

function readOwner(
  sessionDir: string,
): SandboxOwnerMetadata | 'unreadable' | 'absent' {
  let payload: string;
  try {
    payload = fs.readFileSync(
      path.join(sessionDir, BWRAP_SESSION_OWNER_FILE),
      'utf8',
    );
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
      ? 'absent'
      : 'unreadable';
  }
  return parseSandboxOwner(payload) ?? 'unreadable';
}

/** Paths that some process on this host has bound as a Unix socket. */
function boundUnixSocketPaths(): readonly string[] | undefined {
  try {
    return fs
      .readFileSync('/proc/net/unix', 'utf8')
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter((fields) => fields.length >= 8)
      .map((fields) => fields[7]);
  } catch {
    return undefined;
  }
}

function isUnownedSessionDirAbandoned(
  sessionDir: string,
  ageMs: number,
): boolean {
  if (ageMs < UNOWNED_GRACE_MS) return false;
  const bound = boundUnixSocketPaths();
  const prefix = `${sessionDir}${path.sep}`;
  return (
    bound !== undefined && !bound.some((socket) => socket.startsWith(prefix))
  );
}

function isStale(sessionDir: string, modifiedMs: number): boolean {
  const owner = readOwner(sessionDir);
  if (owner === 'unreadable') return false;
  if (owner === 'absent') {
    return isUnownedSessionDirAbandoned(sessionDir, Date.now() - modifiedMs);
  }
  return sandboxOwnerIsDead(owner);
}

function reapIfStale(root: string, entry: string): void {
  const sessionDir = path.join(root, entry);
  try {
    // lstat keeps a planted symbolic link from redirecting the removal.
    const stat = fs.lstatSync(sessionDir);
    if (!stat.isDirectory()) return;
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
      return;
    }
    if (isStale(sessionDir, stat.mtimeMs)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  } catch (error) {
    debugLogger.warn(
      `Could not reap stale bwrap session directory ${sessionDir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Removes session directories left by hosts that are provably gone: SIGKILL,
 * an OOM kill or a crash, none of which run the host's own cleanup. A
 * directory is removed only when its recorded owner is dead (same host, no
 * such process or a different process start time), or when it has no owner
 * record, is older than {@link UNOWNED_GRACE_MS} and no process listens on
 * its socket. Anything else is a live session or cannot be judged and stays.
 * Failures are logged and never block the launch.
 */
export function reapStaleBwrapSessionDirs(root: string = os.tmpdir()): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith(BWRAP_SESSION_DIR_PREFIX)) reapIfStale(root, entry);
  }
}
