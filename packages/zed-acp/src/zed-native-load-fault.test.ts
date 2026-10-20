/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import {
  nativeAcpFixture,
  nativeRows,
  replayText,
} from './__tests__/support/native-acp-fault-fixture.js';

describe('native ACP load ownership', () => {
  for (const failAfter of [0, 2]) {
    it(`releases a disk load rejected after ${failAfter} replay updates and later loads without duplicating history`, async () => {
      const fixture = await nativeAcpFixture();
      try {
        const id = await fixture.create();
        await fixture.prompt(id);
        await fixture.prompt(id);
        await fixture.peer.client.closeSession({ sessionId: id });
        const path = await fixture.path(id);
        const before = await nativeRows(path);
        expect(before.count).toBe(4);
        const delivered: string[] = [];
        fixture.consume(async (update) => {
          if (!replayText(update)) return;
          if (delivered.length === failAfter)
            throw new Error('External replay consumer rejected');
          delivered.push(update.sessionUpdate);
        });
        await expect(fixture.load(id)).rejects.toMatchObject({
          code: -32603,
          data: {
            phase: 'replay',
            reason: 'External replay consumer rejected',
          },
        });
        expect(delivered).toHaveLength(failAfter);
        expect(await nativeRows(path)).toStrictEqual({ ...before });
        expect(await fixture.locks()).toStrictEqual([]);
        await expect(
          fixture.zed.prompt({
            sessionId: id,
            prompt: [{ type: 'text', text: 'Missing failed owner' }],
          }),
        ).rejects.toThrow('Session not found');
        fixture.consume(async () => {});
        expect((await fixture.load(id)).modes?.currentModeId).toBe('default');
        expect(await nativeRows(path)).toStrictEqual({ ...before });
        expect(await fixture.locks()).toHaveLength(1);
        expect(await fixture.prompt(id)).toMatchObject({
          stopReason: 'end_turn',
        });
        await fixture.peer.client.closeSession({ sessionId: id });
        expect((await nativeRows(path)).count).toBe(6);
        expect(await nativeRows(path, 4)).toStrictEqual({ ...before });
        expect(await fixture.locks()).toStrictEqual([]);
      } finally {
        await fixture.finish();
      }
    }, 30000);
  }

  it('keeps the replay consumer and recorder cleanup failures with exact causes while releasing the native lock', async () => {
    const fixture = await nativeAcpFixture();
    const primary = new Error('External consumer fault');
    const cleanup = new Error('Native recorder close fault');
    const dispose = JournalRecordingService.prototype.dispose;
    let faultPath: string | undefined;
    const close = vi
      .spyOn(JournalRecordingService.prototype, 'dispose')
      .mockImplementation(async function (
        this: JournalRecordingService,
      ): Promise<void> {
        await dispose.call(this);
        if (this.getFilePath() === faultPath) throw cleanup;
      });
    try {
      const id = await fixture.create();
      await fixture.prompt(id);
      await fixture.peer.client.closeSession({ sessionId: id });
      faultPath = await fixture.path(id);
      const before = await nativeRows(faultPath);
      fixture.consume(async (update) => {
        if (replayText(update)) throw primary;
      });
      const error = await fixture.zed
        .loadSession({ sessionId: id, cwd: fixture.root, mcpServers: [] })
        .catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError))
        throw new Error('Missing combined load failure');
      expect(error.errors).toHaveLength(2);
      expect(error.errors[0]).toMatchObject({ code: -32603, cause: primary });
      const disposal: unknown = error.errors[1];
      expect(disposal).toMatchObject({
        name: 'AggregateDisposeError',
        errors: [cleanup],
      });
      if (
        !(disposal instanceof Error) ||
        !('errors' in disposal) ||
        !Array.isArray(disposal.errors)
      )
        throw new Error('Missing Agent disposal diagnostic');
      expect(disposal.errors).toStrictEqual([cleanup]);
      expect(disposal.errors[0]).toBe(cleanup);
      expect(error.cause).toBe(error.errors[0]);
      expect(await fixture.locks()).toStrictEqual([]);
      expect(await nativeRows(faultPath)).toStrictEqual({ ...before });
      faultPath = undefined;
      fixture.consume(async () => {});
      await fixture.load(id);
      expect(await fixture.prompt(id)).toMatchObject({
        stopReason: 'end_turn',
      });
    } finally {
      close.mockRestore();
      await fixture.finish();
    }
  }, 30000);
});
