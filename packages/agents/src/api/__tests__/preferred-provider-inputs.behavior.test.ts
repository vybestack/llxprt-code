/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent } from '../createAgent.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { FileOAuthSettingsProvider } from '@vybestack/llxprt-code-providers/auth/file-oauth-settings.js';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';
import { createOpenAIAliasProvider } from '@vybestack/llxprt-code-providers/composition/aliasProviderFactory.js';

describe('preferred provider primitive selections', () => {
  const credentials = useOwnedCredentials();
  let directory: string;
  let previousHome: string | undefined;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'preferred-inputs-'));
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = directory;
    await writeFile(
      join(directory, 'settings.json'),
      JSON.stringify({
        oauthEnabledProviders: { anthropic: true },
      }),
    );
  });
  afterEach(async () => {
    if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousHome;
    await rm(directory, { recursive: true, force: true });
  });

  it.each(['omitted', 'null', 'explicit'] as const)(
    'preserves physical OAuth settings selection %s without enabling other providers',
    async (selection) => {
      const agent = await createAgent({
        provider: 'openai',
        model: 'selection-model',
        workingDir: directory,
        credentialAuthority: credentials().authority,
        harness: { includeProcessCwd: false },
        ...(selection === 'omitted'
          ? {}
          : {
              oauthSettings:
                selection === 'null'
                  ? null
                  : new FileOAuthSettingsProvider(
                      join(directory, 'settings.json'),
                    ),
            }),
      });
      try {
        const configured = await agent.auth.detailedStatus('anthropic');
        const other = await agent.auth.detailedStatus('gemini');
        expect(configured.oauthEnabled).toBe(selection !== 'null');
        expect(configured.authenticated).toBe(false);
        expect(other.oauthEnabled).toBe(false);
      } finally {
        await agent.dispose();
      }
      expect(credentials().snapshot()).toStrictEqual([1]);
      expect(credentials().keySnapshot()).toStrictEqual([1]);
    },
  );

  it('acquires independent credential transports through the supplied authority and retires only its own stores', async () => {
    const options = {
      provider: 'openai',
      model: 'credential-owner-model',
      workingDir: directory,
      credentialAuthority: credentials().authority,
      harness: { includeProcessCwd: false },
    };
    const first = await createAgent(options);
    try {
      const second = await createAgent(options);
      try {
        expect(credentials().snapshot()).toStrictEqual([0, 0]);
        expect(credentials().keySnapshot()).toStrictEqual([0, 0]);
        await first.dispose();
        expect(credentials().snapshot()).toStrictEqual([1, 0]);
        expect(credentials().keySnapshot()).toStrictEqual([1, 0]);
        const status = await second.auth.detailedStatus('anthropic');
        expect(status.oauthEnabled).toBe(true);
        expect(status.authenticated).toBe(false);
        expect(await credentials().listProviders(1)).toStrictEqual([]);
      } finally {
        await second.dispose();
      }
    } finally {
      await first.dispose();
    }
    expect(credentials().snapshot()).toStrictEqual([1, 1]);
    expect(credentials().keySnapshot()).toStrictEqual([1, 1]);
  });

  it('populates real contributed aliases only on the selected root and retains concrete provider model behavior', async () => {
    const providerContributions = buildProviderContributionRegistry([
      {
        specifier: 'memory:preferred-provider-input',
        manifest: {
          apiVersion: 1,
          id: 'preferred-provider-input',
          providers: [
            {
              providerId: 'leaf-openai',
              createProvider: (entry, context) =>
                createOpenAIAliasProvider(
                  entry,
                  context.openaiApiKey,
                  context.openaiBaseUrl,
                  context.openaiProviderConfig,
                  context.authOnlyEnabled,
                ),
              builtinAliases: [
                {
                  alias: 'leaf-local',
                  config: {
                    baseProvider: 'leaf-openai',
                    'base-url': 'http://127.0.0.1:1/v1',
                    'requires-auth': false,
                    defaultModel: 'leaf-default',
                    staticModels: [
                      { id: 'leaf-default', name: 'Leaf default' },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    ]);
    const agent = await createAgent({
      provider: 'leaf-local',
      model: 'leaf-default',
      providerContributions,
      workingDir: directory,
      credentialAuthority: credentials().authority,
      harness: { includeProcessCwd: false },
    });
    const peer = await createAgent({
      provider: 'openai',
      model: 'peer-model',
      workingDir: directory,
      credentialAuthority: credentials().authority,
      harness: { includeProcessCwd: false },
    });
    try {
      expect(agent.listProviders().map(({ name }) => name)).toContain(
        'leaf-local',
      );
      expect(peer.listProviders().map(({ name }) => name)).not.toContain(
        'leaf-local',
      );
      expect((await agent.listAvailableModels()).map(({ id }) => id)).toContain(
        'leaf-default',
      );
      await agent.dispose();
      expect(peer.getModel()).toBe('peer-model');
      expect(peer.getProvider()).toBe('openai');
    } finally {
      await Promise.all([agent.dispose(), peer.dispose()]);
    }
  });
});
