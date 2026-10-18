import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  Config,
  WorkspaceTrustLifecycle,
  WorkspaceFilesystemOwner,
  assembleWorkspaceMemory,
  CoreEvent,
  coreEvents,
  type UserFeedbackPayload,
} from '@vybestack/llxprt-code-core';
import { loadRuntimePlugins } from '@vybestack/llxprt-code-providers/composition.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { buildMcpAuthFactoryRegistry } from '@vybestack/llxprt-code-mcp/auth/mcp-auth-factory.js';
import {
  prepareAgentPreflight,
  type AgentProfilePreflight,
  type ActivationPreflightToken,
} from '@vybestack/llxprt-code-agents';
import { createForegroundAgent } from './cliAgentBootstrap.js';
import { waitFor } from './__tests__/async.js';
import { constructAgentWithSpinner } from './cliTerminalSession.js';
import {
  __resetCleanupStateForTesting,
  runExitCleanup,
  registerCleanup,
} from './utils/cleanup.js';

describe('foreground MCP plugin ownership', () => {
  const directories: string[] = [];
  const configs: Config[] = [];
  const previousEnv = { ...process.env };

  afterEach(async () => {
    await runExitCleanup();
    __resetCleanupStateForTesting();
    for (const config of configs.splice(0)) await config.dispose();
    for (const directory of directories.splice(0))
      await rm(directory, { recursive: true, force: true });
    process.env = { ...previousEnv };
  });

  async function build(owner: string): Promise<{
    credentialAuthority: CredentialAuthority;
    config: Config;
    preflight: AgentProfilePreflight;
    token: ActivationPreflightToken;
    activation: import('@vybestack/llxprt-code-agents').AgentActivationOperation;
    getMcpAuthProviderFactory: ReturnType<
      typeof buildMcpAuthFactoryRegistry
    >['getAuthProviderFactory'];
  }> {
    const directory = await mkdtemp(join(tmpdir(), 'cli-plugin-owner-'));
    directories.push(directory);
    process.env.LLXPRT_CONFIG_HOME = directory;
    process.env.LLXPRT_FAKE_RESPONSES = resolve(
      import.meta.dir,
      '../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
    );
    const contributions = await loadRuntimePlugins([`plugin-${owner}`], {
      importModule: async () => ({
        llxprtRuntimePlugin: {
          apiVersion: 1,
          id: `plugin-${owner}`,
          providers: [],
          mcpAuthFactories: [
            {
              authProviderType: 'owner-custom',
              createAuthProvider: (server: { url?: string }) => {
                throw new Error(
                  `${owner} credentials rejected for ${server.url}`,
                );
              },
            },
          ],
        },
      }),
    });
    const registry = buildMcpAuthFactoryRegistry(
      contributions.getMcpAuthFactories().map((entry) => entry.contribution),
    );
    const settingsService = new SettingsService();
    const settingsOwner = new SessionSettingsOwner(settingsService);
    const config = new Config({
      cwd: directory,
      targetDir: directory,
      debugMode: false,
      sessionId: 'same-label',
      provider: 'fake',
      model: 'fake-model',
      trustedFolder: true,
      mcpServers: {
        shared: {
          url: 'http://127.0.0.1:1/mcp',
          authProviderType: 'OWNER-CUSTOM',
        },
      },
    });
    const credentialAuthority = new CredentialAuthority();
    const preflight = await prepareAgentPreflight(
      { runtimeId: 'same-label' },
      credentialAuthority,
      settingsService,
      settingsOwner,
      contributions,
    );
    const trust = new WorkspaceTrustLifecycle({ localTrust: true });
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => trust.isTrustedFolder(),
    });
    const memory = assembleWorkspaceMemory(config, filesystem, trust);
    await preflight.preparePostConfiguration(
      config,
      filesystem,
      memory,
      trust,
      () => trust.dispose(),
      settingsOwner,
    );
    let activation:
      | import('@vybestack/llxprt-code-agents').AgentActivationOperation
      | undefined;
    preflight.transferActivation((operation) => {
      activation = operation;
    });
    if (activation === undefined) throw new Error('Missing activation');
    const result = await preflight.preflight({
      provider: 'fake',
      model: 'fake-model',
      authMode: 'auto',
    });
    if (result.token === undefined)
      throw new Error('Missing activation receipt');
    registerCleanup(() => preflight.dispose());
    configs.push(config);
    return {
      credentialAuthority,
      config,
      preflight,
      token: result.token,
      activation,
      getMcpAuthProviderFactory: (type) =>
        registry.getAuthProviderFactory(type),
    };
  }

  it('captures plugin lookup on each foreground owner and retains the surviving lookup after sibling disposal', async () => {
    const feedback: string[] = [];
    const onFeedback = (event: UserFeedbackPayload): void => {
      feedback.push(event.message);
    };
    coreEvents.on(CoreEvent.UserFeedback, onFeedback);
    try {
      const first = await build('first');
      const a = await createForegroundAgent(
        first.preflight,
        first.token,
        { provider: 'fake', model: 'fake-model', authMode: 'auto' },
        first.credentialAuthority,
        {
          mcpHost: {
            getAuthProviderFactory: first.getMcpAuthProviderFactory,
            emitFeedback: (...args) => coreEvents.emitFeedback(...args),
          },
        },
      );
      await waitFor(() => expect(a.mcp.discoveryState()).toBe('failed'));
      const firstFailures = feedback.join('\n');
      expect(firstFailures).toContain(
        'first credentials rejected for http://127.0.0.1:1/mcp',
      );
      expect(firstFailures).not.toContain('no auth provider is registered');
      feedback.length = 0;
      const second = await build('second');
      const b = await createForegroundAgent(
        second.preflight,
        second.token,
        { provider: 'fake', model: 'fake-model', authMode: 'auto' },
        second.credentialAuthority,
        {
          mcpHost: {
            getAuthProviderFactory: second.getMcpAuthProviderFactory,
            emitFeedback: (...args) => coreEvents.emitFeedback(...args),
          },
        },
      );
      await waitFor(() => expect(b.mcp.discoveryState()).toBe('failed'));
      const secondFailures = feedback.join('\n');
      expect(secondFailures).toContain('second credentials rejected');
      expect(secondFailures).not.toContain('first credentials rejected');
      await a.dispose();
      feedback.length = 0;
      await b.mcp.refresh('shared');
      expect(feedback.join('\n')).toContain('second credentials rejected');
      expect(feedback.join('\n')).not.toContain('first credentials rejected');
    } finally {
      coreEvents.off(CoreEvent.UserFeedback, onFeedback);
    }
  });

  it('threads the injected plugin lookup through spinner construction', async () => {
    const feedback: string[] = [];
    const onFeedback = (event: UserFeedbackPayload): void => {
      feedback.push(event.message);
    };
    coreEvents.on(CoreEvent.UserFeedback, onFeedback);
    try {
      const built = await build('spinner');
      const agent = await constructAgentWithSpinner(
        built.config,
        built.preflight,
        built.token,
        { provider: 'fake', model: 'fake-model', authMode: 'auto' },
        built.credentialAuthority,
        built.getMcpAuthProviderFactory,
      );
      await waitFor(() => expect(agent.mcp.discoveryState()).toBe('failed'));
      expect(feedback.join('\n')).toContain('spinner credentials rejected');
      expect(feedback.join('\n')).not.toContain(
        'no auth provider is registered',
      );
    } finally {
      coreEvents.off(CoreEvent.UserFeedback, onFeedback);
    }
  });
});
