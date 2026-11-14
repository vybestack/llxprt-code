/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import {
  nativeAcpFixture,
  nativeRows,
  replayText,
} from './__tests__/support/native-acp-fault-fixture.js';

describe('native ACP live replacement and serialization', () => {
  it('runs a queued same-ID load after an earlier replay rejection without leaking either owner', async () => {
    const fixture = await nativeAcpFixture();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    try {
      const id = await fixture.create();
      await fixture.prompt(id);
      await fixture.peer.client.closeSession({ sessionId: id });
      const path = await fixture.path(id);
      const before = await nativeRows(path);
      let rejected = false;
      fixture.consume(async (update) => {
        if (!replayText(update) || rejected) return;
        rejected = true;
        entered.resolve();
        await release.promise;
        throw new Error('First queued replay rejected externally');
      });
      const first = fixture.load(id).then(
        () => {
          throw new Error('Failed replay resolved');
        },
        (reason: unknown) => reason,
      );
      await entered.promise;
      const queued = fixture.load(id);
      release.resolve();
      expect(await first).toMatchObject({
        code: -32603,
        data: { phase: 'replay' },
      });
      expect((await queued).modes?.currentModeId).toBe('default');
      expect(
        fixture.recordings.filter((recording) => recording.isActive()),
      ).toHaveLength(1);
      expect(await fixture.locks()).toHaveLength(1);
      expect(await nativeRows(path)).toStrictEqual({ ...before });
      expect(await fixture.prompt(id)).toMatchObject({
        stopReason: 'end_turn',
      });
      await fixture.peer.client.closeSession({ sessionId: id });
      expect((await nativeRows(path)).count).toBe(4);
      expect(await nativeRows(path, 2)).toStrictEqual({ ...before });
      expect(await fixture.locks()).toStrictEqual([]);
    } finally {
      release.resolve();
      await fixture.finish();
    }
  }, 30000);

  it('replaces a live same-ID owner from disk and later writes only to its recording', async () => {
    const fixture = await nativeAcpFixture();
    try {
      const id = await fixture.create();
      await fixture.prompt(id);
      const path = await fixture.path(id);
      const before = await nativeRows(path);
      const other = await fixture.create();
      await fixture.prompt(other, 'Unrelated native session');
      const unrelatedPath = await fixture.path(other);
      const unrelated = await nativeRows(unrelatedPath);
      const prior = fixture.recordings.find(
        (recording) => recording.getSessionId() === id,
      );
      if (prior === undefined) throw new Error('Missing prior owner');
      fixture.updates.length = 0;
      await fixture.load(id);
      expect(prior.isActive()).toBe(false);
      expect(
        fixture.recordings.filter(
          (recording) =>
            recording.isActive() && recording.getSessionId() === id,
        ),
      ).toHaveLength(1);
      expect(
        fixture.updates
          .filter(replayText)
          .map((update) => update.sessionUpdate),
      ).toStrictEqual(['user_message_chunk', 'agent_message_chunk']);
      expect(await nativeRows(path)).toStrictEqual({ ...before });
      expect(await fixture.locks()).toHaveLength(2);
      expect(await fixture.prompt(id)).toMatchObject({
        stopReason: 'end_turn',
      });
      expect((await nativeRows(path)).count).toBe(4);
      expect(await nativeRows(path, 2)).toStrictEqual({ ...before });
      expect(await nativeRows(unrelatedPath)).toStrictEqual({ ...unrelated });
      await fixture.peer.client.closeSession({ sessionId: id });
      expect(await fixture.locks()).toHaveLength(1);
      expect(await fixture.prompt(other)).toMatchObject({
        stopReason: 'end_turn',
      });
      await fixture.peer.client.closeSession({ sessionId: other });
      expect((await nativeRows(unrelatedPath)).count).toBe(4);
    } finally {
      await fixture.finish();
    }
  }, 30000);

  it('serializes concurrent same-ID loads through replay completion and retains one promptable owner', async () => {
    const fixture = await nativeAcpFixture();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    try {
      const id = await fixture.create();
      await fixture.prompt(id);
      await fixture.peer.client.closeSession({ sessionId: id });
      const path = await fixture.path(id);
      const before = await nativeRows(path);
      let texts = 0;
      fixture.consume(async (update) => {
        if (!replayText(update)) return;
        if (++texts === 1) {
          entered.resolve();
          await release.promise;
        }
      });
      const first = fixture.load(id);
      await entered.promise;
      const held = fixture.recordings.filter((recording) =>
        recording.isActive(),
      );
      expect(held).toHaveLength(1);
      let secondSettled = false;
      const second = fixture.load(id).finally(() => {
        secondSettled = true;
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(secondSettled).toBe(false);
      expect(texts).toBe(1);
      expect(await fixture.locks()).toHaveLength(1);
      release.resolve();
      expect(
        (await Promise.all([first, second])).map(
          (result) => result.modes?.currentModeId,
        ),
      ).toStrictEqual(['default', 'default']);
      expect(texts).toBe(4);
      expect(held[0].isActive()).toBe(false);
      expect(
        fixture.recordings.filter((recording) => recording.isActive()),
      ).toHaveLength(1);
      expect(await nativeRows(path)).toStrictEqual({ ...before });
      expect(await fixture.prompt(id)).toMatchObject({
        stopReason: 'end_turn',
      });
      await fixture.peer.client.closeSession({ sessionId: id });
      expect((await nativeRows(path)).count).toBe(4);
      expect(await nativeRows(path, 2)).toStrictEqual({ ...before });
      expect(await fixture.locks()).toStrictEqual([]);
    } finally {
      release.resolve();
      await fixture.finish();
    }
  }, 30000);

  it('preserves a live recorder and later durable writes when the replacement directory read fails', async () => {
    let rejectListing = false;
    const failure = new Error('External native directory read failed');
    const fixture = await nativeAcpFixture(async (path) => {
      if (rejectListing) throw failure;
      return readdir(path);
    });
    try {
      const id = await fixture.create();
      await fixture.prompt(id);
      const path = await fixture.path(id);
      const before = await nativeRows(path);
      const prior = fixture.recordings.find(
        (recording) => recording.getSessionId() === id,
      );
      if (prior === undefined) throw new Error('Missing live recorder');
      rejectListing = true;
      await expect(
        fixture.zed.loadSession({
          sessionId: id,
          cwd: fixture.root,
          mcpServers: [],
        }),
      ).rejects.toBe(failure);
      expect(prior.isActive()).toBe(true);
      expect(await fixture.locks()).toHaveLength(1);
      rejectListing = false;
      expect(await fixture.prompt(id)).toMatchObject({
        stopReason: 'end_turn',
      });
      await fixture.peer.client.closeSession({ sessionId: id });
      expect((await nativeRows(path)).count).toBe(4);
      expect(await nativeRows(path, 2)).toStrictEqual({ ...before });
    } finally {
      await fixture.finish();
    }
  }, 30000);
});

async function unrecordedFixture() {
  const fixture = await nativeAcpFixture();
  const unavailable = vi
    .spyOn(JournalRecordingService, 'createLocked')
    .mockRejectedValue(new Error('Native recording startup unavailable'));
  try {
    const id = await fixture.create();
    unavailable.mockRestore();
    await fixture.prompt(id, 'Live unrecorded native row');
    fixture.updates.length = 0;
    return { fixture, id };
  } catch (error) {
    await fixture.finish();
    throw error;
  } finally {
    unavailable.mockRestore();
  }
}

describe('native ACP no-recording reattach', () => {
  it('reattaches a nonempty live native history without borrowing a recorder', async () => {
    const { fixture, id } = await unrecordedFixture();
    try {
      let delivered = 0;
      fixture.consume(async (update) => {
        if (replayText(update)) delivered++;
      });
      expect((await fixture.load(id)).modes?.currentModeId).toBe('default');
      expect(delivered).toBe(2);
      expect(await fixture.prompt(id)).toMatchObject({
        stopReason: 'end_turn',
      });
      expect(
        fixture.recordings.filter((recording) => recording.isActive()),
      ).toStrictEqual([]);
      expect(await fixture.locks()).toStrictEqual([]);
      expect(
        (
          await fixture.peer.client.listSessions({ cwd: fixture.root })
        ).sessions.some((entry) => entry.sessionId === id),
      ).toBe(true);
    } finally {
      await fixture.finish();
    }
  }, 30000);

  it('releases a nonempty live native history after external reattach delivery failure', async () => {
    const { fixture, id } = await unrecordedFixture();
    try {
      fixture.consume(async (update) => {
        if (replayText(update))
          throw new Error('Live replay external consumer failed');
      });
      await expect(fixture.load(id)).rejects.toMatchObject({
        code: -32603,
        data: { phase: 'replay' },
      });
      await expect(
        fixture.zed.prompt({
          sessionId: id,
          prompt: [{ type: 'text', text: 'Failed reattach' }],
        }),
      ).rejects.toThrow('Session not found');
      expect(
        fixture.recordings.filter((recording) => recording.isActive()),
      ).toStrictEqual([]);
      expect(await fixture.locks()).toStrictEqual([]);
      expect(
        (
          await fixture.peer.client.listSessions({ cwd: fixture.root })
        ).sessions.some((entry) => entry.sessionId === id),
      ).toBe(false);
    } finally {
      await fixture.finish();
    }
  }, 30000);
});
