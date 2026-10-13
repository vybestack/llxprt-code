/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderRuntimeFactories,
  createSessionAuthPolicyReader,
} from '@vybestack/llxprt-code-providers/composition.js';
import {
  activateAdoptedSession,
  initializeAdoptedClient,
} from '../fromConfig-session.js';
import { fromConfig } from '../fromConfig.js';
import type { ProviderActivationIntent } from '../config-types.js';
import {
  buildFactoryLessConfig,
  buildTestMcpRuntime,
} from './helpers/buildCliStyleConfig.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

describe('adopted session explicit collaborators', () => {
  const credentials = useOwnedCredentials();
  it('retains the supplied client and factories while selecting the activation model', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'adopted-session-')),
    );
    const fixture = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      {
        workingDir: directory,
        sessionId: 'adopted-session',
        folderTrust: true,
        mcpEnabled: false,
        skillsSupport: false,
        telemetry: { enabled: false },
        recording: { enabled: false },
      },
    );
    const { config, settingsService, settingsOwner, messageBus, policyOwner } =
      fixture;
    const mcp = await buildTestMcpRuntime(
      config,
      messageBus,
      {},
      undefined,
      policyOwner,
    );
    const oauth = new OAuthManager(
      credentials().authority.createTokenStore(),
      undefined,
      {
        messageBus,
        readSessionAuthPolicy: createSessionAuthPolicyReader(settingsService),
        profileReads: mcp.profileDefinitions,
      },
    );
    const files = new ProviderFileLifecycle({ maxFiles: 10, maxBytes: 1024 });
    const agent = await fromConfig({
      ...fixture,
      mcpRuntime: mcp,
      oauthManager: oauth,
      providerFileLifecycle: files,
      credentialAuthority: credentials().authority,
      activation: { provider: 'fake', model: 'fake-model', authMode: 'auto' },
    });
    await agent.sessionClient.refreshAuth();
    await agent.agentClient.startChat();
    const manager = agent.providerManager;
    const { tokenizerFactory, contentGeneratorFactory } =
      configureProviderRuntimeFactories(config, manager);
    const activation: ProviderActivationIntent = {
      provider: 'fake',
      model: 'adopted-model',
      authMode: 'none',
    };
    const client = await initializeAdoptedClient(
      config,
      settingsService,
      settingsOwner,
      manager,
      oauth,
      contentGeneratorFactory,
      tokenizerFactory,
      files,
      undefined,
      mcp.readInstructions,
      mcp.workspacePaths,
      activation,
      undefined,
      undefined,
      agent.agentClient,
      messageBus,
      undefined,
    );
    try {
      expect(client.getAgentClient()).toBe(agent.agentClient);
      expect(client.tokenizerFactory).toBe(tokenizerFactory);
      expect(client.contentGeneratorFactory).toBe(contentGeneratorFactory);
      await activateAdoptedSession(
        config,
        settingsService,
        settingsOwner,
        manager,
        oauth,
        () => 'agent',
        client,
        activation,
        undefined,
      );
      expect(settingsOwner.readSelectedModel()).toBe(activation.model);
      expect(manager.getActiveProviderName()).toBe('fake');
      expect(client.getAgentClient().isInitialized()).toBe(true);
    } finally {
      await client.dispose();
      await agent.dispose();
      await oauth.dispose();
      await mcp.dispose();
      await fixture.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
