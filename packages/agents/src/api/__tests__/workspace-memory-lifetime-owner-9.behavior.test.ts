import { afterEach, describe, expect, it, vi } from 'bun:test';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const cleanups: Array<() => Promise<void>> = [];

describe('supplied workspace memory lifetime through public adoption', () => {
  useFakeResponsesReplay('plain-text.jsonl');
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  for (const operationFirst of [false, true]) {
    it(`disposes explicitly transferred preflight memory exactly once across adoption and facade retirement (operation first ${operationFirst})`, async () => {
      const route = await openRouteBPreflight({
        config: {
          sessionId: 'same-memory-label',
          folderTrust: true,
          mcpEnabled: false,
          skillsSupport: false,
          recording: { enabled: false },
          telemetry: { enabled: false },
          settings: { jitContextEnabled: false },
        },
      });
      cleanups.push(route.close);
      const { memory } = route;
      const dispose = vi.spyOn(memory, 'dispose');
      await route.prepare();
      const agent = await route.createAgent();
      cleanups.push(() => agent.dispose());
      if (operationFirst) {
        await route.disposePreflight();
        await agent.dispose();
      } else {
        await agent.dispose();
        await route.disposePreflight();
      }
      expect(() => memory.operations.refresh()).toThrow('disposed');
      expect(dispose).toHaveBeenCalledTimes(1);
    });
  }
});
