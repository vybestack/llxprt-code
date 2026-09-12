/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config, MessageBus } from '@vybestack/llxprt-code-core';
import {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import {
  ProviderManager,
  createCodexImageBackendResolver,
} from '@vybestack/llxprt-code-providers';
import {
  OAuthManager,
  createTokenStore,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  setCliRuntimeContext,
  registerCliProviderInfrastructure,
  resetCliProviderInfrastructure,
  getActiveImageProfile,
  getActiveProfileName,
  loadImageProfileByName,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { profileCommand } from './profileCommand.js';
import { profileLoadSchema, profileSaveSchema } from './profileSchemas.js';
import type { CommandArgumentSchema } from './schema/types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

function valueAt(schema: CommandArgumentSchema, literals: readonly string[]) {
  let current = schema;
  for (const literal of literals) {
    const node = current.find(
      (entry) => entry.kind === 'literal' && entry.value === literal,
    );
    if (!node?.next) throw new Error(`Missing schema branch ${literal}`);
    current = node.next;
  }
  const value = current.find((entry) => entry.kind === 'value');
  if (!value?.completer) throw new Error('Missing completer');
  return value;
}

describe('image profile command surfaces', () => {
  let directory: string;
  let manager: ProfileManager;
  let oauth: OAuthManager;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-image-surfaces-'));
    manager = new ProfileManager(directory);
    const settingsService = new SettingsService();
    settingsService.setCurrentProfileName('conversation');
    const config = new Config({
      sessionId: 'image-surfaces',
      targetDir: directory,
      cwd: directory,
      debugMode: false,
      model: 'chat-model',
      settingsService,
    });
    const providerManager = new ProviderManager({ settingsService, config });
    const messageBus = new MessageBus(config.getPolicyEngine(), false);
    oauth = new OAuthManager(createTokenStore(), undefined, {
      messageBus,
    });
    setCliRuntimeContext(settingsService, config, {
      runtimeId: 'image-surfaces',
      profileManager: manager,
    });
    registerCliProviderInfrastructure(providerManager, oauth, {
      runtimeId: 'image-surfaces',
      messageBus,
    });
    await manager.saveProfile('conversation', {
      version: 1,
      provider: 'openai',
      model: 'chat-model',
      modelParams: {},
      ephemeralSettings: {},
    });
    await manager.saveImageProfile('art', {
      version: 1,
      type: 'image',
      backend: 'openai-images',
      baseUrl: 'http://localhost:8321/v1',
      model: 'local-image',
      auth: { type: 'none' },
    });
  });
  afterEach(async () => {
    resetCliProviderInfrastructure();
    await rm(directory, { recursive: true, force: true });
  });

  it('resets only image selection and restores the default image backend', async () => {
    await loadImageProfileByName('art');
    const resolve = createCodexImageBackendResolver({
      oauthManager: oauth,
      getActiveProvider: () => undefined,
      getActiveImageProfile: () => getActiveImageProfile()?.profile,
    });
    expect(resolve()?.model).toBe('local-image');
    const reset = profileCommand.subCommands?.find(
      (command) => command.name === 'reset-image',
    );
    if (!reset?.action) throw new Error('Missing reset-image command');
    await reset.action(createMockCommandContext(), '');
    expect(resolve()?.model).toBe('gpt-image-2');
    expect(getActiveImageProfile()).toBeUndefined();
    expect(getActiveProfileName()).toBe('conversation');
  });

  it('offers model profiles as load balancer members', async () => {
    await manager.saveProfile('second-chat', {
      version: 1,
      provider: 'openai',
      model: 'second',
      modelParams: {},
      ephemeralSettings: {},
    });
    await manager.saveLoadBalancerProfile('balanced', {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['conversation', 'second-chat'],
      provider: '',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    });
    const lbName = valueAt(profileSaveSchema, ['loadbalancer']);
    const member = valueAt(lbName.next ?? [], ['roundrobin']);
    const result = await member.completer!(createMockCommandContext(), '', {
      tokens: ['save', 'loadbalancer', 'new-lb', 'roundrobin', 'conversation'],
      partialToken: '',
      hasTrailingSpace: true,
      position: 5,
    });
    expect(result.map((option) => option.value)).toStrictEqual([
      'second-chat',
      'balanced',
    ]);
  });

  it.each(['model', 'image'] as const)(
    'offers only %s names for typed load and save',
    async (kind) => {
      for (const schema of [profileLoadSchema, profileSaveSchema]) {
        const value = valueAt(schema, [kind]);
        const result = await value.completer!(createMockCommandContext(), '', {
          tokens: [],
          partialToken: '',
          hasTrailingSpace: true,
          position: 0,
        });
        expect(result.map((option) => option.value)).toStrictEqual(
          kind === 'model' ? ['conversation'] : ['art'],
        );
      }
    },
  );
});
