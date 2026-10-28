/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  Config,
  createProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  OpenAIProvider,
  ProviderFileLifecycle,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  getUserAliasDir,
} from '@vybestack/llxprt-code-providers/composition.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { setActiveModel } from '../providerMutations.js';

describe('provider alias file errors reach provider operations', () => {
  const credentials = useOwnedCredentials();
  let directory: string;
  let aliasDir: string;
  let badPath: string;
  let settings: SettingsService;
  let config: Config;
  let settingsOwner: SessionSettingsOwner;
  let manager: ProviderManager;

  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'provider-alias-errors-')),
    );
    aliasDir = getUserAliasDir();
    fs.rmSync(aliasDir, { recursive: true, force: true });
    fs.mkdirSync(aliasDir, { recursive: true });
    fs.writeFileSync(
      join(aliasDir, 'good.config'),
      JSON.stringify({ baseProvider: 'openai' }),
    );
    badPath = join(aliasDir, 'bad.config');
    settings = new SettingsService();
    config = new Config({
      sessionId: 'alias-errors',
      cwd: directory,
      targetDir: directory,
      debugMode: false,
      interactive: true,
      model: 'initial',
    });
    settingsOwner = new SessionSettingsOwner(settings);
    settingsOwner.bindTelemetry(config);
    settingsOwner.initializeProviderSelection(
      config.getProvider(),
      config.getModel(),
    );
    manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      }),
      settings,
      config,
      createProviderRuntimeContext({
        runtimeId: 'alias-errors',
        runtimeKind: 'agent',
      }),
      credentials().authority,
      settingsOwner,
    );
    manager.registerProvider(new OpenAIProvider('key'));
  });

  afterEach(async () => {
    fs.rmSync(aliasDir, { recursive: true, force: true });
    await runCleanupSteps([
      () => manager.dispose(),
      () => settingsOwner.dispose(),
      () => config.dispose(),
      () => rm(directory, { recursive: true, force: true }),
    ]);
  });

  function providerSwitch(): ReturnType<typeof assembleProviderSwitch> {
    return assembleProviderSwitch(
      config,
      settings,
      manager,
      null,
      () => manager.getAuthIdentity().runtimeKind,
      async () => {},
      settingsOwner,
    );
  }

  it('switches providers when every alias file parses', async () => {
    const result = await providerSwitch()('openai');

    expect(result.nextProvider).toBe('openai');
    configureProviderTokenizer(manager);
    expect(settingsOwner.readSelectedProvider()).toBe('openai');
  });

  it('rejects the provider switch with the alias file error when an alias file is malformed', async () => {
    fs.writeFileSync(badPath, '{ not json');

    const rejection = await providerSwitch()('openai').then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe(
      `Invalid provider alias file ${badPath}`,
    );
    expect((rejection as Error).cause).toBeInstanceOf(SyntaxError);
    expect(settingsOwner.readSelectedProvider()).not.toBe('openai');
  });

  it('rejects an active model change with the alias file error when an alias file is malformed', async () => {
    fs.writeFileSync(badPath, '{ not json');

    const rejection = await setActiveModel(
      'gpt-test',
      assembleModelSelection(settingsOwner),
      settings,
      { name: 'openai', getDefaultModel: () => 'gpt-test' },
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe(
      `Invalid provider alias file ${badPath}`,
    );
    expect(settingsOwner.readSelectedModel()).not.toBe('gpt-test');
  });
});
