import { CredentialAuthority } from '../../providers/src/auth/proxy/credential-store-factory.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { createOpenAIAliasProvider } from '@vybestack/llxprt-code-providers/composition/aliasProviderFactory.js';
import {
  type ProviderAliasEntry,
  type ProviderFactoryContext,
  loadRuntimePlugins,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { installZedDefinitionFixture } from './__tests__/definition-fixture.js';
import { unusedProfileApplication } from './test-profile-application.js';
import {
  captureZedSessionParameters,
  type ZedSessionProviderInputs,
} from './zed-session-agent.js';

const definitionFixture = installZedDefinitionFixture();
const mockFromConfig = vi.fn();

const actual = { ...(await import('@vybestack/llxprt-code-agents')) };
void vi.mock('@vybestack/llxprt-code-agents', () => ({
  ...actual,
  createAgentFromSettingsSnapshot: (
    ...args: Parameters<typeof actual.createAgentFromSettingsSnapshot>
  ) => mockFromConfig(...args),
}));

describe('Zed session host declarations', () => {
  let projectRoot: string;
  const captured: Agent[] = [];

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'zed-host-declarations-'));
    captured.length = 0;
    mockFromConfig.mockImplementation(
      async (
        ...args: Parameters<typeof actual.createAgentFromSettingsSnapshot>
      ) => {
        const agent = await actual.createAgentFromSettingsSnapshot(...args);
        captured.push(agent);
        return agent;
      },
    );
  });

  afterEach(async () => {
    mockFromConfig.mockImplementation(actual.createAgentFromSettingsSnapshot);
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function newZedAgent(
    host: Config,
    hostSettings: SettingsService,
    providerInputs?: ZedSessionProviderInputs,
  ) {
    const { ZedAgent } = await import('./zedIntegration.js');
    return new ZedAgent(
      host,
      {
        sessionUpdate: vi.fn(async () => undefined),
      } as never,
      unusedProfileApplication,
      () => {
        const session = new SettingsService({ sessionSource: hostSettings });
        session.restoreFromStateSnapshot(hostSettings.exportForStateSnapshot());
        return session;
      },
      undefined,
      definitionFixture(),
      undefined,
      { ...providerInputs, credentialAuthority: new CredentialAuthority() },
    );
  }

  it('preserves hook, skill and environment-redaction declarations from the host Config', async () => {
    const hooks = {
      [HookEventName.BeforeTool]: [
        {
          matcher: 'write_file',
          hooks: [{ type: HookType.Command as const, command: 'echo before' }],
        },
      ],
    };
    const projectHooks = {
      [HookEventName.AfterTool]: [
        {
          hooks: [{ type: HookType.Command as const, command: 'echo after' }],
        },
      ],
    };
    const sanitizationConfig = {
      allowedEnvironmentVariables: ['KEEP_ME'],
      blockedEnvironmentVariables: ['DROP_ME'],
      enableEnvironmentVariableRedaction: true,
    };
    const host = new Config({
      sessionId: 'host',
      targetDir: projectRoot,
      cwd: projectRoot,
      model: 'host-model',
      provider: 'openai',
      debugMode: false,
      enableHooks: true,
      hooks,
      projectHooks,
      disabledHooks: ['echo before'],
      sanitizationConfig,
      disabledSkills: ['skill-off'],
      adminSkillsEnabled: false,
    });
    const session = new Config(
      captureZedSessionParameters(host, 'session', projectRoot),
    );
    try {
      expect(session.getHooks()).toStrictEqual(hooks);
      expect(session.getProjectHooks()).toStrictEqual(projectHooks);
      expect(session.getDisabledHooks()).toStrictEqual(['echo before']);
      expect(session.getSanitizationConfig()).toStrictEqual(sanitizationConfig);
      expect(session.getDisabledSkills()).toStrictEqual(['skill-off']);
      expect(session.isAdminSkillsEnabled()).toBe(false);
    } finally {
      await Promise.all([session.dispose(), host.dispose()]);
    }
  });

  it('assembles session providers from the installed provider contributions', async () => {
    const providerContributions = await loadRuntimePlugins(['fixture-plugin'], {
      importModule: async () => ({
        llxprtRuntimePlugin: {
          apiVersion: 1,
          id: 'fixture-plugin',
          providers: [
            {
              providerId: 'fixture-base',
              createProvider: (
                entry: ProviderAliasEntry,
                context: ProviderFactoryContext,
              ) =>
                createOpenAIAliasProvider(
                  entry,
                  context.openaiApiKey,
                  context.openaiBaseUrl,
                  context.openaiProviderConfig,
                  context.authOnlyEnabled,
                ),
              builtinAliases: [
                {
                  alias: 'fixture-alias',
                  config: {
                    baseProvider: 'fixture-base',
                    'base-url': 'http://127.0.0.1:1/v1',
                    'requires-auth': false,
                    defaultModel: 'fixture-model',
                    staticModels: [
                      { id: 'fixture-model', name: 'Fixture model' },
                    ],
                  },
                },
              ],
            },
          ],
        },
      }),
    });
    const host = new Config({
      sessionId: 'host',
      targetDir: projectRoot,
      cwd: projectRoot,
      model: 'host-model',
      provider: 'openai',
      debugMode: false,
    });
    const agent = await newZedAgent(host, new SettingsService(), {
      providerContributions,
    });
    try {
      await agent.newSession({ cwd: projectRoot } as never);
      expect(captured).toHaveLength(1);
      expect(
        captured[0].listProviders().map((provider) => provider.name),
      ).toContain('fixture-alias');
    } finally {
      await agent.disposeAll();
      await host.dispose();
    }
  });

  it('starts a session on the provider and model selected after startup', async () => {
    const host = new Config({
      sessionId: 'host',
      targetDir: projectRoot,
      cwd: projectRoot,
      provider: 'openai',
      model: 'startup-model',
      debugMode: false,
    });
    const hostSettings = new SettingsService();
    hostSettings.set('activeProvider', 'openai');
    hostSettings.setProviderSetting('openai', 'model', 'startup-model');
    hostSettings.set('activeProvider', 'anthropic');
    hostSettings.setProviderSetting('anthropic', 'model', 'selected-model');
    const agent = await newZedAgent(host, hostSettings);
    try {
      await agent.newSession({ cwd: projectRoot } as never);
      expect(captured).toHaveLength(1);
      expect(captured[0].getProvider()).toBe('anthropic');
      expect(captured[0].getModel()).toBe('selected-model');
      expect(captured[0].getProvider()).toBe('anthropic');
    } finally {
      await agent.disposeAll();
      await host.dispose();
    }
  });

  it('gives session OAuth managers the connection OAuth settings', async () => {
    const host = new Config({
      sessionId: 'host',
      targetDir: projectRoot,
      cwd: projectRoot,
      model: 'host-model',
      provider: 'openai',
      debugMode: false,
    });
    const oauthSettings = {
      isOAuthEnabled: (provider: string) => provider === 'anthropic',
      getProviderApiKey: () => undefined,
      getProviderKeyfile: () => undefined,
      getProviderBaseUrl: () => undefined,
      getOAuthEnabledProviders: () => ({ anthropic: true }),
      setOAuthEnabled: () => undefined,
    };
    const agent = await newZedAgent(host, new SettingsService(), {
      oauthSettings,
    });
    try {
      await agent.newSession({ cwd: projectRoot } as never);
      expect(captured).toHaveLength(1);
      expect(
        (await captured[0].auth.detailedStatus('anthropic')).oauthEnabled,
      ).toBe(true);
    } finally {
      await agent.disposeAll();
      await host.dispose();
    }
  });
});
