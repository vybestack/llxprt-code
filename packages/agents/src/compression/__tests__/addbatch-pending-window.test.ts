/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DirectMessageProcessor } from '../../core/DirectMessageProcessor.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { batchRow } from '../../../../core/src/services/history/__tests__/support/addbatch-stream-test-helpers.js';
import {
  pendingCaller,
  pendingGate,
  withPendingFixture,
} from './pending-window-disk-helpers.js';

async function pendingBatch(size: number): Promise<number> {
  return withPendingFixture(size, async (fixture) => {
    const { history, recorder, owners, assertCommitted, setup } = fixture;
    const batch = Array.from({ length: size }, (_, index) =>
      batchRow(size + index),
    );
    await history.addBatch(batch, undefined, { streamPublication: true });
    await history.waitForCommit();
    expect(batch).toHaveLength(size);
    const callers = [pendingCaller(0), pendingCaller(1)];
    history.add(callers[0]);
    history.add(callers[1]);
    await assertCommitted();
    const markers = callers.map((row) => row.metadata?.chronology);
    history.startCompression();
    const queued = pendingCaller(2);
    history.add(queued);
    const ready = pendingGate();
    const gate = pendingGate();
    await fixture.pausePublication(ready, gate);
    const operation = setup.handler.enforceContextWindow(
      600,
      'addbatch-pending-window',
    );
    await ready.promise;
    try {
      expect(owners.snapshot().liveRows).toBeGreaterThan(0);
      expect(owners.snapshot().liveRows).toBeLessThanOrEqual(440);
      expect(owners.snapshot().liveSerializedBytes).toBeLessThanOrEqual(
        8 * 1024 * 1024,
      );
      expect(queued.metadata?.chronology).toBeUndefined();
    } finally {
      gate.resolve();
    }
    await operation;
    const installed = await collectRawHistory(history);
    expect(installed).toHaveLength(callers.length);
    for (let index = 0; index < callers.length; index++) {
      expect(installed[index]).toStrictEqual(callers[index]);
      expect(installed[index].metadata?.chronology).toStrictEqual(
        markers[index],
      );
    }
    history.endCompression();
    const queuedRows = await collectRawHistory(history);
    expect(queuedRows[queuedRows.length - 1]).toStrictEqual(queued);
    await recorder.flush();
    expect(owners.snapshot().liveRows).toBe(0);
    expect(await collectRawHistory(history)).toStrictEqual([
      ...callers,
      queued,
    ]);

    await assertCommitted();
    let delivered = 0;
    setup.transport.beforeSend = async (options) => {
      for await (const row of options.contents) {
        expect(row.blocks).toStrictEqual(installed[delivered].blocks);
        expect(row.metadata?.chronology).toStrictEqual(markers[delivered]);
        delivered++;
      }
    };
    const runtime = createAgentRuntimeContext({
      state: setup.runtime.state,
      history,
      settings: { contextLimit: 30000 },
      prepareProviderInvocation: setup.runtime.prepareProviderInvocation,
      provider: {
        getActiveProvider: () => setup.transport,
        setActiveProvider: () => {},
      },
      telemetry: {
        logApiRequest: () => {},
        logApiResponse: () => {},
        logApiError: () => {},
      },
      tools: { listToolNames: () => [], getToolMetadata: () => undefined },
      providerRuntime: setup.runtime.providerRuntime,
    });
    const processor = new DirectMessageProcessor(
      runtime,
      () => setup.transport,
      () => setup.runtime.providerRuntime,
      {},
      history,
    );
    const response = await processor.generateDirectMessage(
      { message: installed, config: { tools: [] } },
      'pending-window-direct-message',
    );
    expect(delivered).toBe(installed.length);
    expect(
      response.content.blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(''),
    ).toBe('<state_snapshot>kept details</state_snapshot>');
    expect(await collectRawHistory(history)).toStrictEqual([
      ...callers,
      queued,
    ]);
    return queuedRows.length;
  });
}

/** Caller row values and the owner bounds hold even when the external caller
 * holds the complete batch. Stored rows are detached copies, so identity is
 * not part of the contract.
 */
describe('addBatch followed by the actual pending-window route', () => {
  it.each([65])(
    'preserves %i accepted external rows and completes fallback with a live writer',
    async (size) => {
      expect(await pendingBatch(size)).toBe(3);
    },
    180000,
  );
});
