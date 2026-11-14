/**
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4068: token-usage retention must not delete a log whose session
 * becomes live, or whose file changes, after the scan selected it. The
 * injected beforeDelete hook opens the window deterministically; everything
 * else is real: files in a temp tree, the real SessionLockManager, the real
 * cleanup.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionLockManager, type LockHandle } from '../SessionLockManager.js';
import { resolveRetentionConfig } from './retentionPolicy.js';
import { cleanupTokenUsageFiles } from './tokenUsageRetention.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PROJECT = 'c'.repeat(64);
const AGED = new Date(Date.now() - 30 * DAY_MS);
const CONFIG = resolveRetentionConfig({ maxAge: '7d' });

const roots: string[] = [];
const locks: LockHandle[] = [];

interface Tree {
  readonly root: string;
  readonly chats: string;
  readonly tokenDir: string;
}

async function newTree(): Promise<Tree> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'token-race-'));
  roots.push(root);
  const chats = path.join(root, PROJECT, 'chats');
  const tokenDir = path.join(root, PROJECT, 'token-usage');
  await fs.mkdir(chats, { recursive: true });
  await fs.mkdir(tokenDir, { recursive: true });
  return { root, chats, tokenDir };
}

/** A 30-day-old log, well past the 7d age policy and the minRetention floor. */
async function writeAgedLog(tree: Tree, name: string): Promise<string> {
  const file = path.join(tree.tokenDir, name);
  await fs.writeFile(file, '{"record_type":"turn"}\n');
  await fs.utimes(file, AGED, AGED);
  return file;
}

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

describe('token-usage retention races (#4068)', () => {
  afterEach(async () => {
    for (const lock of locks.splice(0)) await lock.release();
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true })),
    );
  });

  it('keeps a root log when its session takes the lock after the scan', async () => {
    const tree = await newTree();
    const log = await writeAgedLog(tree, 'late-root.jsonl');
    const beforeDelete = async () => {
      locks.push(await SessionLockManager.acquire(tree.chats, 'late-root'));
    };

    const result = await cleanupTokenUsageFiles(tree.root, undefined, CONFIG, {
      beforeDelete,
    });

    expect(await readIfPresent(log)).toBe('{"record_type":"turn"}\n');
    expect(result).toStrictEqual({
      scanned: 1,
      deleted: 0,
      bytesDeleted: 0,
      failed: 0,
    });
    // The session that took the lock still owns it.
    expect(await locks[0].ownsLock()).toBe(true);
  });

  // Windows cannot create '::' file names; see #4104
  it.skipIf(process.platform === 'win32')(
    'keeps a subagent log when its root session takes the lock after the scan',
    async () => {
      const tree = await newTree();
      const log = await writeAgedLog(
        tree,
        'late-root::late-root#coder#11012e6c.jsonl',
      );
      const beforeDelete = async () => {
        locks.push(await SessionLockManager.acquire(tree.chats, 'late-root'));
      };

      const result = await cleanupTokenUsageFiles(
        tree.root,
        undefined,
        CONFIG,
        {
          beforeDelete,
        },
      );

      expect(await readIfPresent(log)).toBe('{"record_type":"turn"}\n');
      expect(result.deleted).toBe(0);
      expect(result.failed).toBe(0);
    },
  );

  it('keeps a log that a session appended to after the scan', async () => {
    const tree = await newTree();
    const log = await writeAgedLog(tree, 'appending.jsonl');
    const beforeDelete = async (filePath: string) => {
      await fs.appendFile(filePath, '{"record_type":"turn","n":2}\n');
    };

    const result = await cleanupTokenUsageFiles(tree.root, undefined, CONFIG, {
      beforeDelete,
    });

    expect(await readIfPresent(log)).toBe(
      '{"record_type":"turn"}\n{"record_type":"turn","n":2}\n',
    );
    expect(result.deleted).toBe(0);
  });

  it('keeps a log that was replaced after the scan, even with the same size and mtime', async () => {
    const tree = await newTree();
    const log = await writeAgedLog(tree, 'replaced.jsonl');
    const beforeDelete = async (filePath: string) => {
      // Created before the rename frees the old inode, so the replacement
      // cannot reuse it; same length and mtime leave the inode as the only
      // difference.
      const staged = `${filePath}.staged`;
      await fs.writeFile(staged, '{"record_type":"TURN"}\n');
      await fs.utimes(staged, AGED, AGED);
      await fs.rename(staged, filePath);
    };

    const result = await cleanupTokenUsageFiles(tree.root, undefined, CONFIG, {
      beforeDelete,
    });

    expect(await readIfPresent(log)).toBe('{"record_type":"TURN"}\n');
    expect(result.deleted).toBe(0);
  });

  // Windows cannot create '::' file names; see #4104
  it.skipIf(process.platform === 'win32')(
    'still deletes an idle aged log and leaves its session lock free',
    async () => {
      const tree = await newTree();
      const log = await writeAgedLog(
        tree,
        'idle-root::idle-root#helper#ab12cd34.jsonl',
      );
      let hookRan = false;
      const beforeDelete = async () => {
        hookRan = true;
      };

      const result = await cleanupTokenUsageFiles(
        tree.root,
        undefined,
        CONFIG,
        {
          beforeDelete,
        },
      );

      expect(hookRan).toBe(true);
      expect(await readIfPresent(log)).toBeNull();
      expect(result.deleted).toBe(1);
      // The deletion's lock was released: the session can start again.
      const lock = await SessionLockManager.acquire(tree.chats, 'idle-root');
      locks.push(lock);
      expect(await lock.ownsLock()).toBe(true);
    },
  );
});
