/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { dirname, join } from 'node:path';
import { readdir, utimes, writeFile } from 'node:fs/promises';
import { SessionLockManager } from '@vybestack/llxprt-code-core';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import {
  durable,
  finishFaultTest,
  nativeCommandFixture,
  recording,
  turn,
} from '../../__tests__/native-command-fixture.js';

describe('native CLI continue reference selection', () => {
  for (const reference of ['id', 'prefix', 'index'] as const) {
    it(`selects the listed native ${reference} despite corrupt and retired siblings without decoding listing history`, async () => {
      const fixture = await nativeCommandFixture();
      const target = await fixture.agent('selected-native-target');
      let primaryFailure: unknown;
      try {
        await target.session.setRecording({ enabled: true });
        await turn(target, 'selected target only');
        const targetPath = await recording(target);
        const expected = await durable(targetPath);
        await target.dispose();
        await fixture.live.session.setRecording({ enabled: true });
        await turn(fixture.live, 'current only');
        const prior = await recording(fixture.live);
        const before = { target: expected, prior: await durable(prior) };
        const corrupt = join(dirname(prior), 'session-corrupt-sibling.llxj');
        const retired = join(dirname(prior), 'session-retired-sibling.jsonl');
        await writeFile(corrupt, 'not a native journal');
        await writeFile(retired, '{"retired":"not a native session"}\n');
        const selectedRef = await listingReference(
          fixture.live,
          reference,
          targetPath,
          expected.count,
          corrupt,
          retired,
        );
        await fixture.command(`/continue ${selectedRef}`);
        expect(fixture.live.session.getSessionId()).toBe(
          'selected-native-target',
        );
        expect(await recording(fixture.live)).toBe(targetPath);
        expect(await durable(targetPath)).toStrictEqual(before.target);
        expect(
          fixture
            .displayed()
            .filter(
              (item) =>
                item.type === 'user' ||
                item.type === 'gemini' ||
                item.type === 'gemini_content',
            ),
        ).toHaveLength(expected.count);
        expect(
          fixture.errors.filter((message) => message.type === 'error'),
        ).toStrictEqual([]);
        await turn(fixture.live, 'selected continuation');
        expect((await durable(await recording(fixture.live))).count).toBe(
          expected.count + 2,
        );
        expect(await durable(prior)).toStrictEqual(before.prior);
        await fixture.live.dispose();
        expect(
          (await readdir(dirname(prior))).filter((file) =>
            file.endsWith('.lock'),
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

  it('latest excludes current, empty and locked recordings while locked and same-session attempts preserve prior writes', async () => {
    const fixture = await nativeCommandFixture();
    const target = await fixture.agent('eligible-native-target');
    const locked = await fixture.agent('locked-native-target');
    const empty = await fixture.agent('empty-native-target');
    let primaryFailure: unknown;
    try {
      await target.session.setRecording({ enabled: true });
      await turn(target, 'eligible only');
      const eligiblePath = await recording(target);
      const eligibleRows = await durable(eligiblePath);
      await target.dispose();
      await locked.session.setRecording({ enabled: true });
      await turn(locked, 'locked only');
      const lockedPath = await recording(locked);
      const before = {
        locked: await durable(lockedPath),
        eligible: eligibleRows,
      };
      await empty.session.setRecording({ enabled: true });
      await empty.session.recordRecordingTitle('Empty but materialized');
      const emptyPath = await recording(empty);
      await empty.dispose();
      await fixture.live.session.setRecording({ enabled: true });
      await turn(fixture.live, 'current only');
      const prior = await recording(fixture.live);
      await fixture.command('/continue locked-native-target');
      expect(fixture.errors).toHaveLength(1);
      expect(fixture.live.session.getRecording()).toMatchObject({
        enabled: true,
        path: prior,
      });
      await fixture.command('/continue cli-fault-current');
      expect(fixture.errors).toHaveLength(2);
      expect(fixture.live.session.getSessionId()).toBe('cli-fault-current');
      await turn(fixture.live, 'after refused selections');
      expect((await durable(await recording(fixture.live))).count).toBe(4);
      expect(await durable(lockedPath)).toStrictEqual(before.locked);
      for (const [path, seconds] of [
        [eligiblePath, 1700000000],
        [emptyPath, 1700000010],
        [lockedPath, 1700000020],
        [prior, 1700000030],
      ] satisfies ReadonlyArray<readonly [string, number]>)
        await utimes(path, seconds, seconds);
      await fixture.command('/continue latest');
      expect(fixture.live.session.getSessionId()).toBe(
        'eligible-native-target',
      );
      expect(await recording(fixture.live)).toBe(eligiblePath);
      expect(await durable(eligiblePath)).toStrictEqual(before.eligible);
      expect(
        await SessionLockManager.isLocked(dirname(prior), 'cli-fault-current'),
      ).toBe(false);
      expect(
        await SessionLockManager.isLocked(
          dirname(prior),
          'locked-native-target',
        ),
      ).toBe(true);
    } catch (error) {
      primaryFailure = error;
      throw error;
    } finally {
      await locked.dispose();
      await empty.dispose();
      await finishFaultTest(fixture, target, primaryFailure);
    }
  }, 30000);
});

async function listingReference(
  agent: import('@vybestack/llxprt-code-agents').Agent,
  reference: 'id' | 'prefix' | 'index',
  targetPath: string,
  count: number,
  corrupt: string,
  retired: string,
): Promise<string> {
  const guard = vi
    .spyOn(JournalSession.prototype, 'rows')
    .mockImplementation(() => {
      throw new Error('Listing must not decode native history');
    });
  let selectedRef: string;
  try {
    const listing = await agent.session.listBrowserTargetsDetailed();
    expect(
      listing.unreadableRecordings.map((entry) => entry.filePath).sort(),
    ).toStrictEqual([corrupt, retired].sort());
    const sessions = listing.targets.filter(
      (entry) => entry.kind === 'session',
    );
    const selected = sessions.find(
      (entry) => entry.session.filePath === targetPath,
    );
    if (selected === undefined)
      throw new Error('Selected journal missing from frontend listing');
    expect(selected.session).toMatchObject({
      sessionId: 'selected-native-target',
      messageCount: count,
      provider: 'fake',
      model: 'fake-model',
    });
    const references = {
      id: selected.session.sessionId,
      prefix: 'selected-native',
      index: String(sessions.indexOf(selected) + 1),
    };
    selectedRef = references[reference];
  } finally {
    guard.mockRestore();
  }
  return selectedRef;
}
