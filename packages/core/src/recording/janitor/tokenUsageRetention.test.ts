/**
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4068: the session janitor also retires per-session token-usage logs.
 * Real files in a real temp tree, the real session lock manager, and the real
 * janitor entry point.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionLockManager } from '../SessionLockManager.js';
import { resolveRetentionConfig } from './retentionPolicy.js';
import { runSessionCleanup } from './sessionJanitor.js';
import { cleanupTokenUsageFiles } from './tokenUsageRetention.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PROJECT = 'a'.repeat(64);
const OTHER_PROJECT = 'b'.repeat(64);

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'token-retention-'));
  roots.push(root);
  return root;
}

/** Write `bytes` bytes to `<root>/<project>/<sub>/<name>` aged `ageDays`. */
async function writeAged(
  root: string,
  project: string,
  sub: string,
  name: string,
  bytes: number,
  ageDays: number,
): Promise<string> {
  const dir = path.join(root, project, sub);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await fs.writeFile(file, 'x'.repeat(bytes));
  const when = new Date(Date.now() - ageDays * DAY_MS);
  await fs.utimes(file, when, when);
  return file;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch {
    return false;
  }
}

describe('token-usage retention (#4068)', () => {
  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true })),
    );
  });

  it('deletes token-usage files past the chat age policy and removes the emptied directory', async () => {
    const root = await tempRoot();
    const stale = await writeAged(
      root,
      PROJECT,
      'token-usage',
      's1.jsonl',
      10,
      9,
    );
    const fresh = await writeAged(
      root,
      OTHER_PROJECT,
      'token-usage',
      's2.jsonl',
      10,
      2,
    );

    const result = await cleanupTokenUsageFiles(
      root,
      undefined,
      resolveRetentionConfig({ maxAge: '7d' }),
    );

    expect(await exists(stale)).toBe(false);
    expect(await exists(path.join(root, PROJECT, 'token-usage'))).toBe(false);
    expect(await exists(fresh)).toBe(true);
    expect(result).toStrictEqual({
      scanned: 2,
      deleted: 1,
      bytesDeleted: 10,
      failed: 0,
    });
  });

  it('enforces the byte budget oldest first across projects, counting protected files toward the total', async () => {
    const root = await tempRoot();
    const MIB = 1024 * 1024;
    const oldest = await writeAged(
      root,
      PROJECT,
      'token-usage',
      'old.jsonl',
      MIB,
      6,
    );
    const middle = await writeAged(
      root,
      OTHER_PROJECT,
      'token-usage',
      'mid.jsonl',
      MIB,
      4,
    );
    const newest = await writeAged(
      root,
      PROJECT,
      'token-usage',
      'new.jsonl',
      MIB,
      2,
    );
    // Written moments ago: inside the 1d minRetention floor, so protected,
    // but its bytes still count toward the budget.
    const recent = await writeAged(
      root,
      PROJECT,
      'token-usage',
      'now.jsonl',
      MIB,
      0,
    );

    await cleanupTokenUsageFiles(
      root,
      undefined,
      resolveRetentionConfig({ tokenUsageMaxTotalSizeMB: 2 }),
    );

    expect(await exists(oldest)).toBe(false);
    expect(await exists(middle)).toBe(false);
    expect(await exists(newest)).toBe(true);
    expect(await exists(recent)).toBe(true);
  });

  it('never deletes files of an active session: the current session, a live-locked root session, or its subagents', async () => {
    const root = await tempRoot();
    const chats = path.join(root, PROJECT, 'chats');
    await fs.mkdir(chats, { recursive: true });
    const lock = await SessionLockManager.acquire(chats, 'locked-root');
    try {
      const lockedRoot = await writeAged(
        root,
        PROJECT,
        'token-usage',
        'locked-root.jsonl',
        10,
        30,
      );
      const lockedChild = await writeAged(
        root,
        PROJECT,
        'token-usage',
        'locked-root::locked-root#coder#11012e6c.jsonl',
        10,
        30,
      );
      const current = await writeAged(
        root,
        PROJECT,
        'token-usage',
        'current-root::current-root#helper#ab12cd34.jsonl',
        10,
        30,
      );
      const idleChild = await writeAged(
        root,
        PROJECT,
        'token-usage',
        'idle-root::idle-root#coder#99999999.jsonl',
        10,
        30,
      );

      await cleanupTokenUsageFiles(
        root,
        'current-root',
        resolveRetentionConfig({ maxAge: '7d', tokenUsageMaxTotalSizeMB: 1 }),
      );

      expect(await exists(lockedRoot)).toBe(true);
      expect(await exists(lockedChild)).toBe(true);
      expect(await exists(current)).toBe(true);
      expect(await exists(idleChild)).toBe(false);
    } finally {
      await lock.release();
    }
  });

  it('runs inside the janitor sweep without touching chat recordings beyond the existing rules', async () => {
    const root = await tempRoot();
    const tokenLog = await writeAged(
      root,
      PROJECT,
      'token-usage',
      'gone.jsonl',
      10,
      40,
    );
    // Not a session recording by name, so the chat rules leave it alone even
    // though it is older than maxAge.
    const chatNote = await writeAged(
      root,
      PROJECT,
      'chats',
      'notes.txt',
      10,
      40,
    );
    // A recording inside maxAge is kept by the chat rules.
    const recording = await writeAged(
      root,
      PROJECT,
      'chats',
      'session-2026-11-11T13-00-57-b1c9a078.jsonl',
      10,
      2,
    );

    const result = await runSessionCleanup({
      globalTempDir: root,
      config: resolveRetentionConfig({ maxAge: '30d' }),
      quiet: true,
    });

    expect(result.failed).toBe(0);
    expect(await exists(tokenLog)).toBe(false);
    expect(await fs.readFile(chatNote, 'utf8')).toBe('x'.repeat(10));
    expect(await fs.readFile(recording, 'utf8')).toBe('x'.repeat(10));
  });

  it('keeps everything when no age limit is set and the budget is not exceeded', async () => {
    const root = await tempRoot();
    const old = await writeAged(
      root,
      PROJECT,
      'token-usage',
      'old.jsonl',
      10,
      400,
    );

    await cleanupTokenUsageFiles(
      root,
      undefined,
      resolveRetentionConfig(undefined),
    );

    expect(await exists(old)).toBe(true);
  });
});
