/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import {
  nativeAcpFixture,
  nativeRows,
  replayText,
} from './__tests__/support/native-acp-fault-fixture.js';

describe('native ACP independent cleanup', () => {
  it('reports replay, native recorder and session Config disposal failures independently and leaves a clean later load', async () => {
    const fixture = await nativeAcpFixture();
    const primary = new Error('External replay consumer failed');
    const recorderFault = new Error('Native recorder disposal failed');
    const configFault = new Error('Session Config disposal failed');
    const recorderDispose = JournalRecordingService.prototype.dispose;
    const configDispose = Config.prototype.dispose;
    let failedId: string | undefined;
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
      .spyOn(Config.prototype, 'dispose')
      .mockImplementation(async function (this: Config): Promise<void> {
        await configDispose.call(this);
        if (this.getSessionId() === failedId) throw configFault;
      });
    try {
      const id = await fixture.create();
      await fixture.prompt(id);
      await fixture.peer.client.closeSession({ sessionId: id });
      failedPath = await fixture.path(id);
      failedId = id;
      const before = await nativeRows(failedPath);
      fixture.consume(async (update) => {
        if (replayText(update)) throw primary;
      });
      const error = await fixture.zed
        .loadSession({ sessionId: id, cwd: fixture.root, mcpServers: [] })
        .catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError))
        throw new Error('Missing primary and cleanup errors');
      expect(error.errors).toHaveLength(2);
      const replay: unknown = error.errors[0];
      expect(replay).toMatchObject({ code: -32603, cause: primary });
      expect(error.cause).toBe(replay);
      const cleanup: unknown = error.errors[1];
      expect(cleanup).toBeInstanceOf(AggregateError);
      if (!(cleanup instanceof AggregateError))
        throw new Error('Missing independent cleanup errors');
      expect(cleanup.errors).toHaveLength(2);
      expect(cleanup.errors[0]).toMatchObject({
        name: 'AggregateDisposeError',
        errors: [recorderFault],
      });
      expect(cleanup.errors[1]).toMatchObject({ errors: [configFault] });
      const agentError: unknown = cleanup.errors[0];
      const infrastructureError: unknown = cleanup.errors[1];
      if (
        !(agentError instanceof Error) ||
        !('errors' in agentError) ||
        !Array.isArray(agentError.errors)
      )
        throw new Error('Missing recorder error identity');
      if (!(infrastructureError instanceof AggregateError))
        throw new Error('Missing Config error identity');
      expect(agentError.errors[0]).toBe(recorderFault);
      expect(infrastructureError.errors[0]).toBe(configFault);
      expect(await fixture.locks()).toStrictEqual([]);
      expect(await nativeRows(failedPath)).toStrictEqual({ ...before });
      failedId = undefined;
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
