/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { requestSelection } from './__tests__/support/request-selection.js';
import { NativeResponsesEstimateProjection } from './native-responses-estimate.js';
import { activeRequestBodyCount } from '../utils/requestScopedBody.js';
import { diskTextFixture } from './__tests__/support/disk-text-fixture.js';
import { projectionRuntime } from './__tests__/support/projection-ownership-fixture.js';

describe('actual prepared native reader ownership', () => {
  it('propagates source I/O failure and releases the body lease without creating prompt segments', async () => {
    const disk = diskTextFixture(false, false);
    const setup = await projectionRuntime('http://127.0.0.1:1/v1', disk.root);
    const before = new Set(readdirSync(getScratchRoot()));
    const options = setup.options(requestSelection(disk.rows));
    const projection = await setup.provider.projectPromptEnvelope(options);
    const savedFetch = globalThis.fetch;
    try {
      expect(projection.finalizedProjection).toBeInstanceOf(
        NativeResponsesEstimateProjection,
      );
      unlinkSync(join(disk.root, '0.row'));
      await expect(
        estimatePromptEnvelope(setup.provider.name, projection, setup.factory),
      ).rejects.toThrow('ENOENT');
      globalThis.fetch = Object.assign(
        async (
          _input: Parameters<typeof fetch>[0],
          init?: RequestInit,
        ): Promise<Response> => {
          await new Response(init?.body).text();
          throw new Error('Broken source unexpectedly completed');
        },
        { preconnect: savedFetch.preconnect },
      );
      const stream = setup.provider.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      });
      await expect(stream.next()).rejects.toThrow('ENOENT');
      await projection.releaseIfUnsent?.();
      await expect(
        estimatePromptEnvelope(setup.provider.name, projection, setup.factory),
      ).rejects.toThrow('closed');
      expect(
        readdirSync(getScratchRoot()).filter((name) => !before.has(name)),
      ).toStrictEqual([]);
      expect(disk.state.active).toBe(0);
      expect(activeRequestBodyCount()).toBe(0);
    } finally {
      globalThis.fetch = savedFetch;
      await projection.releaseIfUnsent?.();
      disk.close();
      await setup.config.dispose();
    }
  });
});
