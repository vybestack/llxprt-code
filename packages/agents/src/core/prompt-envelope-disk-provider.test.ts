/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { getErrorStatus } from '@vybestack/llxprt-code-core/utils/retry.js';
import { requestSelection } from './__tests__/support/request-selection.js';
import { withGpt56DiskSources } from '@vybestack/llxprt-code-providers/tokenizers/gpt56-disk-tokenizer-factory.js';
import {
  diskTextFixture,
  diskTextWireOracle,
} from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';
import {
  projectionEndpoint,
  projectionRuntime,
} from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/projection-ownership-fixture.js';
import {
  enforceAndStreamSourcePromptEnvelopeRetries,
  type PromptEnvelopeSource,
} from './prompt-envelope-source-send.js';

function buildRetryOptions(
  setup: Awaited<ReturnType<typeof projectionRuntime>>,
  candidate: PromptEnvelopeSource,
) {
  const options = setup.options(candidate);
  if (options.runtime === undefined || options.settings === undefined)
    throw new Error('Missing fixture runtime');
  return {
    ...options,
    invocation: createRuntimeInvocationContext({
      runtime: options.runtime,
      settings: options.settings,
      providerName: setup.provider.name,
      ephemeralsSnapshot: { retries: 1, retrywait: 0, 'prompt-caching': 'off' },
    }),
    requestRows: candidate,
    contentCount: candidate.count,
  };
}

describe('agent source enforcement with the actual disk Responses provider', () => {
  it('enforces the exact projected estimate and replaces the prepared owner on an outer HTTP 503 retry', async () => {
    const disk = diskTextFixture(false, false);
    const rows = { ...disk.rows, close: () => disk.close() };
    const source = requestSelection(rows);
    const http = projectionEndpoint(true);
    const setup = await projectionRuntime(
      `http://127.0.0.1:${http.server.port}/v1`,
      disk.root,
    );
    setup.config.setTokenizerFactory(
      withGpt56DiskSources(setup.factory, tmpdir()),
    );
    const tokens: object[] = [];
    const estimates: number[] = [];
    const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
      provider: setup.provider,
      source,
      buildOptions: (candidate) => buildRetryOptions(setup, candidate),
      enforce: async (candidate, estimate) => {
        estimates.push(await estimate(candidate));
        return candidate;
      },
      shouldRetryOnError: (error) => getErrorStatus(error) === 503,
      send: (prepared) => {
        const token = prepared.options.promptEnvelopeTransportToken;
        if (token === undefined)
          throw new Error('Missing actual projection token');
        tokens.push(token);
        return setup.provider.generateChatCompletion(prepared.options);
      },
    });
    try {
      const pending = stream.next();
      await Promise.race([
        http.arrived.wait,
        pending.then(() => {
          throw new Error('No HTTP request');
        }),
      ]);
      http.readBody.release();
      http.respond.release();
      expect((await pending).done).toBe(false);
      await stream.return?.();
      expect(tokens).toHaveLength(2);
      expect(tokens[0]).not.toBe(tokens[1]);
      expect(estimates).toStrictEqual([5583]);
      expect(http.bodies).toStrictEqual([
        diskTextWireOracle(false),
        diskTextWireOracle(false),
      ]);
      expect(disk.state.pulled).toBe(128);
      expect(disk.state.active).toBe(0);
      expect(existsSync(disk.root)).toBe(false);
    } finally {
      http.readBody.release();
      http.respond.release();
      await stream.return?.();
      disk.close();
      await http.server.stop(true);
      await setup.config.dispose();
    }
  }, 120000);
});
