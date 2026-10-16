import { CallerAgentRuntimeFactories } from './helpers/fixture-data.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';

import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import {
  createSessionAuthPolicyReader,
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import {
  activateAdoptedSession,
  initializeAdoptedClient,
} from '../fromConfig-session.js';
import { fromConfig } from '../fromConfig.js';
import type { ProviderActivationIntent } from '../config-types.js';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

describe('adopted session explicit collaborators', () => {
  const credentials = useOwnedCredentials();
  it('retains the supplied client and factories while selecting the activation model', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'adopted-session-')),
    );

    const fixtureFactorylessPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const fixtureFactorylessDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'factoryless-caller-')),
    );
    const fixtureFactorylessSupplied: CallerAgentRuntimeFactories = {};
    const fixtureFactorylessConfig = new Config(
      toConfigParameters({
        ...{
          provider: 'fake',
          model: 'fake-model',
          workingDir: fixtureFactorylessDirectory,
        },
        ...{
          workingDir: directory,
          sessionId: 'adopted-session',
          folderTrust: true,
          mcpEnabled: false,
          skillsSupport: false,
          telemetry: { enabled: false },
          recording: { enabled: false },
        },
      }),
    );
    const fixtureFactorylessSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      fixtureFactorylessConfig.getInitialSettings(),
    ))
      fixtureFactorylessSettings.set(key, value);
    const fixtureFactorylessSettingsOwner = new SessionSettingsOwner(
      fixtureFactorylessSettings,
    );
    fixtureFactorylessSettingsOwner.bindTelemetry(fixtureFactorylessConfig);
    fixtureFactorylessSettingsOwner.initializeProviderSelection(
      fixtureFactorylessConfig.getProvider(),
      fixtureFactorylessConfig.getModel(),
    );
    const fixtureFactorylessPolicy = new RuntimePolicyOwner(
      fixtureFactorylessConfig,
    );
    const fixtureFactorylessTask =
      fixtureFactorylessSupplied.taskToolRegistration;
    const fixtureFactorylessFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...(fixtureFactorylessSupplied.agentClientFactory
        ? { agentClientFactory: fixtureFactorylessSupplied.agentClientFactory }
        : {}),
      ...(fixtureFactorylessTask
        ? { taskToolRegistration: () => fixtureFactorylessTask }
        : {}),
    };

    const fixtureFactorylessClose = settleFactorylessRelease.bind(
      undefined,
      [
        () => fixtureFactorylessSettingsOwner.dispose(),
        () => fixtureFactorylessPolicy.dispose(),
        () => fixtureFactorylessConfig.dispose(),
        () => rm(fixtureFactorylessDirectory, { recursive: true, force: true }),
      ],
      fixtureFactorylessPreviousReplay,
    );

    const config = fixtureFactorylessConfig;
    const settingsService = fixtureFactorylessSettings;
    const settingsOwner = fixtureFactorylessSettingsOwner;
    const messageBus = fixtureFactorylessPolicy.session.messageBus;
    const policyOwner = fixtureFactorylessPolicy;
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
      config: fixtureFactorylessConfig,
      settingsService: fixtureFactorylessSettings,
      settingsOwner: fixtureFactorylessSettingsOwner,
      policyOwner: fixtureFactorylessPolicy,
      messageBus: fixtureFactorylessPolicy.session.messageBus,
      runtimeFactoryBindings: fixtureFactorylessFactories,
      mcpRuntime: mcp,
      oauthManager: oauth,
      providerFileLifecycle: files,
      credentialAuthority: credentials().authority,
      activation: { provider: 'fake', model: 'fake-model', authMode: 'auto' },
    });
    await agent.sessionClient.refreshAuth();
    await agent.agentClient.startChat();
    const manager = agent.providerManager;
    const tokenizerFactory = configureProviderTokenizer(manager);
    const contentGeneratorFactory = createRuntimeContentGeneratorFactory();
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
      await fixtureFactorylessClose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function settleFactorylessRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previous: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previous;
  }
}
