/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createIsolatedSessionClient } from '../agentRuntimeAssembly.js';
import { createSessionClientEngineFixture } from './helpers/session-client-engine-fixture.js';

describe('Isolated session client collaborators', () => {
  it('creates a usable client without acquiring or closing its supplied provider lifetime', async () => {
    const built = await createSessionClientEngineFixture();
    try {
      const owner = await createIsolatedSessionClient(
        built.config,
        built.settingsService,
        built.handle.settingsOwner,
        built.handle.providerManager,
        built.handle.oauthManager,
        built.handle.contentGeneratorFactory,
        built.handle.tokenizerFactory,
        built.handle.providerFileLifecycle,
        built.media,
        undefined,
        built.mcp.readInstructions,
        built.mcp.workspacePaths,
        built.messageBus,
      );
      try {
        owner.bindMcpRuntime(built.mcp);
        owner.bindHooks();
        await owner.initializeTools();
        await owner.refreshAuth();
        const client = owner.getAgentClient();
        await client.startChat();
        await client.addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'independent client history' }],
        });
        expect(
          (await client.getHistory()).filter(
            (item) => item.speaker === 'human',
          ),
        ).toHaveLength(1);
        expect(
          (await built.owner.getAgentClient().getHistory()).filter(
            (item) => item.speaker === 'human',
          ),
        ).toHaveLength(0);
        await owner.dispose();
        await built.owner.refreshAuth();
        await built.owner.getAgentClient().startChat();
        expect(built.handle.providerManager.getActiveProviderName()).toBe(
          'fake',
        );
        expect(await built.media.store.getStoredByteLength()).toBe(0);
      } finally {
        await owner.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });
});
