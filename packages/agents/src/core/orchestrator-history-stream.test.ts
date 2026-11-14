/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withPublicHistory } from './__tests__/support/core-public-history-fixture.js';

for (const size of [65]) {
  describe(`invoked orchestrator history with ${size} mixed rows`, () => {
    it('sends a turn without the public array read and releases its source', async () => {
      await withPublicHistory(
        size,
        true,
        async (agent, _history, reader, _decoded, client) => {
          agent.setEphemeralSetting('context-limit', 100_000_000);
          let output = '';
          for await (const event of client.sendMessageStream(
            'reply plainly',
            new AbortController().signal,
            `stream-history-${size}`,
            1,
          )) {
            if (event.type === 'content') output += event.value;
          }
          expect(output).toContain('a plain text reply');
          expect(reader.snapshot().liveRows).toBe(0);
        },
      );
    }, 120_000);
  });
}
