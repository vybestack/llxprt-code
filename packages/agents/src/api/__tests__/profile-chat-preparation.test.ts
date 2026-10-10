/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { fromConfig } from '../fromConfig.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import type { Profile } from '@vybestack/llxprt-code-settings';
import { fileURLToPath } from 'node:url';

import { ideContext } from '@vybestack/llxprt-code-ide-integration';
import {
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core/utils/events.js';
describe('profile-chat-preparation', () => {
  it.each([false, true])(
    'preserves chat, history and IDE view after failed replacement (initialized: %s)',
    async (initialized) => {
      const built = await buildCliStyleConfig('multi-turn-text.jsonl');
      const other = await buildCliStyleConfig('multi-turn-text.jsonl');
      const agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: initialized ? built.agentClient : undefined,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        messageBus: built.messageBus,
      });
      const ownerB = await fromConfig({
        settingsOwner: other.settingsOwner,
        settingsService: other.settingsService,
        providerManager: other.providerManager,
        config: other.config,
        mcpRuntime: other.mcpRuntime,
        messageBus: other.messageBus,
      });
      const provider = new FakeProvider(
        fileURLToPath(
          new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
        ),
        built.config.getTargetDir(),
      );
      provider.name = 'replacement';
      built.providerManager.registerProvider(provider);
      const { agentClient: client } = agent;
      const priorIde = ideContext.getIdeContext();
      const ownedClient = agent.ide.getIdeClient();
      if (ownedClient === undefined)
        throw new Error('Workspace IDE client missing');
      const contextReader = vi
        .spyOn(ownedClient, 'getIdeContext')
        .mockImplementation(() => ideContext.getIdeContext());
      agent.ide.setIdeMode(true);
      ideContext.setIdeContext({
        workspaceState: {
          openFiles: [
            { path: '/workspace/kept-editor.ts', timestamp: 1, isActive: true },
          ],
        },
      });
      if (initialized) {
        for await (const event of agent.stream('carried context')) {
          if (event.type === 'error') throw new Error(event.error.message);
        }
      } else {
        await client.storeHistoryForLaterUse([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'carried context' }],
          },
        ]);
      }
      const history = await agent.getHistory();
      const visibleHistory = client.getHistoryService();
      const listeners = coreEvents.listeners(CoreEvent.ModelChanged);
      const beforeB = ownerB.captureProfile();
      const profile: Profile = {
        version: 1,
        provider: 'replacement',
        model: 'candidate',
        modelParams: {},
        ephemeralSettings: {},
      };
      let reads = 0;
      const failure = new Error('loop boundary after chat preparation');
      const boundary = vi
        .spyOn(built.config, 'isInteractive')
        .mockImplementation(() => {
          if (++reads === 3) throw failure;
          return true;
        });
      try {
        await expect(agent.profiles.applySnapshot(profile)).rejects.toBe(
          failure,
        );
        boundary.mockRestore();
        expect(reads).toBe(3);
        expect(agent.agentClient).toBe(client);
        expect(client.hasChatInitialized()).toBe(initialized);
        expect(client.getHistoryService()).toBe(visibleHistory);
        expect(coreEvents.listeners(CoreEvent.ModelChanged)).toStrictEqual(
          listeners,
        );
        expect(await agent.getHistory()).toStrictEqual(history);
        expect(ownerB.captureProfile()).toStrictEqual(beforeB);
        const eventsB = [];
        for await (const event of ownerB.stream('owner B still works'))
          eventsB.push(event);
        expect(eventsB.some((event) => event.type === 'error')).toBe(false);
        const events = [];
        for await (const event of agent.stream('continue carried context'))
          events.push(event);
        expect(events.some((event) => event.type === 'error')).toBe(false);
        const recoveredHistory = JSON.stringify(await agent.getHistory());
        expect(recoveredHistory).toContain('carried context');
        expect(
          recoveredHistory.split('/workspace/kept-editor.ts').length - 1,
        ).toBe(1);
        await agent.profiles.applySnapshot(profile);
        expect(agent.getProvider()).toBe('replacement');
        expect(agent.getModel()).toBe('candidate');
      } finally {
        if (priorIde) ideContext.setIdeContext(priorIde);
        else ideContext.clearIdeContext();
        boundary.mockRestore();
        await ownerB.dispose();
        await agent.dispose();
        await other.cleanup();
        contextReader.mockRestore();
        await built.cleanup();
      }
    },
    30000,
  );

  it('disposal after candidate chat creation discards the owned candidate and retains the borrowed client', async () => {
    const built = await buildCliStyleConfig('multi-turn-text.jsonl');
    const agent = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      config: built.config,
      mcpRuntime: built.mcpRuntime,
      messageBus: built.messageBus,
    });
    const client = built.agentClient;
    const provider = new FakeProvider(
      fileURLToPath(
        new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
      ),
      built.config.getTargetDir(),
    );
    provider.name = 'replacement';
    built.providerManager.registerProvider(provider);
    await client.storeHistoryForLaterUse([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'still owned by caller' }],
      },
    ]);
    const history = await agent.getHistory();
    const listeners = coreEvents.listeners(CoreEvent.ModelChanged);
    let reads = 0;
    let disposal: Promise<void> | undefined;
    const boundary = vi
      .spyOn(built.config, 'isInteractive')
      .mockImplementation(() => {
        if (++reads === 3) disposal = agent.dispose();
        return true;
      });
    try {
      await expect(
        agent.profiles.applySnapshot({
          version: 1,
          provider: 'replacement',
          model: 'discarded',
          modelParams: {},
          ephemeralSettings: {},
        }),
      ).rejects.toThrow('cancelled');
      boundary.mockRestore();
      expect(disposal).toBeDefined();
      await disposal;
      expect(built.sessionClient.getAgentClient()).toBe(client);
      expect(client.hasChatInitialized()).toBe(true);
      expect(await client.getHistory()).toStrictEqual(history);
      expect(coreEvents.listeners(CoreEvent.ModelChanged)).toStrictEqual(
        listeners,
      );
      const nextOwner = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        messageBus: built.messageBus,
      });
      try {
        const events = [];
        for await (const event of nextOwner.stream('continue'))
          events.push(event);
        expect(events.some((event) => event.type === 'error')).toBe(false);
      } finally {
        await nextOwner.dispose();
      }
    } finally {
      boundary.mockRestore();
      await disposal;
      await agent.dispose();
      await built.cleanup();
    }
  }, 30000);
});
