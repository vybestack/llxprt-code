/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deferred } from './__tests__/helpers/shell-owner-gate.js';
import { assembleAgentShutdown, joinAgentWork } from './agentDisposeHelpers.js';

describe('joined shutdown operation ports', () => {
  it('keeps runtime resources usable through auth joins and SessionEnd', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'joined-runtime-'));
    const runtime = await open(join(directory, 'runtime'), 'w+');
    const auth = deferred<void>();
    const entered = deferred<void>();
    let finalHookBytes = 0;
    const shutdown = assembleAgentShutdown(
      [],
      [],
      [],
      [],
      (errors) =>
        joinAgentWork(
          async () => {},
          async () => {
            entered.resolve();
            await auth.promise;
            await runtime.write('joined auth');
          },
          async () => {},
          errors,
        ),
      async () => {},
      async () => {},
      async () => {
        finalHookBytes = (await runtime.write('SessionEnd')).bytesWritten;
      },
      async () => runtime.close(),
    );
    const closing = shutdown.dispose();
    try {
      await entered.promise;
      await runtime.write('accepted work');
      auth.resolve();
      await closing;
      expect(finalHookBytes).toBeGreaterThan(0);
      await expect(runtime.write('retired')).rejects.toThrow(
        'Bad file descriptor',
      );
    } finally {
      auth.resolve();
      await Promise.allSettled([closing, runtime.close()]);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('collects independent cancellation failures', async () => {
    const errors: unknown[] = [];
    await joinAgentWork(
      async () => {
        throw new Error('profile cancellation failed');
      },
      async () => {
        throw new Error('auth cancellation failed');
      },
      async () => {},
      errors,
    );
    expect(errors).toHaveLength(2);
  });
});
