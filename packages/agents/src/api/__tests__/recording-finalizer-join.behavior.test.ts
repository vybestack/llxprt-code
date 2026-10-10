/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as recordingFs from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { SessionLockManager } from '@vybestack/llxprt-code-core/recording/SessionLockManager.js';
import { drain } from './helpers/agentHarness.js';
import {
  gate,
  withRecordingFinalizerFixture,
} from './helpers/recording-finalizer-join-fixture.js';

function containsCause(error: unknown, cause: Error): boolean {
  if (error === cause) return true;
  if (!(error instanceof Error)) return false;
  if (containsCause(error.cause, cause)) return true;
  return (
    'errors' in error &&
    Array.isArray(error.errors) &&
    error.errors.some((nested: unknown) => containsCause(nested, cause))
  );
}

const recordingEvents = [
  'contentAdded',
  'compressionStarted',
  'compressionLockReleased',
  'compressionEnded',
];

describe('public Agent recording finalizer join', () => {
  it('joins the final public-turn journal append before releasing its real lock', async () => {
    await withRecordingFinalizerFixture(
      async ({ agent, chatsDir, sessionId }) => {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'journal-seed' }],
          },
        ]);
        await agent.session.setRecording({ enabled: true });
        const journal = agent.session.getRecording().path;
        if (!journal) throw new Error('Recording journal missing');
        const entered = gate();
        const release = gate();
        const append = recordingFs.appendFile;
        const boundary = spyOn(recordingFs, 'appendFile').mockImplementation(
          async (...args) => {
            if (
              args[0] === journal &&
              String(args[1]).includes('turn one reply')
            ) {
              entered.release();
              await release.promise;
            }
            return append(...args);
          },
        );
        let disposal: Promise<void> | undefined;
        const turn = drain(agent.stream('public-turn-before-final-append'));
        try {
          await entered.promise;
          await turn;
          let settled = false;
          disposal = agent.dispose();
          void disposal.then(
            () => {
              settled = true;
            },
            () => {
              settled = true;
            },
          );
          await setImmediate();
          expect(settled).toBe(false);
          expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(
            true,
          );
          expect(await fs.readFile(journal, 'utf8')).not.toContain(
            'turn one reply',
          );
          release.release();
          await disposal;
          const transcript = await fs.readFile(journal, 'utf8');
          expect(transcript).toContain('public-turn-before-final-append');
          expect(transcript).toContain('turn one reply');
          expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(
            false,
          );
        } finally {
          release.release();
          try {
            await Promise.allSettled([turn, disposal ?? agent.dispose()]);
          } finally {
            boundary.mockRestore();
          }
        }
      },
    );
  }, 30000);

  for (const failWrite of [false, true]) {
    it(`joins accepted persistence before releasing recording ownership${failWrite ? ' and retains its original failure' : ''}`, async () => {
      await withRecordingFinalizerFixture(
        async ({ agent, chatsDir, sessionId }) => {
          const history = agent.agentClient.getHistoryService();
          if (!history) throw new Error('Missing real history service');
          const baseline = recordingEvents.map((event) =>
            history.listenerCount(event),
          );
          await agent.setHistory([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'finalizer-seed' }],
            },
          ]);
          await agent.session.setRecording({ enabled: true });
          const journal = agent.session.getRecording().path;
          if (!journal) throw new Error('Recording journal missing');
          expect(await fs.readFile(journal, 'utf8')).toContain(
            'finalizer-seed',
          );
          expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(
            true,
          );
          expect(
            recordingEvents.map((event) => history.listenerCount(event)),
          ).toStrictEqual(baseline.map((count) => count + 1));

          await drain(agent.stream('public-turn-before-recording-finalizer'));
          const entered = gate();
          const release = gate();
          const retired = gate();
          const failure = new Error(
            'Accepted recording persistence rename failed',
          );
          const rename = fs.rename;
          let destination: string | undefined;
          let source: string | undefined;
          const boundary = spyOn(fs, 'rename').mockImplementation(
            async (from, to) => {
              if (
                typeof to === 'string' &&
                to.startsWith(`${chatsDir}/`) &&
                to.endsWith('.json')
              ) {
                destination = to;
                source = String(from);
                entered.release();
                await release.promise;
                if (failWrite) throw failure;
              }
              return rename(from, to);
            },
          );
          const onRemoval = (): void => {
            if (
              recordingEvents.every(
                (event, index) =>
                  history.listenerCount(event) === baseline[index],
              )
            ) {
              retired.release();
            }
          };
          history.on('removeListener', onRemoval);
          let disposal: Promise<unknown> | undefined;
          try {
            history.add({
              speaker: 'human',
              blocks: [
                { type: 'text', text: 'accepted-history-before-finalizer' },
              ],
            });
            await entered.promise;
            if (!source) throw new Error('Persistence did not reach rename');
            expect(await fs.readFile(source, 'utf8')).toContain(
              'accepted-history-before-finalizer',
            );
            let settled = false;
            const terminal = agent.dispose();
            expect(agent.dispose()).toBe(terminal);
            disposal = terminal.then(
              () => {
                settled = true;
                return undefined;
              },
              (error: unknown) => {
                settled = true;
                return error;
              },
            );
            await Promise.race([
              retired.promise,
              disposal.then(() => {
                throw new Error(
                  'Agent disposed before retiring recording listeners',
                );
              }),
            ]);
            await setImmediate();
            expect(settled).toBe(false);
            expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(
              true,
            );
            expect(
              recordingEvents.map((event) => history.listenerCount(event)),
            ).toStrictEqual(baseline);
            release.release();
            const result = await disposal;
            expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(
              false,
            );
            const transcript = await fs.readFile(journal, 'utf8');
            expect(transcript).toContain('accepted-history-before-finalizer');
            expect(transcript).toContain('turn one reply');
            expect(containsCause(result, failure)).toBe(failWrite);
            expect(result === undefined).toBe(!failWrite);
            const repeated = await agent.dispose().then(
              () => undefined,
              (error: unknown) => error,
            );
            expect(repeated).toBe(result);
            if (!destination)
              throw new Error('Persistence destination missing');
            const persisted = await fs.readFile(destination, 'utf8');
            expect(persisted).toContain('turn one reply');
            expect(
              persisted.includes('accepted-history-before-finalizer'),
            ).toBe(!failWrite);
            const filesBefore = (await fs.readdir(chatsDir)).sort();
            history.add({
              speaker: 'human',
              blocks: [
                { type: 'text', text: 'late-history-after-agent-disposal' },
              ],
            });
            await setImmediate();
            expect(await fs.readFile(journal, 'utf8')).toBe(transcript);
            expect(await fs.readFile(destination, 'utf8')).toBe(persisted);
            expect((await fs.readdir(chatsDir)).sort()).toStrictEqual(
              filesBefore,
            );
            expect(
              recordingEvents.map((event) => history.listenerCount(event)),
            ).toStrictEqual(baseline);
          } finally {
            release.release();
            try {
              await Promise.allSettled([disposal ?? agent.dispose()]);
            } finally {
              boundary.mockRestore();
              history.off('removeListener', onRemoval);
            }
          }
        },
      );
    }, 30000);
  }
});
