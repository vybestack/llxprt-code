/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { AggregateDisposeError } from '../disposeErrors.js';
import { buildAgent } from './helpers/agentHarness.js';

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function leaves(error: unknown): unknown[] {
  if (error instanceof AggregateError || error instanceof AggregateDisposeError)
    return error.errors.flatMap((cause: unknown) => leaves(cause));
  return [error];
}

describe('manual MCP cancellation failure ownership', () => {
  it('aborts every accepted authentication, joins external work, and retains undefined and repeated abort failures in order', async () => {
    const entered = gate();
    const released = gate();
    const signals: AbortSignal[] = [];
    const repeated = new Error('physical MCP abort failed after cancellation');
    const reasons: unknown[] = [undefined, repeated, repeated];
    const network = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const signal = init?.signal;
          if (signal === undefined || signal === null)
            throw new Error(
              'MCP metadata requires its actual authentication signal',
            );
          signals.push(signal);
          if (signals.length === reasons.length) entered.release();
          await released.promise;
          return new Response(null, { status: 401 });
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    const built = await buildAgent('multi-turn-text.jsonl', {
      folderTrust: false,
      mcpServers: {
        first: { httpUrl: 'https://first.mcp-owner.test/mcp' },
        second: { httpUrl: 'https://second.mcp-owner.test/mcp' },
        third: { httpUrl: 'https://third.mcp-owner.test/mcp' },
      },
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    const authentication = ['first', 'second', 'third'].map((server) =>
      built.agent.mcp.authenticate(server).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      ),
    );
    let disposal: Promise<unknown> | undefined;
    let restoreAbort = (): void => {};
    try {
      await entered.promise;
      const physicalAbort = AbortController.prototype.abort;
      const abort = spyOn(
        AbortController.prototype,
        'abort',
      ).mockImplementation(function (
        this: AbortController,
        reason?: unknown,
      ): void {
        physicalAbort.call(this, reason);
        const index = signals.indexOf(this.signal);
        if (index !== -1) throw reasons[index];
      });
      restoreAbort = () => abort.mockRestore();
      let settled = false;
      const pending = built.agent.dispose();
      disposal = pending.then(
        () => {
          settled = true;
          return { fulfilled: true };
        },
        (error: unknown) => {
          settled = true;
          return { error };
        },
      );
      restoreAbort();
      expect(signals.map((signal) => signal.aborted)).toStrictEqual([
        true,
        true,
        true,
      ]);
      expect(new Set([pending, built.agent.dispose()]).size).toBe(1);
      await Promise.resolve();
      expect(settled).toBe(false);
      await expect(built.agent.mcp.authenticate('first')).rejects.toThrow(
        'MCP authentication owner disposed',
      );
      released.release();
      const result = await disposal;
      if (typeof result !== 'object' || result === null || !('error' in result))
        throw new Error(
          'MCP shutdown must retain physical cancellation failures',
        );
      const failures = leaves(result.error);
      expect(failures).toStrictEqual(reasons);
      reasons.forEach((reason, index) => expect(failures[index]).toBe(reason));
      expect(await Promise.all(authentication)).toStrictEqual([
        expect.objectContaining({
          error: expect.objectContaining({ name: 'AbortError' }),
        }),
        expect.objectContaining({
          error: expect.objectContaining({ name: 'AbortError' }),
        }),
        expect.objectContaining({
          error: expect.objectContaining({ name: 'AbortError' }),
        }),
      ]);
      expect(signals).toHaveLength(3);
    } finally {
      restoreAbort();
      released.release();
      await Promise.allSettled([...authentication, disposal, built.cleanup()]);
      network.mockRestore();
    }
  }, 30000);
});
