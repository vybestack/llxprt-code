/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { AgentBusyError } from '@vybestack/llxprt-code-agents';
import { successful, withOwners } from './turn-revision-capture.fixture.js';

function barrier(): { promise: Promise<void>; release(): void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const tick = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe('Per-Agent foreground safe boundary (#2616 S2)', () => {
  it.each([1, 2])(
    'holds revision-bearing commands across HTTP and tool continuation (held request %s)',
    async (heldRequest) => {
      await withOwners(
        async (a, b, wireA, wireB, start) => {
          expect(a.getRuntimeId()).toBe(b.getRuntimeId());
          let revision = 0;
          const commitEntered = barrier();
          const commitRelease = barrier();
          const first = start(a, 'Read the fixture file and finish');
          await wireA.entered;
          expect(wireA.requests()).toHaveLength(heldRequest);
          const firstCommand = a.execution.executeCommand(
            { expectedRevision: 0 },
            () => revision,
            async () => {
              commitEntered.release();
              await commitRelease.promise;
              revision = 1;
              return 'applied';
            },
          );
          const staleCommand = a.execution.executeCommand(
            { expectedRevision: 0 },
            () => revision,
            async () => {
              throw new Error('Stale command must never execute');
            },
          );
          try {
            a.injectSteer('Complete the original admitted turn');
            const competing = await start(a, 'Must not enter before commit');
            expect(competing.rejection).toBeInstanceOf(AgentBusyError);
            expect(wireA.requests()).toHaveLength(heldRequest);
            successful(await start(b, 'Sibling runs while A waits'));
            expect(wireB.requests()).toHaveLength(1);
            await tick();
            expect(revision).toBe(0);
            wireA.release();
            successful(await first);
            await commitEntered.promise;
            const duringCommit = await start(a, 'Must not enter during commit');
            expect(duringCommit.rejection).toBeInstanceOf(AgentBusyError);
            expect(revision).toBe(0);
            successful(await start(b, 'Sibling runs during A commit'));
            commitRelease.release();
            expect(await firstCommand).toStrictEqual({
              status: 'committed',
              value: 'applied',
            });
            expect(await staleCommand).toStrictEqual({
              status: 'stale',
              actualRevision: 1,
            });
            successful(await start(a, 'Next ordinary admission'));
            expect(wireB.requests()).toHaveLength(2);
            expect(wireA.requests().length).toBeGreaterThan(heldRequest);
          } finally {
            wireA.release();
            commitRelease.release();
          }
        },
        false,
        true,
        heldRequest,
      );
    },
    30_000,
  );

  it('releases a failed commit and cancels queued commands without running their callback', async () => {
    await withOwners(async (a, b, wireA, _wireB, start) => {
      const entered = barrier();
      const release = barrier();
      const abort = new AbortController();
      const first = a.execution.executeCommand(
        { expectedRevision: 4 },
        () => 4,
        async () => {
          entered.release();
          await release.promise;
          throw new Error('commit failed');
        },
      );
      try {
        await entered.promise;
        const cancelled = a.execution.executeCommand(
          { expectedRevision: 4 },
          () => 4,
          async () => {
            throw new Error('Cancelled callback ran');
          },
          abort.signal,
        );
        abort.abort();
        expect(await cancelled).toStrictEqual({ status: 'cancelled' });
        const blocked = await start(a, 'Blocked by failing commit');
        expect(blocked.rejection).toBeInstanceOf(AgentBusyError);
        successful(await start(b, 'Sibling during failing commit'));
        release.release();
        await expect(first).rejects.toThrow('commit failed');
        const next = start(a, 'Recovered after commit failure');
        await wireA.entered;
        wireA.release();
        successful(await next);
      } finally {
        release.release();
      }
    });
  }, 30_000);

  it('keeps a started commit held through cancellation and disposal until it finishes', async () => {
    await withOwners(async (a, b, wireA, _wireB, start) => {
      const entered = barrier();
      const release = barrier();
      const abort = new AbortController();
      const command = a.execution.executeCommand(
        { expectedRevision: 7 },
        () => 7,
        async (signal) => {
          entered.release();
          await release.promise;
          return signal?.aborted === true
            ? 'finished after cancellation'
            : 'not cancelled';
        },
        abort.signal,
      );
      try {
        await entered.promise;
        abort.abort();
        const disposal = a.dispose();
        let closed = false;
        void disposal.then(() => {
          closed = true;
        });
        await tick();
        expect(closed).toBe(false);
        successful(await start(b, 'Sibling remains available during disposal'));
        release.release();
        expect(await command).toStrictEqual({
          status: 'committed',
          value: 'finished after cancellation',
        });
        await disposal;
        expect(closed).toBe(true);
        expect(wireA.requests()).toHaveLength(0);
      } finally {
        release.release();
      }
    });
  }, 30_000);
  it('captures the submitted expected revision even if the caller mutates its command while queued', async () => {
    await withOwners(async (a, _b, wireA, _wireB, start) => {
      const turn = start(a, 'Revision capture before mutation');
      await wireA.entered;
      const command = { expectedRevision: 0 };
      const pending = a.execution.executeCommand(
        command,
        () => 1,
        async () => {
          throw new Error('Mutated command must not be admitted');
        },
      );
      command.expectedRevision = 1;
      wireA.release();
      successful(await turn);
      expect(await pending).toStrictEqual({
        status: 'stale',
        actualRevision: 1,
      });
    });
  }, 30_000);
  it('rejects competing model and setting writes during an exclusive commit while another owner proceeds', async () => {
    await withOwners(async (a, b, _wireA, _wireB, start) => {
      const entered = barrier();
      const release = barrier();
      const command = a.execution.executeCommand(
        { expectedRevision: 0 },
        () => 0,
        async () => {
          entered.release();
          await release.promise;
          return 'done';
        },
      );
      try {
        await entered.promise;
        expect(() => a.setModelParam('temperature', 0.9)).toThrow(
          AgentBusyError,
        );
        expect(() => a.setEphemeralSetting('maxOutputTokens', 19)).toThrow(
          AgentBusyError,
        );
        await expect(a.setModel('next-model')).rejects.toBeInstanceOf(
          AgentBusyError,
        );
        successful(await start(b, 'Another owner while commit is held'));
        release.release();
        expect(await command).toStrictEqual({
          status: 'committed',
          value: 'done',
        });
        expect(a.getModelParams()['temperature']).toBe(0.2);
        expect(a.getEphemeralSetting('maxOutputTokens')).not.toBe(19);
      } finally {
        release.release();
      }
    });
  }, 30_000);

  it('disposal cancels a command waiting for the active turn and never enters its commit', async () => {
    await withOwners(async (a, _b, wireA, _wireB, start) => {
      const turn = start(a, 'Turn held until disposal');
      await wireA.entered;
      const command = a.execution.executeCommand(
        { expectedRevision: 0 },
        () => 0,
        async () => {
          throw new Error('Disposed callback ran');
        },
      );
      const disposed = a.dispose();
      wireA.release();
      expect(await command).toStrictEqual({ status: 'cancelled' });
      await disposed;
      await turn;
    });
  }, 30_000);
});
