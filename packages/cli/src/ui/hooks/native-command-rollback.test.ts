/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { dirname } from 'node:path';
import { readdir } from 'node:fs/promises';
import { SessionLockManager } from '@vybestack/llxprt-code-core';
import {
  durable,
  finishFaultTest,
  nativeCommandFixture,
  recording,
  turn,
} from '../../__tests__/native-command-fixture.js';

describe('native CLI resume rollback', () => {
  it('restores the owning recorder after a post-publication consumer rejects and records the next turn only there', async () => {
    const fixture = await nativeCommandFixture();
    const target = await fixture.agent('cli-fault-target');
    let primaryFailure: unknown;
    try {
      const targetStore = target.agentClient.mediaStore;
      const priorStore = fixture.live.agentClient.mediaStore;
      if (targetStore === undefined || priorStore === undefined)
        throw new Error('Missing actual CLI media stores');
      const targetMedia = await targetStore.admit({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'application/octet-stream',
        semanticMetadata: {},
      });
      const priorMedia = await priorStore.admit({
        bytes: new Uint8Array([9, 8]),
        mimeType: 'application/octet-stream',
        semanticMetadata: {},
      });
      await target.session.setRecording({ enabled: true });
      await turn(target, 'target only', targetMedia);
      const targetPath = await recording(target);
      const targetBefore = await durable(targetPath);
      await target.dispose();
      await fixture.live.session.setRecording({ enabled: true });
      await turn(fixture.live, 'prior only', priorMedia);
      const priorPath = await recording(fixture.live);
      const priorBefore = await durable(priorPath);
      const history = fixture.live.agentClient.getHistoryService();
      if (history === null) throw new Error('Missing actual CLI history');
      const before = {
        prior: priorBefore,
        target: targetBefore,
        tokens: history.getTotalTokens(),
        range: history.getContextRange(),
      };
      const adopt = history.adoptResumeBoot.bind(history);
      const fault = vi
        .spyOn(history, 'adoptResumeBoot')
        .mockImplementationOnce((recorder, boot, publish) =>
          adopt(recorder, boot, async () => {
            await publish?.();
            expect(await priorStore.hasReservations(priorMedia.contentId)).toBe(
              true,
            );
            expect(
              await priorStore.hasReservations(targetMedia.contentId),
            ).toBe(true);
            expect(fixture.live.session.getRecording().path).toBe(targetPath);
            expect(
              await SessionLockManager.isLocked(
                dirname(priorPath),
                'cli-fault-current',
              ),
            ).toBe(true);
            expect(
              await SessionLockManager.isLocked(
                dirname(priorPath),
                'cli-fault-target',
              ),
            ).toBe(true);
            throw new Error('post-publication consumer failed');
          }),
        );
      try {
        await fixture.command('/continue cli-fault-target');
      } finally {
        fault.mockRestore();
      }
      expect(
        fixture.errors.map((error) =>
          'content' in error ? error.content : error.type,
        ),
      ).toStrictEqual(['post-publication consumer failed']);
      expect(fixture.live.session.getRecording()).toMatchObject({
        enabled: true,
        path: priorPath,
      });
      expect(fixture.live.session.getSessionId()).toBe('cli-fault-current');
      expect(history.getTotalTokens()).toBe(before.tokens);
      expect(history.getContextRange()).toStrictEqual(before.range);
      expect(await durable(priorPath)).toStrictEqual(before.prior);
      expect(await durable(targetPath)).toStrictEqual(before.target);
      expect(await priorStore.hasReservations(priorMedia.contentId)).toBe(true);
      expect(await priorStore.hasReservations(targetMedia.contentId)).toBe(
        false,
      );
      expect(await priorStore.readVerified(priorMedia)).toStrictEqual(
        new Uint8Array([9, 8]),
      );
      expect(
        await SessionLockManager.isLocked(
          dirname(priorPath),
          'cli-fault-target',
        ),
      ).toBe(false);
      await turn(fixture.live, 'after failed switch');
      expect((await durable(await recording(fixture.live))).count).toBe(
        priorBefore.count + 2,
      );
      expect(await durable(targetPath)).toStrictEqual(before.target);
      await fixture.live.dispose();
      expect(
        (await readdir(dirname(priorPath))).filter((name) =>
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
});
