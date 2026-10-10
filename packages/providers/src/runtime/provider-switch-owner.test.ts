/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  Config,
  createProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '../ProviderManager.js';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import { switchActiveProvider } from './providerSwitch.js';
import { OAuthManager } from '../auth/oauth-manager.js';
import {
  MemoryTokenStore,
  createTestProvider,
  makeToken,
} from '../auth/__tests__/behavioral/test-utils.js';

class SubscriptionProvider extends OpenAIProvider {
  override readonly name = 'claudecode';
  override async hasNonOAuthAuthentication(): Promise<boolean> {
    return false;
  }
}

describe('explicit provider switch ownership', () => {
  const configs: Config[] = [];
  const settingsOwners: SessionSettingsOwner[] = [];
  const managers: ProviderManager[] = [];
  afterEach(async () => {
    for (const manager of managers.splice(0)) manager.dispose();
    for (const settingsOwner of settingsOwners.splice(0))
      await settingsOwner.dispose();
    await Promise.all(configs.splice(0).map((config) => config.dispose()));
  });
  function owner() {
    const settings = new SettingsService();
    const settingsOwner = new SessionSettingsOwner(settings);
    settingsOwners.push(settingsOwner);
    const config = new Config({
      sessionId: 'same-label',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'old-model',
      interactive: true,
    });
    configs.push(config);
    const manager = new ProviderManager(
      createProviderRuntimeContext({
        config,
        settingsService: settings,
        runtimeId: 'same-label',
        runtimeKind: 'agent',
      }),
    );
    managers.push(manager);
    manager.registerProvider(new OpenAIProvider('test-key'));
    manager.registerProvider(new SubscriptionProvider(undefined));
    return {
      config,
      settings,
      settingsOwner,
      manager,
      completion: Promise.resolve(),
      async initializeClient(): Promise<void> {
        await this.completion;
      },
    };
  }
  it('finishes delayed same-label owners independently outside runtime scopes', async () => {
    const first = owner();
    const second = owner();
    let release = (): void => {};
    first.completion = new Promise<void>((resolve) => {
      release = resolve;
    });
    first.settings.set('currentProfile', 'first-profile');
    second.settings.set('currentProfile', 'second-profile');
    first.settingsOwner.writeUserParameter('context-limit', 1234);
    second.settingsOwner.writeUserParameter('context-limit', 5678);
    const delayed = switchActiveProvider(
      'openai',
      {},
      first.config,
      first.settings,
      first.manager,
      null,
      'agent',
      () => first.initializeClient(),
      first.settingsOwner,
    );
    const completed = await switchActiveProvider(
      'openai',
      {},
      second.config,
      second.settings,
      second.manager,
      null,
      'subagent',
      () => second.initializeClient(),
      second.settingsOwner,
    );
    expect(completed.changed).toBe(true);
    // The switch prefers the provider alias default over the provider's own
    // default (which LLXPRT_DEFAULT_MODEL overrides), so compare against the
    // model the switch itself reports for this owner.
    expect(completed.defaultModel).toBeTruthy();
    expect(second.settingsOwner.readSelectedModel()).toBe(
      completed.defaultModel,
    );
    expect(second.settingsOwner.readNamedParameter('context-limit')).toBe(5678);
    expect(first.settings.get('currentProfile')).toBe('first-profile');
    release();
    const delayedResult = await delayed;
    expect(delayedResult.changed).toBe(true);
    expect(delayedResult.defaultModel).toBe(completed.defaultModel);
    expect(first.settingsOwner.readNamedParameter('context-limit')).toBe(1234);
    expect(first.settingsOwner.readSelectedModel()).toBe(
      delayedResult.defaultModel,
    );
    expect(second.settings.get('currentProfile')).toBe('second-profile');
  });
  it('rejects an unavailable target before clearing owner settings', async () => {
    const current = owner();
    current.settingsOwner.writeUserParameter('auth-key', 'keep-key');
    await expect(
      switchActiveProvider(
        'missing',
        {},
        current.config,
        current.settings,
        current.manager,
        null,
        'agent',
        () => current.initializeClient(),
        current.settingsOwner,
      ),
    ).rejects.toThrow('not');
    expect(current.settingsOwner.readNamedParameter('auth-key')).toBe(
      'keep-key',
    );
    expect(current.manager.getActiveProviderName()).toBeUndefined();
  });
  it('requires explicit collaborators before mutating settings', async () => {
    const current = owner();
    current.settingsOwner.writeUserParameter('auth-key', 'keep-key');
    await expect(
      Reflect.apply(switchActiveProvider, undefined, [
        'openai',
        {},
        current.config,
      ]),
    ).rejects.toThrow('Provider switch requires');
    expect(current.settingsOwner.readNamedParameter('auth-key')).toBe(
      'keep-key',
    );
  });
  it('keeps a delayed OAuth login with its owner while another same-label owner switches', async () => {
    const first = owner();
    const second = owner();
    const store = new MemoryTokenStore();
    const otherStore = new MemoryTokenStore();
    const oauth = new OAuthManager(store, undefined, { config: first.config });
    const otherOauth = new OAuthManager(otherStore, undefined, {
      config: second.config,
    });
    let release = (): void => {};
    let started = (): void => {};
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    oauth.registerProvider({
      ...createTestProvider('claudecode'),
      initiateAuth: async () => {
        started();
        await gate;
        return makeToken('owner-login');
      },
    });
    first.settingsOwner.writeUserParameter('maxOutputTokens', 12345);
    const pending = switchActiveProvider(
      'claudecode',
      { autoOAuth: true },
      first.config,
      first.settings,
      first.manager,
      oauth,
      'cli-interactive',
      () => first.initializeClient(),
      first.settingsOwner,
    );
    await waiting;
    await switchActiveProvider(
      'claudecode',
      {},
      second.config,
      second.settings,
      second.manager,
      otherOauth,
      'subagent',
      () => second.initializeClient(),
      second.settingsOwner,
    );
    expect(await otherStore.listBuckets('claudecode')).toStrictEqual([]);
    release();
    const result = await pending;
    expect(result.infoMessages.join(' ')).toContain('authentication completed');
    expect((await store.getToken('claudecode'))?.access_token).toBe(
      'owner-login',
    );
    expect(first.settingsOwner.readNamedParameter('maxOutputTokens')).toBe(
      12345,
    );
    expect(await otherStore.listBuckets('claudecode')).toStrictEqual([]);
  });
  it('reports OAuth failure on the switching owner without altering the other owner', async () => {
    const first = owner();
    const second = owner();
    const store = new MemoryTokenStore();
    const oauth = new OAuthManager(store, undefined, { config: first.config });
    oauth.registerProvider({
      ...createTestProvider('claudecode'),
      initiateAuth: async () => {
        throw new Error('login rejected');
      },
    });
    await switchActiveProvider(
      'openai',
      {},
      second.config,
      second.settings,
      second.manager,
      null,
      'agent',
      () => second.initializeClient(),
      second.settingsOwner,
    );
    const snapshot = second.settings.exportForStateSnapshot();
    const result = await switchActiveProvider(
      'claudecode',
      { autoOAuth: true },
      first.config,
      first.settings,
      first.manager,
      oauth,
      'cli-interactive',
      () => first.initializeClient(),
      first.settingsOwner,
    );
    expect(result.infoMessages.join(' ')).toContain(
      'authentication failed: login rejected',
    );
    expect(first.manager.getActiveProviderName()).toBe('claudecode');
    expect(await store.listBuckets('claudecode')).toStrictEqual([]);
    expect(second.settings.exportForStateSnapshot()).toStrictEqual(snapshot);
  });
});
