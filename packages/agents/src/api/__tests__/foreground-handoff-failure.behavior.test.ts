/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { AggregateDisposeError } from '../disposeErrors.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

function causes(error: unknown): unknown[] {
  if (error instanceof AggregateError || error instanceof AggregateDisposeError)
    return error.errors.flatMap(causes);
  return [error];
}

describe('foreground MCP handoff failure', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  it('releases transferred owners once and retains trust cleanup before MCP accepts it', async () => {
    const route = await openRouteBPreflight({
      config: {
        mcpEnabled: false,
        skillsSupport: false,
        recording: { enabled: false },
        telemetry: { enabled: false },
      },
    });
    let trustReleases = 0;
    await route.prepare({
      trustCleanup: async () => {
        trustReleases++;
        await route.trust.dispose();
      },
    });
    const primary = new Error('MCP construction input failed');
    const cleanup = new Error('memory retirement failed');
    const input = spyOn(route.config, 'getMcpServerCommand').mockImplementation(
      () => {
        throw primary;
      },
    );
    const disposeMemory = route.memory.dispose.bind(route.memory);
    const memory = spyOn(route.memory, 'dispose').mockImplementation(
      async () => {
        await disposeMemory();
        throw cleanup;
      },
    );
    try {
      const outcome = await route.createAgent().then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(causes(outcome)).toStrictEqual([primary, cleanup]);
      expect(trustReleases).toBe(1);
    } finally {
      input.mockRestore();
      memory.mockRestore();
      await route.close();
    }
  });
});
