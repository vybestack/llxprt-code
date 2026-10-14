/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import * as filesystem from 'node:fs/promises';
import { join, sep } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { SessionLockManager } from '@vybestack/llxprt-code-core/recording/SessionLockManager.js';
import {
  gate,
  withDisposalJoinFixture,
} from './helpers/async-child-disposal-join-fixture.js';

describe('public async child late storage finalization', () => {
  it('joins actual child media directory cleanup while external storage retains its session lock', async () => {
    await withDisposalJoinFixture(async (fixture) => {
      const directory = fixture.config.getTargetDir();
      const sessionId = 'child-finalizer';
      const lock = await SessionLockManager.acquire(directory, sessionId);
      const file = join(directory, 'child-finalizer.json');
      const entered = gate();
      const release = gate();
      const original = filesystem.rm;
      let childDirectory: string | undefined;
      const seam = vi
        .spyOn(filesystem, 'rm')
        .mockImplementation(async (path, options) => {
          if (
            typeof path !== 'string' ||
            !path.includes(`${sep}media-live${sep}`) ||
            childDirectory !== undefined
          ) {
            await original(path, options);
            return;
          }
          childDirectory = path;
          await mkdir(path, { recursive: true });
          await writeFile(
            join(path, 'storage-reservation'),
            'held by child storage',
          );
          entered.release();
          await release.promise;
          try {
            await original(path, options);
            await writeFile(file, JSON.stringify({ completed: true }));
          } finally {
            await lock.release();
          }
        });
      try {
        const task = fixture.agent.tools.get('task');
        if (!task) throw new Error('Missing task');
        const accepted = await task.buildAndExecute(
          {
            subagent_name: 'disposal-child',
            goal_prompt: 'Complete.',
            async: true,
          },
          new AbortController().signal,
        );
        expect(accepted.error).toBeUndefined();
        await fixture.entered.promise;
        fixture.releaseWork();
        await entered.promise;
        expect(await fixture.childStatus).toBe('completed');
        let disposed = false;
        const disposal = fixture.agent.dispose().then(() => {
          disposed = true;
        });
        try {
          await setImmediate();
          expect(disposed).toBe(false);
          expect(await lock.ownsLock()).toBe(true);
          expect(await SessionLockManager.isLocked(directory, sessionId)).toBe(
            true,
          );
          await expect(readFile(file, 'utf8')).rejects.toMatchObject({
            code: 'ENOENT',
          });
          release.release();
          await disposal;
          expect(await readFile(file, 'utf8')).toBe('{"completed":true}');
          expect(await SessionLockManager.isLocked(directory, sessionId)).toBe(
            false,
          );
          if (childDirectory === undefined)
            throw new Error('Child storage cleanup was not reached');
          await expect(stat(childDirectory)).rejects.toMatchObject({
            code: 'ENOENT',
          });
        } finally {
          release.release();
          await disposal;
        }
      } finally {
        release.release();
        fixture.releaseWork();
        seam.mockRestore();
        await lock.release();
      }
    });
  }, 30000);
});
