/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { useCommandOwners } from '../../../__tests__/command-owner-fixture.js';
import { prepareTurnForQuery } from './turnPreparation.js';

async function prepareOwnedTurn(owner: Agent, decoy: Agent): Promise<void> {
  const resetBuckets = Object.assign(
    () => owner.setEphemeralSetting('selected-bucket', 'primary'),
    {
      bucketFailover: {
        resetBuckets: () =>
          decoy.setEphemeralSetting('selected-bucket', 'primary'),
        ensureBucketsAuthenticated: async () => {
          await decoy.addHistory({
            speaker: 'human',
            blocks: [{ type: 'text', text: 'wrong reset owner' }],
          });
        },
      },
    },
  );
  await prepareTurnForQuery(
    false,
    resetBuckets,
    () => {},
    () => {},
    { current: [] },
    () => {},
    async () => {
      await owner.addHistory({
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: String(owner.getEphemeralSetting('selected-bucket')),
          },
        ],
      });
    },
  );
}

describe('turn preparation owner', () => {
  const makeOwner = useCommandOwners();
  it('resets and authenticates the captured session without mutating a sibling', async () => {
    const owner = await makeOwner('turn-policy-owner');
    const sibling = await makeOwner('turn-policy-sibling');
    await prepareOwnedTurn(owner, sibling);
    expect(JSON.stringify(await owner.getHistory())).toContain('primary');
    expect(await sibling.getHistory()).toHaveLength(0);
    await owner.dispose();
    await prepareOwnedTurn(sibling, owner);
    expect(JSON.stringify(await sibling.getHistory())).toContain('primary');
  });
});
