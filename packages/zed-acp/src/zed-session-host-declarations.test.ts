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
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { loadRuntimePlugins } from '@vybestack/llxprt-code-providers/composition.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { installZedDefinitionFixture } from './__tests__/definition-fixture.js';
import { unusedProfileApplication } from './test-profile-application.js';
import {
  createZedSessionConfig,
  type ZedSessionProviderInputs,
} from './zed-session-agent.js';

const definitionFixture = installZedDefinitionFixture();
const mockFromConfig = vi.fn();

const actual = { ...(await import('@vybestack/llxprt-code-agents')) };
void vi.mock('@vybestack/llxprt-code-agents', () => ({
  ...actual,
  fromConfig: (...args: unknown[]) => mockFromConfig(...args),
}));

interface CapturedSessionAgentOptions {
  readonly config: Config;
  readonly providerManager: ProviderManager;
  readonly oauthManager: OAuthManager;
}

function fakeSessionAgent(options: CapturedSessionAgentOptions) {
  return {
    providerManager: options.providerManager,
    getApprovalMode: () => 'default',
    setApprovalMode: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    async *stream() {},
    session: {
      getRecordingTitle: () => undefined,
      recordRecordingTitle: async () => undefined,
    },
    tools: { respondToConfirmation: vi.fn() },
  };
}

describe('Zed session host declarations', () => {
  let projectRoot: string;
  const captured: CapturedSessionAgentOptions[] = [];

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'zed-host-declarations-'));
    captured.length = 0;
    mockFromConfig.mockImplementation(
      async (options: CapturedSessionAgentOptions) => {
        captured.push(options);
        return fakeSessionAgent(options);
      },
    );
  });

  afterEach(async () => {
    mockFromConfig.mockImplementation(actual.fromConfig);
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
      new ProviderManager({ config: host, settingsService: hostSettings }),
      () => {
        const session = new SettingsService({ sessionSource: hostSettings });
        session.restoreFromStateSnapshot(hostSettings.exportForStateSnapshot());
        return session;
      },
      undefined,
      definitionFixture(),
      undefined,
      providerInputs,
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
      debugMode: false,
      enableHooks: true,
      hooks,
      projectHooks,
      disabledHooks: ['echo before'],
      sanitizationConfig,
      disabledSkills: ['skill-off'],
      adminSkillsEnabled: false,
    });
    const session = createZedSessionConfig(host, 'session', projectRoot);
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
              createProvider: (entry: { alias: string }) => ({
                name: entry.alias,
                getModels: async () => [],
                getServerTools: () => [],
                getDefaultModel: () => `${entry.alias}-default`,
              }),
              builtinAliases: [
                {
                  alias: 'fixture-alias',
                  config: { baseProvider: 'fixture-base' },
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
      debugMode: false,
    });
    const agent = await newZedAgent(host, new SettingsService(), {
      providerContributions,
    });
    try {
      await agent.newSession({ cwd: projectRoot } as never);
      expect(captured).toHaveLength(1);
      expect(captured[0].providerManager.listProviders()).toContain(
        'fixture-alias',
      );
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
      expect(captured[0].config.getProvider()).toBe('anthropic');
      expect(captured[0].config.getModel()).toBe('selected-model');
      expect(captured[0].providerManager.getActiveProviderName()).toBe(
        'anthropic',
      );
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
      expect(captured[0].oauthManager.isOAuthEnabled('anthropic')).toBe(true);
    } finally {
      await agent.disposeAll();
      await host.dispose();
    }
  });
});
