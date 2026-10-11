/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createSessionClientEngineFixture } from '../../../agents/src/api/__tests__/helpers/session-client-engine-fixture.js';
import { createDetachedAutoPromptClient } from './autoPromptDetachedClient.js';

describe('detached auto prompt client', () => {
  it('initializes an owner-tracked client without adding to primary history', async () => {
    const fixture = await createSessionClientEngineFixture();
    try {
      const client = await createDetachedAutoPromptClient(
        { sessionClient: fixture.owner },
        fixture.owner.getAgentClient().getContentGeneratorConfig(),
      );
      const output = await client.generateDirectMessage(
        { message: 'detached prompt' },
        'detached-owner-control',
      );
      expect(output.content.blocks.some((block) => block.type === 'text')).toBe(
        true,
      );
      expect(client).not.toBe(fixture.owner.getAgentClient());
      expect(client.mediaStore).toBe(fixture.media.store);
      expect(
        fixture.owner.getAgentClient().getHistoryService()?.getRawHistory(),
      ).toHaveLength(0);
      await client.dispose();
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects missing content generator configuration without constructing an implicit client', async () => {
    const fixture = await createSessionClientEngineFixture();
    try {
      await expect(
        createDetachedAutoPromptClient(
          { sessionClient: fixture.owner },
          undefined,
        ),
      ).rejects.toThrow('Content generator configuration is unavailable');
      await fixture.owner.getAgentClient().addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'still usable' }],
      });
      expect(
        fixture.owner.getAgentClient().getHistoryService()?.getRawHistory(),
      ).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });
});
