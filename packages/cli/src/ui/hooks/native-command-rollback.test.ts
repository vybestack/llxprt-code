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
      await target.session.setRecording({ enabled: true });
      await turn(target, 'target only');
      const targetPath = await recording(target);
      const targetBefore = await durable(targetPath);
      await target.dispose();
      await fixture.live.session.setRecording({ enabled: true });
      await turn(fixture.live, 'prior only');
      const priorPath = await recording(fixture.live);
      const priorBefore = await durable(priorPath);
      const history = fixture.live.agentClient.getHistoryService();
      if (history === null) throw new Error('Missing actual CLI history');
      const priorTokens = history.getTotalTokens();
      const priorRange = history.getContextRange();
      const adopt = history.adoptResumeBoot.bind(history);
      const fault = vi
        .spyOn(history, 'adoptResumeBoot')
        .mockImplementationOnce((recorder, boot, publish) =>
          adopt(recorder, boot, async () => {
            await publish?.();
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
      expect(history.getTotalTokens()).toBe(priorTokens);
      expect(history.getContextRange()).toStrictEqual(priorRange);
      expect(await durable(priorPath)).toStrictEqual(priorBefore);
      expect(await durable(targetPath)).toStrictEqual(targetBefore);
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
      expect(await durable(targetPath)).toStrictEqual(targetBefore);
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
