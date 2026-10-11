/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import * as runtime from '@vybestack/llxprt-code-providers/runtime.js';
import { SessionLockManager } from '@vybestack/llxprt-code-core/recording/SessionLockManager.js';
import {
  gate,
  withDisposalJoinFixture,
} from './helpers/async-child-disposal-join-fixture.js';

describe('public async child late storage finalization', () => {
  it('joins the real runtime cleanup callback while external storage retains its session lock', async () => {
    await withDisposalJoinFixture(async (fixture) => {
      const directory = fixture.config.getTargetDir();
      const sessionId = 'child-finalizer';
      const lock = await SessionLockManager.acquire(directory, sessionId);
      const file = join(directory, 'child-finalizer.json');
      const entered = gate();
      const release = gate();
      const original = runtime.createIsolatedRuntimeContext;
      const seam = vi
        .spyOn(runtime, 'createIsolatedRuntimeContext')
        .mockImplementation((options, settings) =>
          original(
            {
              ...options,
              onCleanup: async (context) => {
                await options.onCleanup?.(context);
                entered.release();
                await release.promise;
                try {
                  await writeFile(file, JSON.stringify({ completed: true }));
                } finally {
                  await lock.release();
                }
              },
            },
            settings,
          ),
        );
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
