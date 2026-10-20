/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { dirname } from 'node:path';
import { readdir } from 'node:fs/promises';
import { SessionLockManager } from '@vybestack/llxprt-code-core';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import {
  durable,
  finishFaultTest,
  nativeCommandFixture,
  recording,
  turn,
  type NativeCommandFixture,
} from '../../__tests__/native-command-fixture.js';

function detail(message: {
  readonly type: string;
  readonly content?: string;
}): string {
  return message.content ?? message.type;
}

describe('native CLI resume failure branches', () => {
  for (const stage of [
    'listener',
    'checkpoint-child',
    'cleanup',
    'restoration',
  ] as const) {
    it(`preserves prior readable recording and releases prepared ownership after ${stage} failure`, async () => {
      const fixture = await nativeCommandFixture();
      const target = await fixture.agent('resume-fault-target');
      let primaryFailure: unknown;
      try {
        await target.session.setRecording({ enabled: true });
        await turn(target, 'target rows');
        const targetPath = await recording(target);
        await target.dispose();
        await fixture.live.session.setRecording({ enabled: true });
        await turn(fixture.live, 'prior rows');
        if (stage === 'checkpoint-child') await saveWithoutHistory(fixture);
        const path = await recording(fixture.live);
        const prior = await durable(path);
        const targetBefore = await durable(targetPath);
        const files = (await readdir(dirname(path))).sort();
        const history = fixture.live.agentClient.getHistoryService();
        if (history === null) throw new Error('Missing actual CLI history');
        const before = {
          tokens: history.getTotalTokens(),
          range: history.getContextRange(),
          listeners: history.listenerCount('tokensUpdated'),
          prior,
          target: targetBefore,
          files,
        };
        let sawPublication = false;
        let prepared: JournalRecordingService | undefined;
        const adopt = history.adoptResumeBoot.bind(history);
        const failure = new Error(`${stage} consumer failed`);
        const rejectListener = (): void => {
          history.off('tokensUpdated', rejectListener);
          sawPublication = true;
          throw failure;
        };
        if (stage === 'listener') history.on('tokensUpdated', rejectListener);
        const fault = vi
          .spyOn(history, 'adoptResumeBoot')
          .mockImplementationOnce((recorder, boot, publish) => {
            if (stage === 'listener') return adopt(recorder, boot, publish);
            return adopt(recorder, boot, async () => {
              await publish?.();
              sawPublication = true;
              if (!(recorder instanceof JournalRecordingService))
                throw new Error('Expected native prepared recorder');
              prepared = recorder;
              expect(
                await SessionLockManager.isLocked(
                  dirname(path),
                  recorder.getSessionId(),
                ),
              ).toBe(true);
              if (stage === 'restoration')
                history.once('tokensUpdated', () => {
                  throw new Error('restoration observer failed');
                });
              throw failure;
            });
          });
        const dispose = JournalRecordingService.prototype.dispose;
        const cleanup = vi
          .spyOn(JournalRecordingService.prototype, 'dispose')
          .mockImplementation(async function (
            this: JournalRecordingService,
          ): Promise<void> {
            await dispose.call(this);
            if (stage === 'cleanup' && this === prepared)
              throw new Error('prepared recorder cleanup failed');
          });
        try {
          await fixture.command(
            stage === 'checkpoint-child'
              ? '/continue fault-cut'
              : '/continue resume-fault-target',
          );
        } finally {
          fault.mockRestore();
          cleanup.mockRestore();
          history.off('tokensUpdated', rejectListener);
        }
        expect(sawPublication).toBe(true);
        expect(fixture.errors).toHaveLength(1);
        expect(fixture.errors.map(detail).join('; ')).toContain(
          failure.message,
        );
        const extraDetails = {
          listener: [],
          'checkpoint-child': [],
          cleanup: ['prepared recorder cleanup failed'],
          restoration: ['restoration observer failed'],
        };
        for (const expected of extraDetails[stage])
          expect(fixture.errors.map(detail).join('; ')).toContain(expected);
        expect(fixture.live.session.getRecording()).toMatchObject({
          enabled: true,
          path,
        });
        expect(fixture.live.session.getSessionId()).toBe('cli-fault-current');
        expect(history.getTotalTokens()).toBe(before.tokens);
        expect(history.getContextRange()).toStrictEqual(before.range);
        expect(history.listenerCount('tokensUpdated')).toBe(before.listeners);
        expect(await durable(path)).toStrictEqual(before.prior);
        expect(await durable(targetPath)).toStrictEqual(before.target);
        expect((await readdir(dirname(path))).sort()).toStrictEqual(
          before.files,
        );
        expect(
          await SessionLockManager.isLocked(
            dirname(path),
            'resume-fault-target',
          ),
        ).toBe(false);
        await turn(fixture.live, 'after rollback');
        expect((await durable(await recording(fixture.live))).count).toBe(
          prior.count + 2,
        );
        expect(await durable(targetPath)).toStrictEqual(before.target);
        await fixture.live.dispose();
        expect(
          (await readdir(dirname(path))).filter((name) =>
            name.endsWith('.lock'),
          ),
        ).toStrictEqual([]);
      } catch (error) {
        primaryFailure = error;
        throw error;
      } finally {
        await finishFaultTest(fixture, target, primaryFailure);
      }
    }, 30000);
  }
});

async function saveWithoutHistory(
  fixture: NativeCommandFixture,
): Promise<void> {
  const rows = vi
    .spyOn(JournalSession.prototype, 'rows')
    .mockImplementation(() => {
      throw new Error('Checkpoint save must not decode history for counts');
    });
  const array = vi
    .spyOn(fixture.live.session, 'getHistory')
    .mockImplementation(() => {
      throw new Error('Checkpoint save must not materialize history');
    });
  try {
    await fixture.command('/chat save fault-cut');
    expect(
      fixture.items.some(
        (item) =>
          'text' in item && item.text === 'Checkpoint saved: fault-cut.',
      ),
    ).toBe(true);
  } finally {
    rows.mockRestore();
    array.mockRestore();
  }
}
