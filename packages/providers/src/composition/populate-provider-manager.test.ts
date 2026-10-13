/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsService, Storage } from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '../ProviderManager.js';

import { OAuthManager } from '../auth/index.js';
import { CredentialAuthority } from '../auth/proxy/credential-store-factory.js';
import { InMemoryTokenStore } from '../auth/proxy/__tests__/credential-proxy-server-helpers.js';
import { MockFileSystem } from './IFileSystem.js';
import { populateProviderManager } from './index.js';
import { buildProviderContributionRegistry } from './runtimePlugins/registry.js';
import { createOpenAIAliasProvider } from './aliasProviderFactory.js';
import type { ProviderContributionRegistry } from './runtimePlugins/types.js';

describe('populateProviderManager', () => {
  let directory: string;
  let previousConfigHome: string | undefined;
  let settings: SettingsService;
  let manager: ProviderManager;
  let tokens: InMemoryTokenStore;
  let oauth: OAuthManager;
  let fileSystem: MockFileSystem;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'populate-provider-manager-'));
    previousConfigHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = directory;
    settings = new SettingsService();
    manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      settings,
      undefined,
      { runtimeId: 'population-test' },
      new CredentialAuthority(),
    );
    tokens = new InMemoryTokenStore();
    oauth = new OAuthManager(tokens);
    fileSystem = new MockFileSystem();
  });

  afterEach(async () => {
    await oauth.dispose();
    manager.dispose();
    if (previousConfigHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousConfigHome;
    rmSync(directory, { recursive: true, force: true });
  });

  function populate(
    contributions: ProviderContributionRegistry | undefined,
    fakeResponsesPath: string | undefined,
  ): void {
    populateProviderManager(
      manager,
      oauth,
      tokens,
      settings,
      fileSystem,
      undefined,
      contributions,
      undefined,
      false,
      true,
      fakeResponsesPath,
    );
  }

  it('registers built-in providers and OAuth implementations on the supplied owners', () => {
    populate(undefined, undefined);

    expect(manager.listProviders()).toContain('openai');
    expect(manager.listProviders()).toContain('anthropic');
    expect(manager.listProviders()).toContain('codex');
    expect(oauth.getProvider('claudecode')).toBeDefined();
    expect(oauth.getProvider('codex')).toBeDefined();
    expect(manager.getActiveProvider()).toBeUndefined();
  });

  it('constructs contributed aliases and keeps them available after alias refresh', () => {
    const contributions = buildProviderContributionRegistry([
      {
        specifier: 'test:contribution',
        manifest: {
          apiVersion: 1,
          id: 'population-plugin',
          providers: [
            {
              providerId: 'population-openai',
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
                  alias: 'population-alias',
                  config: {
                    baseProvider: 'population-openai',
                    'base-url': 'https://population.example/v1',
                    defaultModel: 'population-model',
                  },
                },
              ],
            },
          ],
        },
      },
    ]);
    populate(contributions, undefined);
    manager.refreshAliases();

    expect(
      manager.getProviderByName('population-alias')?.getDefaultModel(),
    ).toBe('population-model');
  });

  it('registers only FakeProvider and activates it when selected', () => {
    const responses = join(directory, 'fake.responses');
    writeFileSync(responses, JSON.stringify({ chunks: [] }) + '\n');
    populate(undefined, responses);

    expect(manager.listProviders()).toStrictEqual(['fake']);
    expect(manager.getActiveProvider()?.name).toBe('fake');
    expect(manager.getActiveProvider()?.getDefaultModel()).toBe('fake-model');
  });

  it('surfaces failure to activate an explicitly configured provider', () => {
    fileSystem.setMockFile(
      Storage.getGlobalSettingsPath(),
      JSON.stringify({ defaultProvider: 'missing-provider' }),
    );

    expect(() => populate(undefined, undefined)).toThrow(
      "Could not activate explicitly-configured provider 'missing-provider'",
    );
  });
});
