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
import { tmpdir } from 'node:os';
import { AggregateDisposeError } from '../disposeErrors.js';
import { gate } from './helpers/async-child-disposal-join-fixture.js';
import { setImmediate } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import {
  withDisposalJoinFixture,
  type DisposalJoinFixture,
} from './helpers/async-child-disposal-join-fixture.js';

async function acceptChild(fixture: DisposalJoinFixture): Promise<void> {
  const events = [];
  for await (const event of fixture.agent.stream(
    'Launch the child asynchronously.',
    {
      mcpDiscovery: 'skip',
    },
  )) {
    events.push(event);
    if (event.type === 'tool-status' && event.update.status === 'executing') {
      expect(
        await Promise.race([
          fixture.entered.promise.then(() => 'fetch-entered'),
          fixture.childStatus,
        ]),
      ).toBe('fetch-entered');
    }
  }
  expect(events.filter((event) => event.type === 'error')).toStrictEqual([]);
  const results = events.filter((event) => event.type === 'tool-result');
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    result: { name: 'task', isError: false },
  });
  const tasks = fixture.agent.tasks.list();
  expect(tasks).toHaveLength(1);
  expect(JSON.stringify(results)).toContain(tasks[0].id);
  expect(tasks[0].status).toBe('running');
  expect(events[events.length - 1]).toMatchObject({
    type: 'done',
    reason: 'stop',
  });
  expect(fixture.signal()?.aborted).toBe(false);
  expect(fixture.isWorkSettled()).toBe(false);
  fixture.timeline.push('foreground-completed-with-accepted-child');
}

describe('public Agent async child disposal join', () => {
  it('aborts its accepted child before waiting for late scheduler acquisition', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'child-late-factory-'));
    const descriptor = await fs.open(join(directory, 'lease'), 'w+');
    const acquisition = gate();
    try {
      await withDisposalJoinFixture(
        async (fixture) => {
          await acceptChild(fixture);
          const closing = fixture.agent.dispose();
          let finished = false;
          void closing.then(
            () => {
              finished = true;
            },
            () => {
              finished = true;
            },
          );
          try {
            await setImmediate();
            expect(fixture.signal()?.aborted).toBe(true);
            expect(finished).toBe(false);
            fixture.releaseWork();
            await fixture.workSettled;
            expect(await fixture.childStatus).toBe('cancelled');
            expect(finished).toBe(false);
            await descriptor.write('held resource');
            acquisition.release();
            await closing;
            await expect(descriptor.write('retired resource')).rejects.toThrow(
              'Bad file descriptor',
            );
          } finally {
            acquisition.release();
            fixture.releaseWork();
            await closing;
          }
        },
        async () => {
          await acquisition.promise;
          return {
            dispose: async () => {
              await fs.writeFile(join(directory, 'retired'), 'closed', {
                flag: 'wx',
              });
              await descriptor.close();
            },
          };
        },
      );
    } finally {
      acquisition.release();
      await descriptor.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  it('joins a public completion notice acknowledgement before shutdown releases resources', async () => {
    await withDisposalJoinFixture(async (fixture) => {
      const entered = gate();
      const acknowledged = gate();
      const messages: string[] = [];
      const retire = fixture.agent.tasks.subscribeNotifications(
        () => false,
        async (message) => {
          messages.push(message);
          entered.release();
          await acknowledged.promise;
        },
      );
      try {
        await acceptChild(fixture);
        fixture.releaseWork();
        expect(await fixture.childStatus).toBe('completed');
        await setImmediate();
        expect(messages).toHaveLength(1);
        await entered.promise;
        retire();
        let settled = false;
        const disposal = fixture.agent.dispose().then(() => {
          settled = true;
        });
        await setImmediate();
        expect(settled).toBe(false);
        expect(messages.join()).toContain('child completed');
        acknowledged.release();
        await disposal;
      } finally {
        acknowledged.release();
        retire();
      }
    });
  }, 30000);
  it('completes a real accepted child after normal foreground completion and external release', async () => {
    await withDisposalJoinFixture(async (fixture) => {
      await acceptChild(fixture);
      fixture.releaseWork();
      await fixture.workSettled;
      expect(await fixture.childStatus).toBe('completed');
      expect(fixture.isWorkSettled()).toBe(true);
    });
  }, 30000);

  it('disposes only its own accepted task when facades borrow the same Config and manager', async () => {
    await withDisposalJoinFixture(async (fixture) => {
      await acceptChild(fixture);
      const sibling = await fixture.adoptSibling();
      const channel = sibling.tools.openClientChannel();
      await channel.ready;
      await channel.schedule(
        {
          callId: 'sibling-launch',
          name: 'task',
          args: {
            subagent_name: 'sibling-child',
            goal_prompt: 'Complete.',
            async: true,
          },
          isClientInitiated: true,
          prompt_id: 'sibling',
        },
        new AbortController().signal,
      );
      await fixture.siblingWork.entered.promise;
      await channel.release();
      const siblingTasks = sibling.tasks.list();
      expect(siblingTasks).toHaveLength(1);
      expect(fixture.agent.tasks.list()).toHaveLength(1);
      expect(siblingTasks[0].id).not.toBe(fixture.agent.tasks.list()[0].id);
      expect(await fixture.agent.tasks.cancel(siblingTasks[0].id)).toBe(false);
      const query = fixture.agent.tools.get('check_async_tasks');
      if (!query) throw new Error('Missing task query tool');
      const listing = await query.buildAndExecute(
        {},
        new AbortController().signal,
      );
      expect(JSON.stringify(listing.llmContent)).not.toContain(
        siblingTasks[0].id,
      );
      await query.buildAndExecute(
        { action: 'cancel', task_id: siblingTasks[0].id },
        new AbortController().signal,
      );
      expect(fixture.siblingWork.signal()?.aborted).toBe(false);

      const disposed = fixture.agent.dispose();
      expect(fixture.signal()?.aborted).toBe(true);
      expect(fixture.siblingWork.signal()?.aborted).toBe(false);
      fixture.releaseWork();
      await disposed;
      expect(sibling.tasks.get(siblingTasks[0].id)?.status).toBe('running');
      expect(fixture.siblingWork.isWorkSettled()).toBe(false);
      expect(sibling.tools.get('task')).toBeDefined();
      expect(fixture.manager.getRunningTasks()).toHaveLength(1);
      fixture.siblingWork.releaseWork();
      await fixture.siblingWork.workSettled;
      await sibling.dispose();
    });
  }, 30000);

  it('keeps the same task owner across profile replacement', async () => {
    await withDisposalJoinFixture(async (fixture) => {
      await acceptChild(fixture);
      const originalId = fixture.agent.tasks.list()[0].id;
      await fixture.agent.profiles.saveCurrent('parent-replacement');
      await fixture.agent.profiles.apply('parent-replacement');
      expect(fixture.signal()?.aborted).toBe(false);
      expect(fixture.agent.tasks.get(originalId)?.status).toBe('running');
      const task = fixture.agent.tools.get('task');
      if (!task) throw new Error('Missing task after profile replacement');
      const accepted = await task.buildAndExecute(
        {
          subagent_name: 'sibling-child',
          goal_prompt: 'Complete.',
          async: true,
        },
        new AbortController().signal,
      );
      expect(accepted.error).toBeUndefined();
      await fixture.siblingWork.entered.promise;
      expect(fixture.agent.tasks.listRunning()).toHaveLength(2);
      const disposal = fixture.agent.dispose();
      expect(fixture.signal()?.aborted).toBe(true);
      expect(fixture.siblingWork.signal()?.aborted).toBe(true);
      fixture.releaseWork();
      fixture.siblingWork.releaseWork();
      await disposal;
      expect(fixture.isWorkSettled()).toBe(true);
      expect(fixture.siblingWork.isWorkSettled()).toBe(true);
    });
  }, 30000);

  it('binds direct public task handles to the same disposal lifetime', async () => {
    await withDisposalJoinFixture(async (fixture) => {
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
      const disposal = fixture.agent.dispose();
      expect(fixture.signal()?.aborted).toBe(true);
      fixture.releaseWork();
      await disposal;
      expect(fixture.isWorkSettled()).toBe(true);
    });
  }, 30000);

  it('joins a launch blocked in real subagent storage before registration', async () => {
    await withDisposalJoinFixture(async (fixture) => {
      fixture.agent.setEphemeralSetting('task-max-async', 1);
      const entered = gate();
      const release = gate();
      const original = fs.readFile;
      const target = join(
        fixture.config.getTargetDir(),
        'subagents',
        'disposal-child.json',
      );
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
          await release.promise;
        }
        return original(path, options);
      }
      const read = vi.spyOn(fs, 'readFile').mockImplementation(heldRead);
      const task = fixture.agent.tools.get('task');
      if (!task) throw new Error('Missing task');
      const invocation = task.build({
        subagent_name: 'disposal-child',
        goal_prompt: 'Complete.',
        async: true,
      });
      const accepted = invocation.execute(new AbortController().signal);
      try {
        await entered.promise;
        expect(fixture.manager.canLaunchAsync().allowed).toBe(false);
        let disposed = false;
        const disposal = fixture.agent.dispose().then(() => {
          disposed = true;
        });
        await setImmediate();
        expect(disposed).toBe(false);
        expect(fixture.agent.tasks.list()).toHaveLength(0);
        await expect(
          invocation.execute(new AbortController().signal),
        ).rejects.toThrow('admission is closed');
        release.release();
        expect((await accepted).error).toBeDefined();
        await disposal;
        expect(fixture.agent.tasks.list()).toHaveLength(0);
        expect(fixture.manager.canLaunchAsync().allowed).toBe(true);
        expect(fixture.signal()).toBeUndefined();
      } finally {
        release.release();
        read.mockRestore();
        await accepted;
      }
    });
  }, 30000);

  it('retains a child closing-output failure after completion and attempts the remaining disposal', async () => {
    const failure = new Error('external child output closed');
    const containsFailure = (error: unknown): boolean =>
      error === failure ||
      ((error instanceof AggregateError ||
        error instanceof AggregateDisposeError) &&
        error.errors.some(containsFailure));
    let publicFailure: unknown;
    let fixtureFailure: unknown;
    try {
      await withDisposalJoinFixture(async (fixture) => {
        const task = fixture.agent.tools.get('task');
        if (!task) throw new Error('Missing task');
        const accepted = await task
          .build({
            subagent_name: 'disposal-child',
            goal_prompt: 'Complete.',
            async: true,
          })
          .execute(new AbortController().signal, (chunk) => {
            if (chunk.startsWith('</subagent')) throw failure;
          });
        expect(accepted.error).toBeUndefined();
        await fixture.entered.promise;
        fixture.releaseWork();
        await fixture.workSettled;
        expect(await fixture.childStatus).toBe('completed');
        await setImmediate();
        const disposal = fixture.agent.dispose();
        try {
          await disposal;
        } catch (error) {
          publicFailure = error;
        }
        expect(containsFailure(publicFailure)).toBe(true);
        expect(fixture.agent.dispose()).toBe(disposal);
        expect(fixture.signal()?.aborted).toBe(true);
        expect(() => fixture.agent.tools.openClientChannel()).toThrow(
          'disposed',
        );
        expect(() => fixture.agent.tools.get('task')).toThrow('closed');
      });
    } catch (error) {
      fixtureFailure = error;
    }
    expect(containsFailure(fixtureFailure)).toBe(true);
    if (!(fixtureFailure instanceof AggregateError)) throw fixtureFailure;
    expect(fixtureFailure.errors).toStrictEqual([publicFailure]);
  }, 30000);

  it('keeps disposal pending until the accepted child provider work settles', async () => {
    await withDisposalJoinFixture(async (fixture) => {
      await acceptChild(fixture);
      fixture.timeline.push('dispose-called');
      let disposalSnapshot:
        | { externalWorkSettled: boolean; signalAborted: boolean | undefined }
        | undefined;
      let reentrant: Promise<void> | undefined;
      fixture.signal()?.addEventListener(
        'abort',
        () => {
          reentrant = fixture.agent.dispose();
        },
        { once: true },
      );
      const shared = fixture.agent.dispose();
      expect(fixture.signal()?.aborted).toBe(true);
      expect(fixture.agent.dispose()).toBe(shared);
      expect(reentrant).toBe(shared);
      const disposal = shared.then(() => {
        disposalSnapshot = {
          externalWorkSettled: fixture.isWorkSettled(),
          signalAborted: fixture.signal()?.aborted,
        };
        fixture.timeline.push('dispose-settled');
      });
      try {
        await setImmediate();
        expect(fixture.isWorkSettled()).toBe(false);
        expect({
          disposalSettled: fixture.timeline.includes('dispose-settled'),
          externalWorkSettled: fixture.isWorkSettled(),
          timeline: [...fixture.timeline],
        }).toMatchObject({
          disposalSettled: false,
          externalWorkSettled: false,
        });
        fixture.releaseWork();
        await fixture.workSettled;
        await disposal;
        expect(fixture.agent.dispose()).toBe(shared);
        expect(fixture.timeline.indexOf('fetch-settled')).toBeLessThan(
          fixture.timeline.indexOf('dispose-settled'),
        );
      } finally {
        fixture.releaseWork();
        await fixture.workSettled;
        await disposal;
        await fixture.childStatus;
        const evidencePath = process.env['ASYNC_CHILD_JOIN_EVIDENCE'];
        if (evidencePath) {
          await writeFile(
            evidencePath,
            JSON.stringify(
              {
                timeline: fixture.timeline,
                externalWorkSettled: fixture.isWorkSettled(),
                disposalSnapshot,
                signalAbortedAfterChildTerminal: fixture.signal()?.aborted,
              },
              null,
              2,
            ),
          );
        }
      }
    });
  }, 30000);
});
