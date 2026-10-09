/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { ResponsesDiskTextRows } from '@vybestack/llxprt-code-providers/openai-responses/responses-disk-text-rows.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import {
  buildSourceProviderChatOptions,
  enforceAndStreamSourcePromptEnvelopeRetries,
} from './prompt-envelope-source-send.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  preflightDisk,
  preflightRuntime,
  preflightEndpoint,
  preflightInstructions,
} from './__tests__/support/source-preflight-fixture.js';

const root = sourceRootSetup();
describe('source prepared transactional cleanup failure', () => {
  it('preserves synchronous preflight failure and source close failure without retry or upload', async () => {
    const fixture = await preflightDisk(root(), false);
    const http = preflightEndpoint();
    const setup = preflightRuntime(
      root(),
      `http://127.0.0.1:${http.server.port}/v1`,
    );
    const failed = new Error('preflight synchronous failure');
    const cleanupFailed = new Error('source close failure');
    const source = new ResponsesDiskTextRows({
      count: fixture.source.count,
      openReader: (signal) => fixture.source.openReader(signal),
      async close(): Promise<void> {
        await fixture.source.close();
        throw cleanupFailed;
      },
    });
    let callbacks = 0;
    let retries = 0;
    const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
      provider: setup.provider,
      source,
      buildOptions: (rows) =>
        buildSourceProviderChatOptions(
          rows,
          undefined,
          setup.context,
          setup.invocation,
          undefined,
          preflightInstructions,
        ),
      enforce: async (rows, estimate) => {
        await estimate(rows);
        return rows;
      },
      onPrepared: (): void => {
        callbacks++;
        throw failed;
      },
      shouldRetryOnError: () => {
        retries++;
        return true;
      },
    });
    try {
      const error = await stream.next().then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError))
        throw new Error('Missing aggregate');
      expect(error.errors).toContain(failed);
      expect(error.errors).toContain(cleanupFailed);
      expect(http.bodies).toHaveLength(0);
      expect(callbacks).toBe(1);
      expect(retries).toBe(0);
      expect(fixture.state.closed).toBe(1);
      expect(fixture.state.active).toBe(0);
      expect(activeRequestBodyCount()).toBe(0);
    } finally {
      await stream.return?.();
      await http.server.stop(true);
      await setup.config.dispose();
    }
  }, 30000);
});
