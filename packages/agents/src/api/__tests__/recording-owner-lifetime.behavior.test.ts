/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { SessionControl } from '../control/sessionControl.js';
import { drain } from './helpers/agentHarness.js';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';

async function filesIn(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).sort();
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function recordingPath(path: string | undefined): string {
  if (path === undefined) throw new Error('Recording did not materialize');
  return path;
}

describe('recording owner lifetime', () => {
  for (const failureKind of ['queue', 'append']) {
    it(`releases startup ownership after ${failureKind} failure before subscription`, async () => {
      await withRecordingLifetimeFixture(async ({ agent, chatsDir }) => {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'startup-seed'.repeat(1000) }],
          },
        ]);
        const failure = new Error('External append failed');
        const fault =
          failureKind === 'append'
            ? spyOn(fs, 'appendFile').mockImplementationOnce(async () => {
                throw failure;
              })
            : undefined;
        if (failureKind === 'queue') {
          agent.setEphemeralSetting('session-recording-queue-max-bytes', 4096);
        }
        try {
          await expect(
            agent.session.setRecording({ enabled: true }),
          ).rejects.toThrow(
            failureKind === 'append' ? failure : 'queue byte limit exceeded',
          );
        } finally {
          fault?.mockRestore();
          agent.setEphemeralSetting(
            'session-recording-queue-max-bytes',
            undefined,
          );
        }
        expect(agent.session.getRecording().enabled).toBe(false);
        expect(
          (await filesIn(chatsDir)).filter((file) => file.endsWith('.lock')),
        ).toStrictEqual([]);
        await agent.session.setRecording({ enabled: true });
        await drain(agent.stream(`public-turn-after-${failureKind}-failure`));
        const path = recordingPath(agent.session.getRecording().path);
        await agent.session.setRecording({ enabled: false });
        expect(await readFile(path, 'utf8')).toContain(
          `public-turn-after-${failureKind}-failure`,
        );
      });
    }, 30000);
  }

  it('closes admission synchronously and joins an admitted external append before disposing', async () => {
    await withRecordingLifetimeFixture(async ({ agent, chatsDir }) => {
      const session = agent.session;
      if (!(session instanceof SessionControl))
        throw new Error('Expected real SessionControl');
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'admitted-append-seed' }],
        },
      ]);
      let entered = (): void => {};
      const writing = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let release = (): void => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const append = fs.appendFile;
      const boundary = spyOn(fs, 'appendFile').mockImplementationOnce(
        async (...args) => {
          entered();
          await gate;
          return append(...args);
        },
      );
      const admitted = session.setRecording({ enabled: true });
      let terminal: Promise<void> | undefined;
      try {
        await writing;
        terminal = session.dispose();
        expect(session.dispose()).toBe(terminal);
        let settled = false;
        void terminal.then(() => {
          settled = true;
        });
        await expect(session.setRecording({ enabled: true })).rejects.toThrow(
          'disposed',
        );
        await expect(session.resume('latest')).rejects.toThrow('disposed');
        await expect(session.createCheckpoint('late')).rejects.toThrow(
          'disposed',
        );
        expect(settled).toBe(false);
        expect(
          (await filesIn(chatsDir)).some((file) => file.endsWith('.lock')),
        ).toBe(true);
      } finally {
        release();
        await admitted;
        await terminal;
        boundary.mockRestore();
      }
      expect(session.getRecording().enabled).toBe(false);
      expect(
        (await filesIn(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toStrictEqual([]);
      const journals = (await filesIn(chatsDir)).filter((file) =>
        file.endsWith('.jsonl'),
      );
      expect(journals).toHaveLength(1);
      expect(await readFile(`${chatsDir}/${journals[0]}`, 'utf8')).toContain(
        'admitted-append-seed',
      );
    });
  }, 30000);

  it('control: records and flushes a subsequent public turn on a borrowed Config', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.session.setRecording({ enabled: true });
      await drain(agent.stream('recording-lifetime-control-turn'));
      const path = recordingPath(agent.session.getRecording().path);
      await agent.session.setRecording({ enabled: false });
      const transcript = await readFile(path, 'utf8');
      expect(transcript).toContain('recording-lifetime-control-turn');
      expect(transcript).toContain('turn one reply');
    });
  }, 30000);

  it('disposing a non-recording borrowed facade preserves the other recorder and its subsequent turn', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
      const other = await borrow();
      await agent.session.setRecording({ enabled: true });
      await drain(agent.stream('recording-owner-before-sibling-disposal'));
      const path = recordingPath(agent.session.getRecording().path);
      expect(agent.session.getRecording()).toMatchObject({
        enabled: true,
        path,
      });
      expect(other.session.getRecording().enabled).toBe(false);

      await other.dispose();
      expect(agent.session.getRecording()).toMatchObject({
        enabled: true,
        path,
      });
      await drain(agent.stream('recording-owner-after-sibling-disposal'));
      expect(agent.session.getRecording()).toMatchObject({
        enabled: true,
        path,
      });
      await agent.session.setRecording({ enabled: false });
      const transcript = await readFile(path, 'utf8');

      expect(transcript).toContain('recording-owner-before-sibling-disposal');
      expect(transcript).toContain('recording-owner-after-sibling-disposal');
      expect(transcript).toContain('turn two reply');
    });
  }, 30000);

  it('stopping and disposing a recording sibling leaves the first owner recording later turns', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
      const other = await borrow();
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'first-owner-seed' }],
        },
      ]);
      await agent.session.setRecording({ enabled: true });
      await other.session.setRecording({ enabled: true });
      await drain(other.stream('recording-sibling-own-turn'));
      const siblingPath = recordingPath(other.session.getRecording().path);
      const firstPath = recordingPath(agent.session.getRecording().path);
      expect(siblingPath).not.toBe(firstPath);
      await other.session.setRecording({ enabled: false });
      expect(other.session.getRecording().enabled).toBe(false);
      expect(agent.session.getRecording()).toMatchObject({
        enabled: true,
        path: firstPath,
      });
      expect(await readFile(siblingPath, 'utf8')).toContain(
        'recording-sibling-own-turn',
      );

      await other.dispose();
      await drain(agent.stream('recording-first-after-sibling-stop'));
      expect(agent.session.getRecording()).toMatchObject({
        enabled: true,
        path: firstPath,
      });
      await agent.session.setRecording({ enabled: false });
      expect(await readFile(firstPath, 'utf8')).toContain(
        'recording-first-after-sibling-stop',
      );
    });
  }, 30000);

  it.each([1, 3])(
    'releases the lock after rejected subscription %i and lets the replacement recorder record another turn',
    async (failureAt) => {
      await withRecordingLifetimeFixture(async ({ agent, chatsDir }) => {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'subscription-failure-seed' }],
          },
        ]);
        const history = agent.agentClient.getHistoryService();
        if (history === null)
          throw new Error('Borrowed agent has no history event source');
        const failure = new Error(
          'External history event source rejects subscription',
        );
        const events = [
          'contentAdded',
          'compressionStarted',
          'compressionLockReleased',
          'compressionEnded',
        ];
        const priorListeners = events.map((event) =>
          history.listenerCount(event),
        );
        let acquiredFiles: string[] = [];
        const subscribe = history.on.bind(history);
        let registrations = 0;
        const subscription = spyOn(history, 'on').mockImplementation(
          (event, listener) => {
            registrations += 1;
            if (registrations === failureAt) {
              acquiredFiles = readdirSync(chatsDir);
              throw failure;
            }
            return subscribe(event, listener);
          },
        );
        try {
          await expect(
            agent.session.setRecording({ enabled: true }),
          ).rejects.toThrow(failure);
        } finally {
          subscription.mockRestore();
        }
        expect(
          events.map((event) => history.listenerCount(event)),
        ).toStrictEqual(priorListeners);
        expect(acquiredFiles.some((file) => file.endsWith('.lock'))).toBe(true);
        expect(acquiredFiles.some((file) => file.endsWith('.jsonl'))).toBe(
          true,
        );
        expect(agent.session.getRecording().enabled).toBe(false);

        await agent.session.setRecording({ enabled: true });
        const path = recordingPath(agent.session.getRecording().path);
        expect(
          (await filesIn(chatsDir)).some((file) => file.endsWith('.lock')),
        ).toBe(true);
        await drain(
          agent.stream('replacement-recorder-after-failed-subscription'),
        );
        expect(agent.session.getRecording()).toMatchObject({
          enabled: true,
          path,
        });
        await agent.session.setRecording({ enabled: false });
        const transcript = await readFile(path, 'utf8');
        expect(transcript).toContain(
          'replacement-recorder-after-failed-subscription',
        );
        expect(transcript).toContain('turn one reply');
        expect(
          (await filesIn(chatsDir)).some((file) => file.endsWith('.lock')),
        ).toBe(false);
      });
    },
    30000,
  );

  it('rejects recording admission while public disposal joins a pending provider body before session shutdown', async () => {
    let entered = (_signal: AbortSignal): void => {};
    const reading = new Promise<AbortSignal>((resolve) => {
      entered = resolve;
    });
    let release = (): void => {};
    const body = new Promise<void>((resolve) => {
      release = resolve;
    });
    await withRecordingLifetimeFixture(
      async ({ agent, chatsDir }) => {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [
              { type: 'text', text: 'inflight-disposal-recording-seed' },
            ],
          },
        ]);
        const applying = agent.profiles
          .applySnapshot({
            version: 1,
            provider: 'claudecode',
            model: 'recording-refresh-model',
            modelParams: {},
            ephemeralSettings: {},
            auth: { type: 'oauth', buckets: ['primary', 'secondary'] },
          })
          .then(
            () => undefined,
            (error: unknown) => error,
          );
        let disposal: Promise<void> | undefined;
        try {
          const signal = await Promise.race([
            reading,
            applying.then((error) => {
              throw new Error(
                'Profile settled before the provider body barrier',
                { cause: error },
              );
            }),
          ]);
          const before = await filesIn(chatsDir);
          expect(before).toStrictEqual([]);
          expect(agent.session.getRecording().enabled).toBe(false);
          let disposalSettled = false;
          disposal = agent.dispose();
          const admission = agent.session.setRecording({ enabled: true }).then(
            (): string => 'accepted',
            (error: unknown): string =>
              error instanceof Error ? error.message : String(error),
          );
          void disposal.then(() => {
            disposalSettled = true;
          });
          expect(signal.aborted).toBe(true);
          const outcome = await admission;
          const createdFiles = (await filesIn(chatsDir)).filter(
            (file) => !before.includes(file),
          );
          expect({
            disposalSettled,
            outcome,
            createdFiles,
            recordingEnabled: agent.session.getRecording().enabled,
            recordingPath: agent.session.getRecording().path,
          }).toStrictEqual({
            disposalSettled: false,
            outcome: expect.stringMatching(/disposed|closed/i),
            createdFiles: [],
            recordingEnabled: false,
            recordingPath: undefined,
          });
        } finally {
          release();
          await applying;
          await disposal;
        }
      },
      { entered, body },
    );
  }, 30000);

  it('rejects recording admission after public disposal without creating a journal or lock', async () => {
    await withRecordingLifetimeFixture(async ({ agent, chatsDir }) => {
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'post-disposal-recording-seed' }],
        },
      ]);
      await agent.dispose();
      const before = await filesIn(chatsDir);
      const outcome = await agent.session.setRecording({ enabled: true }).then(
        (): string => 'accepted',
        (error: unknown): string =>
          error instanceof Error ? 'rejected' : 'non-error rejection',
      );
      const after = await filesIn(chatsDir);
      expect({
        outcome,
        createdFiles: after.filter((file) => !before.includes(file)),
      }).toStrictEqual({
        outcome: 'rejected',
        createdFiles: [],
      });
    });
  }, 30000);
});
