/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  createWorkspaceEngineFixture,
  createSessionClientEngineFixture,
} from './helpers/session-client-engine-fixture.js';
import { createIsolatedRuntimeContext } from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import { registerProvidersOntoManager, createAgent } from '../createAgent.js';
import { assembleAgentActivationBootstrap } from '../providerSwitchAssembly.js';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { fileURLToPath } from 'node:url';
import { fromConfig } from '../fromConfig.js';

describe('Explicit session client lifetime', () => {
  for (const firstClosed of [0, 1]) {
    it(`keeps the shared caller and surviving facade usable when facade ${firstClosed} closes first`, async () => {
      const built = await createSessionClientEngineFixture();
      const caller = built.owner.getAgentClient();
      const options = {
        settingsService: built.settingsService,
        config: built.config,
        providerManager: built.handle.providerManager,
        messageBus: built.messageBus,
        mcpRuntime: built.mcp,
        agentClient: caller,
      };
      const facades = [await fromConfig(options), await fromConfig(options)];
      try {
        const closing = facades[firstClosed].dispose();
        expect(new Set([closing, facades[firstClosed].dispose()]).size).toBe(1);
        await closing;
        await built.mcp.refreshContext();
        await facades[1 - firstClosed].setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'surviving facade' }],
          },
        ]);
        expect(
          (await facades[1 - firstClosed].getHistory()).filter(
            (item) => item.speaker === 'human',
          ),
        ).toHaveLength(1);
        await facades[1 - firstClosed].dispose();
        await built.mcp.refreshContext();
        await caller.addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'caller after both facades' }],
        });
        expect(
          (await caller.getHistory()).filter(
            (item) => item.speaker === 'human',
          ),
        ).toHaveLength(2);
        expect(await caller.mediaStore?.getStoredByteLength()).toBe(0);
        expect(built.handle.providerManager.getActiveProviderName()).toBe(
          'fake',
        );
      } finally {
        await Promise.all(facades.map((facade) => facade.dispose()));
        await built.cleanup();
      }
    }, 30000);
  }
  it('releases failed shared activation without losing a surviving facade or the caller MCP collaborator', async () => {
    const built = await createSessionClientEngineFixture();
    const caller = built.owner.getAgentClient();
    const options = {
      settingsService: built.settingsService,
      config: built.config,
      providerManager: built.handle.providerManager,
      messageBus: built.messageBus,
      mcpRuntime: built.mcp,
      agentClient: caller,
    };
    const facade = await fromConfig(options);
    try {
      await expect(
        fromConfig({
          ...options,
          activation: { provider: 'missing-shared-provider' },
        }),
      ).rejects.toThrow(/activation failed/i);
      await built.mcp.refreshContext();
      await facade.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'survives failed sibling' }],
        },
      ]);
      expect(
        (await facade.getHistory()).filter((item) => item.speaker === 'human'),
      ).toHaveLength(1);
      await facade.dispose();
      await built.mcp.refreshContext();
      await caller.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'caller survives failed sibling' }],
      });
      expect(
        (await caller.getHistory()).filter((item) => item.speaker === 'human'),
      ).toHaveLength(2);
    } finally {
      await facade.dispose();
      await built.cleanup();
    }
  }, 30000);
  it('creates and disposes an owned public agent with its separate media lifetime', async () => {
    const workspace = await createWorkspaceEngineFixture();
    try {
      const agent = await createAgent({
        provider: 'fake',
        model: 'fake-model',
        workingDir: workspace.config.getTargetDir(),
      });
      const client = agent.agentClient;
      const store = client.mediaStore;
      if (store === undefined) throw new Error('Missing owned media');
      try {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'owned public session' }],
          },
        ]);
        expect(
          (await agent.getHistory()).filter((item) => item.speaker === 'human'),
        ).toHaveLength(1);
        await agent.dispose();
        expect(() => agent.agentClient).toThrow(/disposed/i);
        await expect(store.getStoredByteLength()).rejects.toThrow(/closed/i);
      } finally {
        await agent.dispose();
      }
    } finally {
      await workspace.cleanup();
    }
  }, 30000);
  it('publishes a profile client through its owner and retains the borrowed caller after profile retirement', async () => {
    const built = await createSessionClientEngineFixture();
    const client = built.owner.getAgentClient();
    const provider = new FakeProvider(
      fileURLToPath(
        new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
      ),
      built.config.getTargetDir(),
    );
    provider.name = 'engine-profile-provider';
    built.handle.providerManager.registerProvider(provider);
    const agent = await fromConfig({
      settingsService: built.settingsService,
      config: built.config,
      providerManager: built.handle.providerManager,
      messageBus: built.messageBus,
      mcpRuntime: built.mcp,
      agentClient: client,
    });
    try {
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'profile carries history' }],
        },
      ]);
      await agent.profiles.applySnapshot({
        version: 1,
        provider: provider.name,
        model: 'engine-profile-model',
        modelParams: {},
        ephemeralSettings: {},
      });
      expect(agent.agentClient).not.toBe(client);
      expect(
        (await agent.getHistory()).filter((item) => item.speaker === 'human'),
      ).toHaveLength(1);
      expect(agent.providerManager.getActiveProviderName()).toBe(provider.name);
      await agent.dispose();
      await built.mcp.refreshContext();
      await client.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'caller after profile retirement' }],
      });
      expect(
        (await client.getHistory()).filter((item) => item.speaker === 'human'),
      ).toHaveLength(2);
    } finally {
      await agent.dispose();
      await built.cleanup();
    }
  }, 30000);
  it('restores caller MCP and retains the borrowed client after facade activation fails', async () => {
    const built = await createSessionClientEngineFixture();
    const client = built.owner.getAgentClient();
    try {
      await expect(
        fromConfig({
          settingsService: built.settingsService,
          config: built.config,
          providerManager: built.handle.providerManager,
          messageBus: built.messageBus,
          mcpRuntime: built.mcp,
          agentClient: client,
          activation: { provider: 'missing-engine-provider' },
        }),
      ).rejects.toThrow(/activation failed/i);
      await built.mcp.refreshContext();
      await client.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'caller after failed activation' }],
      });
      expect(
        (await client.getHistory()).filter((item) => item.speaker === 'human'),
      ).toHaveLength(1);
      expect(built.handle.providerManager.getActiveProviderName()).toBe('fake');
    } finally {
      await built.cleanup();
    }
  }, 30000);
  it('transfers the owned preflight client and media into one facade lifetime', async () => {
    const built = await createWorkspaceEngineFixture();
    const handle = createIsolatedRuntimeContext(
      {
        runtimeId: 'engine-owned-preflight',
        config: built.config,
        messageBus: built.messageBus,
        prepare: (ctx) =>
          registerProvidersOntoManager(ctx.providerManager, ctx, built.config),
      },
      built.settingsService,
    );
    await handle.activate();
    const operation = assembleAgentActivationBootstrap(
      built.config,
      handle.settingsService,
      handle.providerManager,
      handle.oauthManager,
      () => handle.readRuntimeKind(),
      undefined,
      built.mcp,
    );
    try {
      await built.mcp.initialize();
      const intent = { provider: 'fake', model: 'fake-model' };
      const result = await operation.preflight(intent);
      if (result.token === undefined)
        throw new Error('Missing owned preflight handoff');
      const owner = operation.sessionClient;
      const client = owner.getAgentClient();
      const store = client.mediaStore;
      if (store === undefined) throw new Error('Missing preflight media store');
      const agent = await fromConfig({
        settingsService: built.settingsService,
        config: built.config,
        providerManager: handle.providerManager,
        messageBus: built.messageBus,
        mcpRuntime: built.mcp,
        activation: intent,
        activationPreflight: { operation, token: result.token },
      });
      try {
        expect(agent.agentClient).toBe(client);
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'owned preflight history' }],
          },
        ]);
        expect(await store.getStoredByteLength()).toBe(0);
      } finally {
        await agent.dispose();
      }
      expect(() => owner.getAgentClient()).toThrow(/disposed/i);
      await expect(store.getStoredByteLength()).rejects.toThrow(/closed/i);
    } finally {
      await operation.dispose();
      await handle.cleanup();
      await built.cleanup();
    }
  }, 30000);
  it('keeps same-label clients separate and leaves a sibling conversation usable after one facade closes', async () => {
    const left = await createSessionClientEngineFixture('shared-engine-label');
    const right = await createSessionClientEngineFixture('shared-engine-label');
    const a = await fromConfig({
      settingsService: left.settingsService,
      config: left.config,
      providerManager: left.handle.providerManager,
      messageBus: left.messageBus,
      mcpRuntime: left.mcp,
      agentClient: left.owner.getAgentClient(),
    });
    const b = await fromConfig({
      settingsService: right.settingsService,
      config: right.config,
      providerManager: right.handle.providerManager,
      messageBus: right.messageBus,
      mcpRuntime: right.mcp,
      agentClient: right.owner.getAgentClient(),
    });
    try {
      await a.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'left only' }] },
      ]);
      await b.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'right only' }] },
      ]);
      await a.dispose();
      await right.mcp.refreshContext();
      await b.agentClient.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'right continues' }],
      });
      expect(
        (await b.getHistory()).filter((item) => item.speaker === 'human'),
      ).toHaveLength(2);
      expect(
        (await b.getHistory())
          .flatMap((item) => item.blocks)
          .filter((block) => block.type === 'text')
          .map((block) => block.text),
      ).not.toContain('left only');
    } finally {
      await b.dispose();
      await a.dispose();
      await right.cleanup();
      await left.cleanup();
    }
  }, 30000);
  it('owns a model replacement without retiring the original borrowed client or media', async () => {
    const built = await createSessionClientEngineFixture();
    const client = built.owner.getAgentClient();
    const agent = await fromConfig({
      settingsService: built.settingsService,
      config: built.config,
      providerManager: built.handle.providerManager,
      messageBus: built.messageBus,
      mcpRuntime: built.mcp,
      agentClient: client,
    });
    try {
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'retained across replacement' }],
        },
      ]);
      await agent.setModel('replacement-model');
      expect(agent.agentClient).not.toBe(client);
      expect(
        (await agent.getHistory()).filter((item) => item.speaker === 'human'),
      ).toHaveLength(1);
      await agent.dispose();
      await built.mcp.refreshContext();
      await client.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'caller retains original' }],
      });
      expect(
        (await client.getHistory()).filter((item) => item.speaker === 'human'),
      ).toHaveLength(2);
      expect(await built.media.store.getStoredByteLength()).toBe(0);
    } finally {
      await agent.dispose();
      await built.cleanup();
    }
  }, 30000);
  it('rejects a borrowed client paired with a different provider manager', async () => {
    const left = await createSessionClientEngineFixture();
    const right = await createSessionClientEngineFixture();
    try {
      await expect(
        fromConfig({
          settingsService: left.settingsService,
          config: left.config,
          providerManager: right.handle.providerManager,
          messageBus: left.messageBus,
          mcpRuntime: left.mcp,
          agentClient: left.owner.getAgentClient(),
        }),
      ).rejects.toThrow(/different ProviderManager/i);
    } finally {
      await right.cleanup();
      await left.cleanup();
    }
  }, 30000);
  it('rejects a borrowed client from another Config even when both session labels match', async () => {
    const left = await createSessionClientEngineFixture('same-engine-label');
    const right = await createSessionClientEngineFixture('same-engine-label');
    try {
      await expect(
        fromConfig({
          settingsService: right.settingsService,
          config: right.config,
          providerManager: right.handle.providerManager,
          messageBus: right.messageBus,
          mcpRuntime: right.mcp,
          agentClient: left.owner.getAgentClient(),
        }),
      ).rejects.toThrow(/different Config/i);
    } finally {
      await right.cleanup();
      await left.cleanup();
    }
  }, 30000);
  it('transfers one borrowed preflight owner without closing the caller client, manager, media or MCP', async () => {
    const built = await createSessionClientEngineFixture();
    const client = built.owner.getAgentClient();
    await client.startChat();
    const intent = { provider: 'fake', model: 'fake-model' };
    const operation = assembleAgentActivationBootstrap(
      built.config,
      built.handle.settingsService,
      built.handle.providerManager,
      built.handle.oauthManager,
      () => built.handle.readRuntimeKind(),
      client,
      built.mcp,
    );
    try {
      const result = await operation.preflight(intent);
      if (result.token === undefined)
        throw new Error('Missing preflight receipt');
      const agent = await fromConfig({
        settingsService: built.settingsService,
        config: built.config,
        providerManager: built.handle.providerManager,
        messageBus: built.messageBus,
        mcpRuntime: built.mcp,
        agentClient: client,
        activation: intent,
        activationPreflight: { operation, token: result.token },
      });
      try {
        expect(agent.agentClient).toBe(client);
        expect(agent.agentClient).toBe(
          operation.sessionClient.getAgentClient(),
        );
      } finally {
        await agent.dispose();
      }
      await built.mcp.refreshContext();
      await client.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'caller retains preflight session' }],
      });
      expect(
        (await client.getHistory()).filter((item) => item.speaker === 'human'),
      ).toHaveLength(1);
      expect(await built.media.store.getStoredByteLength()).toBe(0);
      expect(built.handle.providerManager.getActiveProviderName()).toBe('fake');
    } finally {
      await operation.dispose();
      await built.cleanup();
    }
  }, 30000);
  it('restores the borrowed caller MCP client after facade disposal so context refresh remains usable', async () => {
    const built = await createSessionClientEngineFixture();
    const client = built.owner.getAgentClient();
    try {
      await client.startChat();
      await client.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'borrowed conversation' }],
      });
      const agent = await fromConfig({
        settingsService: built.settingsService,
        config: built.config,
        providerManager: built.handle.providerManager,
        messageBus: built.messageBus,
        mcpRuntime: built.mcp,
        agentClient: client,
      });
      await agent.dispose();
      await built.mcp.refreshContext();
      await client.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'caller after MCP refresh' }],
      });
      expect(
        (await client.getHistory()).filter((item) => item.speaker === 'human'),
      ).toHaveLength(2);
    } finally {
      await built.cleanup();
    }
  }, 30000);
  it('initializes workspace and MCP infrastructure without a client factory', async () => {
    const built = await createWorkspaceEngineFixture();
    const mcp = built.mcp;
    try {
      await mcp.initialize();
      expect(built.mcp.toolSelection.getFunctionDeclarations()).toStrictEqual(
        [],
      );
      const agent = await fromConfig({
        settingsService: built.settingsService,
        config: built.config,
        messageBus: built.messageBus,
        mcpRuntime: mcp,
      });
      try {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'workspace before chat' }],
          },
        ]);
        expect(
          (await agent.getHistory()).filter((item) => item.speaker === 'human'),
        ).toHaveLength(1);
      } finally {
        await agent.dispose();
      }
    } finally {
      await mcp.dispose();
      await built.cleanup();
    }
  }, 30000);
});
