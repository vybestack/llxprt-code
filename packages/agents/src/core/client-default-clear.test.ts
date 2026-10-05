/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withPublicHistory } from '../api/__tests__/helpers/public-history-fixture.js';
import { internalConfig } from '../api/__tests__/helpers/agentHarness.js';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import { historyDigest } from './reinitialize-history-test-helpers.js';
import { publicDefaultBounds } from './public-default-history-test-helpers.js';
import { createHash } from 'node:crypto';
import { SessionControl } from '../api/control/sessionControl.js';

for (const size of [512, 8192]) {
  describe(`default history clear consumer ${size}`, () => {
    it('keeps the complete first human turn using disk candidates and no public array', async () => {
      await withPublicHistory(size, true, async (agent, _history, reader) => {
        if (!(agent.session instanceof SessionControl))
          throw new Error('Expected real SessionControl');
        await agent.session.setRecording({ enabled: true });
        await agent.session.clearHistory();
        const result = await historyDigest(
          internalConfig(agent).getAgentClient().getHistory(),
        );
        const hash = createHash('sha256');
        for (let index = 0; index < 3; index++)
          hash.update(JSON.stringify(accountingRow(index)));
        expect(result).toStrictEqual({ count: 3, digest: hash.digest('hex') });
        expect(reader.snapshot().liveRows).toBe(0);
        expect(reader.within(publicDefaultBounds)).toBe(true);
      });
    }, 120_000);
  });
}

describe('stream reset contract', () => {
  it('consumes a cold source through resetChat and durably replaces the active history', async () => {
    await withPublicHistory(6, true, async (agent, _history, reader) => {
      const client = internalConfig(agent).getAgentClient();
      async function* preserved() {
        yield accountingRow(0);
      }
      await client.resetChat(preserved());
      expect(await historyDigest(client.getHistory())).toStrictEqual({
        count: 1,
        digest: createHash('sha256')
          .update(JSON.stringify(accountingRow(0)))
          .digest('hex'),
      });
      expect(reader.snapshot().liveRows).toBe(0);
    });
  });
});
