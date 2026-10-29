/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import {
  nativeAcpFixture,
  nativeRows,
  nativeFailureLeaves,
  replayText,
} from './__tests__/support/native-acp-fault-fixture.js';

describe('native ACP independent cleanup', () => {
  it('reports replay, native recorder and session credential disposal failures independently and leaves a clean later load', async () => {
    const fixture = await nativeAcpFixture();
    const primary = new Error('External replay consumer failed');
    const recorderFault = new Error('Native recorder disposal failed');
    const credentialFault = new Error('Session credential disposal failed');
    const recorderDispose = JournalRecordingService.prototype.dispose;
    const acquireKeys =
      fixture.credentialAuthority.createProviderKeyStorage.bind(
        fixture.credentialAuthority,
      );
    let failedPath: string | undefined;
    const recorder = vi
      .spyOn(JournalRecordingService.prototype, 'dispose')
      .mockImplementation(async function (
        this: JournalRecordingService,
      ): Promise<void> {
        await recorderDispose.call(this);
        if (this.getFilePath() === failedPath) throw recorderFault;
      });
    const infrastructure = vi
      .spyOn(fixture.credentialAuthority, 'createProviderKeyStorage')
      .mockImplementation(() => {
        const keys = acquireKeys();
        const close = keys.close.bind(keys);
        keys.close = () => {
          close();
          if (failedPath !== undefined) throw credentialFault;
        };
        return keys;
      });
    try {
      const id = await fixture.create();
      await fixture.prompt(id);
      await fixture.peer.client.closeSession({ sessionId: id });
      failedPath = await fixture.path(id);
      const before = await nativeRows(failedPath);
      fixture.consume(async (update) => {
        if (replayText(update)) throw primary;
      });
      const error = await fixture.zed
        .loadSession({ sessionId: id, cwd: fixture.root, mcpServers: [] })
        .catch((reason: unknown) => reason);
      expect(error).toMatchObject({
        code: -32603,
        data: { phase: 'replay', sessionId: id },
      });
      if (!(error instanceof Error) || !(error.cause instanceof AggregateError))
        throw new Error('Missing primary and cleanup errors');
      expect(error.cause.errors).toHaveLength(2);
      expect(error.cause.errors[0]).toBe(primary);
      const cleanup: unknown = error.cause.errors[1];
      expect(cleanup).toMatchObject({ name: 'AggregateDisposeError' });
      expect(nativeFailureLeaves(error)).toStrictEqual([
        primary,
        recorderFault,
        credentialFault,
      ]);
      const [, recorderError, infrastructureError] = nativeFailureLeaves(error);
      expect(recorderError).toBe(recorderFault);
      expect(infrastructureError).toBe(credentialFault);
      expect(await fixture.locks()).toStrictEqual([]);
      expect(await nativeRows(failedPath)).toStrictEqual({ ...before });
      failedPath = undefined;
      fixture.consume(async () => {});
      await fixture.load(id);
      expect(await fixture.prompt(id)).toMatchObject({
        stopReason: 'end_turn',
      });
      await fixture.peer.client.closeSession({ sessionId: id });
      expect((await nativeRows(await fixture.path(id))).count).toBe(4);
    } finally {
      recorder.mockRestore();
      infrastructure.mockRestore();
      await fixture.finish();
    }
  }, 30000);
});
