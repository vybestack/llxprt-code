/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { RuntimePolicyOwner } from '../../policy/policy-owner.js';
import { Config } from '../../config/config.js';
import { createProviderRuntimeContext } from '../../runtime/providerRuntimeContext.js';
import {
  ProviderManager,
  FakeProvider,
} from '@vybestack/llxprt-code-providers';
import { fromConfig, McpRuntimeOwner } from '@vybestack/llxprt-code-agents';
import { fileURLToPath } from 'node:url';

async function owner() {
  const config = new Config({
    sessionId: 'same-label',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    model: 'fake-model',
    provider: 'fake',
    debugMode: false,
  });
  const settingsService = new SettingsService();
  const policy = new RuntimePolicyOwner(config);
  const mcp = await McpRuntimeOwner.create(
    {
      openBrowser: async () => {
        throw new Error('Unexpected browser');
      },
      tokenStorage: new MCPOAuthTokenStorage({
        getCredentials: async () => null,
        setCredentials: async () => {
          throw new Error('Unexpected credential write');
        },
        deleteCredentials: async () => {},
        listServers: async () => [],
        getAllCredentials: async () => new Map(),
        clearAll: async () => {},
      }),
    },
    config,
    policy.session.messageBus,
    undefined,
    undefined,
    undefined,
    policy,
    'runtime',
  );
  const manager = new ProviderManager(
    createProviderRuntimeContext({
      config,
      settingsService,
    }),
  );
  manager.registerProvider(
    new FakeProvider(
      fileURLToPath(
        new URL(
          '../../../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
          import.meta.url,
        ),
      ),
    ),
  );
  const agent = await fromConfig({
    settingsService,
    config,
    mcpRuntime: mcp,
    providerManager: manager,
    activation: { provider: 'fake', model: 'fake-model' },
  });
  await agent.agentClient.startChat();
  return { config, manager, agent, mcp };
}

describe('Config workspace disposal', () => {
  it('does not dispose independently owned clients with identical session labels', async () => {
    const first = await owner();
    const sibling = await owner();
    const client = first.agent.agentClient;
    try {
      expect(client).not.toBe(sibling.agent.agentClient);
      await first.config.dispose();
      await client.setHistory([
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'caller survives workspace shutdown' },
          ],
        },
      ]);
      expect(await client.getHistory()).toHaveLength(1);
      await first.agent.dispose();
      expect(() => first.agent.agentClient).toThrow('disposed');
      await sibling.agent.agentClient.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'sibling still works' }],
        },
      ]);
      expect(await sibling.agent.agentClient.getHistory()).toHaveLength(1);
    } finally {
      await first.agent.dispose();
      await sibling.agent.dispose();
      await first.config.dispose();
      await sibling.config.dispose();
      await first.mcp.dispose();
      await sibling.mcp.dispose();
      first.manager.dispose();
      sibling.manager.dispose();
    }
  });
});
