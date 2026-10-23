/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { SessionControl } from '../control/sessionControl.js';
import { drain } from './helpers/agentHarness.js';
import {
  withNativeRecordingFixture,
  nativeRecordingFiles,
  nativeRows,
  rowTexts,
  type NativeFileControl,
} from './helpers/native-session-fixture.js';

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

describe('native recording owner lifetime', () => {
  for (const kind of ['write', 'flush'] as const) {
    it(`releases startup lock after ${kind} failure and records a later public turn`, async () => {
      await withNativeRecordingFixture(async ({ agent, chatsDir }) => {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'startup-seed'.repeat(1000) }],
          },
        ]);
        agent.setEphemeralSetting('session-recording-queue-max-bytes', 4096);
        const control: NativeFileControl = {};
        const restore = nativeRecordingFiles(chatsDir, control);
        const failure = new Error(`native startup ${kind} failed`);
        if (kind === 'write') control.writeError = failure;
        else control.flushError = failure;
        try {
          await expect(
            agent.session.setRecording({ enabled: true }),
          ).rejects.toThrow(/native startup|Recording startup/);
          expect(agent.session.getRecording().enabled).toBe(false);
          expect(
            (await filesIn(chatsDir)).filter((file) => file.endsWith('.lock')),
          ).toStrictEqual([]);
          control.writeError = undefined;
          control.flushError = undefined;
          await agent.session.setRecording({ enabled: true });
          await drain(agent.stream(`public-turn-after-${kind}-failure`));
          const path = recordingPath(agent.session.getRecording().path);
          await agent.session.setRecording({ enabled: false });
          expect(rowTexts(await nativeRows(path))).toContain(
            `public-turn-after-${kind}-failure`,
          );
          expect(rowTexts(await nativeRows(path))).toContain('turn one reply');
        } finally {
          restore();
          agent.setEphemeralSetting(
            'session-recording-queue-max-bytes',
            undefined,
          );
        }
      });
    }, 30000);
  }

  it('closes admission synchronously and joins an admitted positional write before disposal', async () => {
    await withNativeRecordingFixture(async ({ agent, chatsDir }) => {
      const session = agent.session;
      if (!(session instanceof SessionControl))
        throw new Error('Expected real SessionControl');
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'admitted-append-seed' }],
        },
      ]);
      const entered = Promise.withResolvers<void>();
      const gate = Promise.withResolvers<void>();
      const control: NativeFileControl = {
        writeGate: async () => {
          entered.resolve();
          await gate.promise;
        },
      };
      const restore = nativeRecordingFiles(chatsDir, control);
      const admitted = session.setRecording({ enabled: true });
      let terminal: Promise<void> | undefined;
      try {
        await entered.promise;
        terminal = session.dispose();
        expect(new Set([terminal, session.dispose()]).size).toBe(1);
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
          (await filesIn(chatsDir)).filter((file) => file.endsWith('.lock')),
        ).toHaveLength(1);
      } finally {
        gate.resolve();
        await admitted;
        await terminal;
        restore();
      }
      expect(session.getRecording().enabled).toBe(false);
      expect(
        (await filesIn(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toStrictEqual([]);
      const files = (await filesIn(chatsDir)).filter((file) =>
        file.endsWith('.llxj'),
      );
      expect(files).toHaveLength(1);
      expect(
        rowTexts(await nativeRows(`${chatsDir}/${files[0]}`)),
      ).toStrictEqual(['admitted-append-seed']);
    });
  }, 30000);

  it('keeps an owner recording after a non-recording borrowed facade disposes', async () => {
    await withNativeRecordingFixture(async ({ agent, borrow }) => {
      const other = await borrow();
      await agent.session.setRecording({ enabled: true });
      await drain(agent.stream('before-sibling-disposal'));
      const path = recordingPath(agent.session.getRecording().path);
      expect(other.session.getRecording().enabled).toBe(false);
      await other.dispose();
      expect(agent.session.getRecording()).toMatchObject({
        enabled: true,
        path,
      });
      await drain(agent.stream('after-sibling-disposal'));
      await agent.session.setRecording({ enabled: false });
      expect(rowTexts(await nativeRows(path))).toStrictEqual([
        'before-sibling-disposal',
        'turn one reply',
        'after-sibling-disposal',
        'turn two reply',
      ]);
    });
  }, 30000);

  it('keeps both borrowed recorder identities isolated after sibling stop and disposal', async () => {
    await withNativeRecordingFixture(async ({ agent, borrow }) => {
      const other = await borrow();
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'first-owner-seed' }],
        },
      ]);
      await agent.session.setRecording({ enabled: true });
      const firstPath = recordingPath(agent.session.getRecording().path);
      await other.session.setRecording({ enabled: true });
      await drain(other.stream('sibling-own-turn'));
      const siblingPath = recordingPath(other.session.getRecording().path);
      expect(siblingPath).not.toBe(firstPath);
      await other.session.setRecording({ enabled: false });
      const closed = await readFile(siblingPath);
      await other.dispose();
      expect(agent.session.getRecording()).toMatchObject({
        enabled: true,
        path: firstPath,
      });
      await drain(agent.stream('first-after-sibling-stop'));
      await agent.session.setRecording({ enabled: false });
      expect(rowTexts(await nativeRows(firstPath))).toContain(
        'first-after-sibling-stop',
      );
      expect(rowTexts(await nativeRows(firstPath))).not.toContain(
        'sibling-own-turn',
      );
      expect(rowTexts(await nativeRows(siblingPath))).toContain(
        'sibling-own-turn',
      );
      expect(rowTexts(await nativeRows(siblingPath))).not.toContain(
        'first-after-sibling-stop',
      );
      expect(Buffer.compare(await readFile(siblingPath), closed)).toBe(0);
    });
  }, 30000);

  for (const point of ['retirement listener', 'after attachment'] as const) {
    it(`releases failed subscription ownership at ${point} and records with its replacement`, async () => {
      await withNativeRecordingFixture(async ({ agent, chatsDir }) => {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'subscription-failure-seed' }],
          },
        ]);
        const history = agent.agentClient.getHistoryService();
        if (history === null) throw new Error('Missing history');
        const attach = history.attachJournal.bind(history);
        const failure = new Error('subscription rejected');
        const events = [
          'contentAdded',
          'compressionStarted',
          'compressionLockReleased',
          'compressionEnded',
        ];
        const before = events.map((event) => history.listenerCount(event));
        let acquired: string[] = [];
        const fault =
          point === 'after attachment'
            ? spyOn(history, 'attachJournal').mockImplementation(
                async (...args) => {
                  await attach(...args);
                  acquired = readdirSync(chatsDir);
                  throw failure;
                },
              )
            : spyOn(history, 'onJournalRetired').mockImplementation(() => {
                acquired = readdirSync(chatsDir);
                throw failure;
              });
        try {
          await expect(
            agent.session.setRecording({ enabled: true }),
          ).rejects.toThrow(failure);
        } finally {
          fault.mockRestore();
        }
        expect(acquired.some((file) => file.endsWith('.lock'))).toBe(true);
        expect(acquired.some((file) => file.endsWith('.llxj'))).toBe(true);
        expect(
          events.map(
            (event, index) => history.listenerCount(event) - before[index],
          ),
        ).toStrictEqual([0, 0, 0, 0]);
        expect(agent.session.getRecording().enabled).toBe(false);
        expect(
          (await filesIn(chatsDir)).filter((file) => file.endsWith('.lock')),
        ).toStrictEqual([]);
        await agent.session.setRecording({ enabled: true });
        const path = recordingPath(agent.session.getRecording().path);
        await drain(
          agent.stream('replacement-recorder-after-failed-subscription'),
        );
        expect(agent.session.getRecording()).toMatchObject({
          enabled: true,
          path,
        });
        await agent.session.setRecording({ enabled: false });
        expect(rowTexts(await nativeRows(path))).toContain(
          'replacement-recorder-after-failed-subscription',
        );
        expect(rowTexts(await nativeRows(path))).toContain('turn one reply');
        expect(
          (await filesIn(chatsDir)).filter((file) => file.endsWith('.lock')),
        ).toStrictEqual([]);
      });
    }, 30000);
  }

  it('rejects recording admission while public disposal joins a provider body and after shutdown', async () => {
    const reading = Promise.withResolvers<AbortSignal>();
    const body = Promise.withResolvers<void>();
    await withNativeRecordingFixture(
      async ({ agent, chatsDir }) => {
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
            reading.promise,
            applying.then((error) => {
              throw new Error('Profile settled before provider body', {
                cause: error,
              });
            }),
          ]);
          const before = await filesIn(chatsDir);
          expect(before).toStrictEqual([]);
          let settled = false;
          disposal = agent.dispose();
          void disposal.then(() => {
            settled = true;
          });
          expect(signal.aborted).toBe(true);
          await expect(
            agent.session.setRecording({ enabled: true }),
          ).rejects.toThrow(/disposed|closed/i);
          expect(settled).toBe(false);
          expect(await filesIn(chatsDir)).toStrictEqual([]);
        } finally {
          body.resolve();
          await applying;
          await disposal;
        }
        const before = await filesIn(chatsDir);
        expect(before).toStrictEqual([]);
        await expect(
          agent.session.setRecording({ enabled: true }),
        ).rejects.toThrow(/disposed|closed/i);
        expect(await filesIn(chatsDir)).toStrictEqual([]);
        expect(agent.session.getRecording().enabled).toBe(false);
        expect(agent.session.getRecording().path).toBeUndefined();
      },
      { entered: reading.resolve, body: body.promise },
    );
  }, 30000);
});
