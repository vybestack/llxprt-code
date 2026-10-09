/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import { deferred } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import {
  withCheckpoint,
  checkpointUiHistory,
  checkpointTool,
} from '../hooks/agentStream/checkpoint-disk-test-helpers.js';
import { restoreCommand } from './restoreCommand.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';

function gateDurableWrite(
  gate: ReturnType<typeof deferred>,
  entered: ReturnType<typeof deferred>,
): void {
  const wait = SessionRecordingService.prototype.waitForCommit;
  vi.spyOn(
    SessionRecordingService.prototype,
    'waitForCommit',
  ).mockImplementation(async function (this: SessionRecordingService, ...args) {
    if (
      JSON.stringify(args[0].payload).includes('acknowledged checkpoint row')
    ) {
      entered.resolve();
      await gate.promise;
    }
    return wait.call(this, ...args);
  });
}

async function pausedRestore(
  cancel: boolean,
  active = false,
): Promise<boolean> {
  return withCheckpoint(1, active, async (fixture, dir) => {
    const factory = fixture.config.getTokenizerFactory();
    if (!factory) throw new Error('Missing explicit token contract');
    fixture.history.setTokenizerFactory(factory);
    fixture.history.setBaseTokenOffset(0);
    await fixture.history.recalculateTokens();
    const previousTokens = 2050;
    expect(fixture.history.getTotalTokens()).toBe(previousTokens);
    const gate = deferred();
    const entered = deferred();
    const abort = new AbortController();
    const row = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'acknowledged checkpoint row' }],
    };
    await writeFile(
      join(dir, 'restore.json'),
      JSON.stringify({
        history: checkpointUiHistory,
        clientHistory: [row],
        toolCall: checkpointTool.request,
      }),
    );
    vi.spyOn(
      fixture.config.storage,
      'getProjectTempCheckpointsDir',
    ).mockReturnValue(dir);
    vi.spyOn(fixture.config, 'getCheckpointingEnabled').mockReturnValue(true);
    const context = createMockCommandContext();
    context.signal = abort.signal;
    context.services.config = fixture.config;
    let uiPublished = false;
    context.ui.loadHistory = () => {
      uiPublished = true;
    };
    gateDurableWrite(gate, entered);
    let completed = false;
    const restoring = Promise.resolve(
      restoreCommand(fixture.config)?.action?.(context, 'restore'),
    ).then((result) => {
      completed = true;
      return result;
    });
    try {
      await entered.promise;
      expect(completed).toBe(false);
      expect(uiPublished).toBe(false);
      expect(fixture.history.getTotalTokens()).toBe(previousTokens);
      if (cancel) abort.abort(new Error('cancel checkpoint acknowledgement'));
      gate.resolve();
      const result = await restoring;
      expect(result?.type).toBe(cancel ? 'message' : 'tool');
      if (cancel) expect(fixture.history.getTotalTokens()).toBe(previousTokens);
      else
        expect(fixture.history.getTotalTokens()).toBe(
          'acknowledged checkpoint row'.length,
        );
      return uiPublished;
    } finally {
      gate.resolve();
      await restoring;
      vi.restoreAllMocks();
    }
  });
}

describe('real CLI checkpoint durable publication', () => {
  it.each([false, true])(
    'does not expose history or UI before durable acknowledgement, cancelled=%s',
    async (cancel) => {
      expect(await pausedRestore(cancel)).toBe(!cancel);
    },
    180000,
  );

  it.each([false, true])(
    'does not expose active history or UI before durable acknowledgement, cancelled=%s',
    async (cancel) => {
      expect(await pausedRestore(cancel, true)).toBe(!cancel);
    },
    180000,
  );
});
