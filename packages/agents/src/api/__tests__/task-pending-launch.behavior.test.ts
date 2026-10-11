/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import type { PathLike, OpenMode, ObjectEncodingOptions } from 'node:fs';
import type { Abortable } from 'node:events';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import {
  gate,
  withDisposalJoinFixture,
  type DisposalJoinFixture,
} from './helpers/async-child-disposal-join-fixture.js';

async function withHeldStorage(
  fixture: DisposalJoinFixture,
  scenario: (barrier: {
    entered: Promise<void>;
    release: () => void;
  }) => Promise<void>,
): Promise<void> {
  const entered = gate();
  const released = gate();
  const target = join(
    fixture.config.getTargetDir(),
    'subagents',
    'disposal-child.json',
  );
  const original = fs.readFile;
  function heldRead(
    path: PathLike | fs.FileHandle,
    options?: ({ encoding?: null; flag?: OpenMode } & Abortable) | null,
  ): Promise<Buffer<ArrayBuffer>>;
  function heldRead(
    path: PathLike | fs.FileHandle,
    options:
      | BufferEncoding
      | ({ encoding: BufferEncoding; flag?: OpenMode } & Abortable),
  ): Promise<string>;
  function heldRead(
    path: PathLike | fs.FileHandle,
    options?:
      | BufferEncoding
      | (ObjectEncodingOptions & Abortable & { flag?: OpenMode })
      | null,
  ): Promise<string | Buffer<ArrayBuffer>>;
  async function heldRead(
    path: PathLike | fs.FileHandle,
    options?:
      | BufferEncoding
      | (ObjectEncodingOptions & Abortable & { flag?: OpenMode })
      | null,
  ): Promise<string | Buffer<ArrayBuffer>> {
    if (String(path) === target) {
      entered.release();
      await released.promise;
    }
    return original(path, options);
  }
  const read = vi.spyOn(fs, 'readFile').mockImplementation(heldRead);
  try {
    await scenario({ entered: entered.promise, release: released.release });
  } finally {
    released.release();
    read.mockRestore();
  }
}

function directTask(fixture: DisposalJoinFixture) {
  const task = fixture.agent.tools.get('task');
  if (!task) throw new Error('Public Agent has no task tool');
  return task;
}

function expectNoAcceptedTask(fixture: DisposalJoinFixture): void {
  expect(fixture.agent.tasks.list()).toHaveLength(0);
  expect(fixture.manager.canLaunchAsync().allowed).toBe(true);
  expect(fixture.manager.getRunningTasks()).toHaveLength(0);
  expect(fixture.signal()).toBeUndefined();
}

function errorType(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'type' in error
    ? error.type
    : undefined;
}

for (const asynchronous of [false, true]) {
  describe(`public Agent pending ${asynchronous ? 'async' : 'foreground'} task launch`, () => {
    it('classifies expiration while storage holds launch as TIMEOUT at the effective ceiling', async () => {
      await withDisposalJoinFixture(async (fixture) => {
        fixture.agent.setEphemeralSetting('task-max-async', 1);
        fixture.agent.setEphemeralSetting('task-max-timeout-seconds', 0.04);
        await withHeldStorage(fixture, async (barrier) => {
          vi.useFakeTimers();
          try {
            const invocation = directTask(fixture).build({
              subagent_name: 'disposal-child',
              goal_prompt: 'Complete.',
              async: asynchronous,
              timeout_seconds: -1,
            });
            const result = invocation.execute(new AbortController().signal);
            await barrier.entered;
            expect(fixture.agent.tasks.list()).toHaveLength(0);
            expect(fixture.manager.canLaunchAsync().allowed).toBe(
              !asynchronous,
            );
            vi.advanceTimersByTime(41);
            barrier.release();
            const outcome = await result;
            expect(errorType(outcome.error)).toBe(ToolErrorType.TIMEOUT);
            expect(String(outcome.llmContent)).toContain('TIMEOUT');
            expect(String(outcome.llmContent)).toContain('0.04s');
            expect(String(outcome.llmContent)).toContain(
              'reduced to the configured ceiling of 0.04s',
            );
            expect(String(outcome.llmContent)).toContain(
              'task-max-timeout-seconds',
            );
            expect(String(outcome.llmContent)).not.toMatch(
              /cancelled|canceled/i,
            );
            expectNoAcceptedTask(fixture);
          } finally {
            barrier.release();
            vi.useRealTimers();
          }
        });
      });
    }, 30000);

    for (const bounded of [true, false]) {
      it(`classifies parent abort during ${bounded ? 'bounded' : 'unbounded'} launch without accepting a task`, async () => {
        await withDisposalJoinFixture(async (fixture) => {
          fixture.agent.setEphemeralSetting('task-max-async', 1);
          if (!bounded)
            fixture.agent.setEphemeralSetting('task-max-timeout-seconds', -1);
          await withHeldStorage(fixture, async (barrier) => {
            const controller = new AbortController();
            const result = directTask(fixture)
              .build({
                subagent_name: 'disposal-child',
                goal_prompt: 'Complete.',
                async: asynchronous,
                timeout_seconds: -1,
              })
              .execute(controller.signal);
            await barrier.entered;
            expect(fixture.agent.tasks.list()).toHaveLength(0);
            expect(fixture.manager.canLaunchAsync().allowed).toBe(
              !asynchronous,
            );
            const reason = new Error('Parent cancelled pending child');
            controller.abort(reason);
            expect(controller.signal.reason).toBe(reason);
            barrier.release();
            const outcome = await result;
            expect(errorType(outcome.error)).not.toBe(ToolErrorType.TIMEOUT);
            expect(String(outcome.llmContent)).not.toContain('TIMEOUT');
            expect(String(outcome.llmContent)).toMatch(/abort|cancel/i);
            expectNoAcceptedTask(fixture);
          });
        });
      }, 30000);
    }

    it('does not register a child when the caller is already aborted', async () => {
      await withDisposalJoinFixture(async (fixture) => {
        fixture.agent.setEphemeralSetting('task-max-async', 1);
        const controller = new AbortController();
        const reason = new Error('Cancelled before invocation');
        controller.abort(reason);
        await expect(
          directTask(fixture)
            .build({
              subagent_name: 'disposal-child',
              goal_prompt: 'Complete.',
              async: asynchronous,
            })
            .execute(controller.signal),
        ).rejects.toBe(reason);
        expect(controller.signal.reason).toBe(reason);
        await setImmediate();
        expectNoAcceptedTask(fixture);
      });
    }, 30000);
  });
}

describe('public Agent pending launch lifetime', () => {
  it('joins an aborted storage-blocked launch before disposal releases capacity', async () => {
    await withDisposalJoinFixture(async (fixture) => {
      fixture.agent.setEphemeralSetting('task-max-async', 1);
      await withHeldStorage(fixture, async (barrier) => {
        const result = directTask(fixture)
          .build({
            subagent_name: 'disposal-child',
            goal_prompt: 'Complete.',
            async: true,
          })
          .execute(new AbortController().signal);
        await barrier.entered;
        expect(fixture.manager.canLaunchAsync().allowed).toBe(false);
        let settled = false;
        const disposal = fixture.agent.dispose().then(() => {
          settled = true;
        });
        try {
          await setImmediate();
          expect(settled).toBe(false);
          expect(fixture.agent.tasks.list()).toHaveLength(0);
          barrier.release();
          const outcome = await result;
          expect(outcome.error).toBeDefined();
          expect(errorType(outcome.error)).not.toBe(ToolErrorType.TIMEOUT);
          await disposal;
          expect(settled).toBe(true);
          expectNoAcceptedTask(fixture);
        } finally {
          barrier.release();
          await result;
          await disposal;
        }
      });
    });
  }, 30000);

  it('reuses the released slot for a real child and joins unbounded owner cancellation', async () => {
    await withDisposalJoinFixture(async (fixture) => {
      fixture.agent.setEphemeralSetting('task-max-async', 1);
      fixture.agent.setEphemeralSetting('task-max-timeout-seconds', -1);
      await withHeldStorage(fixture, async (barrier) => {
        const controller = new AbortController();
        const rejected = directTask(fixture)
          .build({
            subagent_name: 'disposal-child',
            goal_prompt: 'Complete.',
            async: true,
            timeout_seconds: -1,
          })
          .execute(controller.signal);
        await barrier.entered;
        controller.abort(new Error('Parent cancelled before acceptance'));
        barrier.release();
        expect(errorType((await rejected).error)).not.toBe(
          ToolErrorType.TIMEOUT,
        );
        expectNoAcceptedTask(fixture);
      });
      const accepted = await directTask(fixture).buildAndExecute(
        {
          subagent_name: 'sibling-child',
          goal_prompt: 'Complete.',
          async: true,
          timeout_seconds: -1,
        },
        new AbortController().signal,
      );
      expect(accepted.error).toBeUndefined();
      await fixture.siblingWork.entered.promise;
      const tasks = fixture.agent.tasks.listRunning();
      expect(tasks).toHaveLength(1);
      const disposal = fixture.agent.dispose();
      expect(fixture.siblingWork.signal()?.aborted).toBe(true);
      fixture.siblingWork.releaseWork();
      await disposal;
      expect(fixture.siblingWork.isWorkSettled()).toBe(true);
      expect(fixture.agent.tasks.get(tasks[0].id)?.status).toBe('cancelled');
      expect(fixture.manager.canLaunchAsync().allowed).toBe(true);
    });
  }, 30000);
});
