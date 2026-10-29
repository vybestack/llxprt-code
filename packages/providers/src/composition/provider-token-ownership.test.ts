/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { ProviderManager } from '../ProviderManager.js';
import { OAuthManager } from '../auth/oauth-manager.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../__tests__/helpers/cleanup.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { OAuthToken } from '@vybestack/llxprt-code-auth';
import { CredentialAuthority } from '../auth/proxy/credential-store-factory.js';
import { CredentialProxyServer } from '../auth/proxy/credential-proxy-server.js';
import {
  InMemoryTokenStore,
  InMemoryProviderKeyStorage,
  makeToken,
} from '../auth/proxy/__tests__/credential-proxy-server-helpers.js';
import {
  createProviderPopulationTarget,
  createOwnedOAuthManager,
  populateProviderManager,
} from './providerManagerInstance.js';
import { createOwnedTokenStoreClose } from './index.js';
import { NodeFileSystem } from './IFileSystem.js';

class HeldTokenStore extends InMemoryTokenStore {
  private enter: () => void = () => {};
  private resume: () => void = () => {};
  readonly entered = new Promise<void>((resolve) => {
    this.enter = resolve;
  });
  readonly released = new Promise<void>((resolve) => {
    this.resume = resolve;
  });
  release(): void {
    this.resume();
  }
  override async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    this.enter();
    await this.released;
    return super.getToken(provider, bucket);
  }
}

async function proxy(
  tokens = new InMemoryTokenStore(),
  capabilityToken?: string,
  keys = new InMemoryProviderKeyStorage(),
): Promise<{
  readonly authority: CredentialAuthority;
  readonly close: () => Promise<void>;
}> {
  const directory = mkdtempSync(join(tmpdir(), 'root-'));
  const server = new CredentialProxyServer({
    tokenStore: tokens,
    providerKeyStorage: keys,
    socketDir: directory,
    capabilityToken,
  });
  const socket = await server.start();
  return {
    authority: new CredentialAuthority(socket, capabilityToken),
    close: async () => {
      await server.stop();
      rmSync(directory, { recursive: true });
    },
  };
}

describe('provider-manager key ownership', () => {
  let aManager: ProviderManager;

  const aRetiring: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await closeA();
  });
  async function closeA(): Promise<void> {
    await runCleanupSteps(aRetiring.splice(0).reverse());
  }
  async function openA(
    authority: CredentialAuthority,
    runtimeId: string,
    config?: Config,
  ): Promise<void> {
    try {
      const settings = new SettingsService();
      const manager = new ProviderManager(
        undefined,
        undefined,
        undefined,
        undefined,
        settings,
        config,
        { runtimeId },
      );
      aManager = manager;
      aRetiring.push(() => manager.dispose());
      const keys = authority.createProviderKeyStorage();
      manager.bindProviderKeyStorage(keys, () => keys.close());
      const tokens = authority.createTokenStore();
      let transferred = false;
      aRetiring.push(() =>
        transferred ? undefined : createOwnedTokenStoreClose(tokens)(),
      );
      const oauth = createOwnedOAuthManager(
        tokens,
        undefined,
        undefined,
        config,
        manager,
        settings,
      );

      aRetiring.push(() => oauth.dispose());
      transferred = true;
      populateProviderManager({
        target: createProviderPopulationTarget(manager, oauth, tokens),
        readSetting: (key) => settings.get(key),
        fileSystem: new NodeFileSystem(),
        configuration:
          config === undefined
            ? { kind: 'pre-config' }
            : { kind: 'configured', config },
        contributions: { kind: 'none' },
        messages: { kind: 'none' },
        allowBrowser: false,
        activateConfiguredProvider: true,
        fakeResponses: { kind: 'disabled' },
      });
    } catch (primary) {
      await cleanupAfterFailure(primary, closeA);
    }
  }

  let bManager: ProviderManager;

  const bRetiring: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await closeB();
  });
  async function closeB(): Promise<void> {
    await runCleanupSteps(bRetiring.splice(0).reverse());
  }
  async function openB(
    authority: CredentialAuthority,
    runtimeId: string,
    config?: Config,
  ): Promise<void> {
    try {
      const settings = new SettingsService();
      const manager = new ProviderManager(
        undefined,
        undefined,
        undefined,
        undefined,
        settings,
        config,
        { runtimeId },
      );
      bManager = manager;
      bRetiring.push(() => manager.dispose());
      const keys = authority.createProviderKeyStorage();
      manager.bindProviderKeyStorage(keys, () => keys.close());
      const tokens = authority.createTokenStore();
      let transferred = false;
      bRetiring.push(() =>
        transferred ? undefined : createOwnedTokenStoreClose(tokens)(),
      );
      const oauth = createOwnedOAuthManager(
        tokens,
        undefined,
        undefined,
        config,
        manager,
        settings,
      );

      bRetiring.push(() => oauth.dispose());
      transferred = true;
      populateProviderManager({
        target: createProviderPopulationTarget(manager, oauth, tokens),
        readSetting: (key) => settings.get(key),
        fileSystem: new NodeFileSystem(),
        configuration:
          config === undefined
            ? { kind: 'pre-config' }
            : { kind: 'configured', config },
        contributions: { kind: 'none' },
        messages: { kind: 'none' },
        allowBrowser: false,
        activateConfiguredProvider: true,
        fakeResponses: { kind: 'disabled' },
      });
    } catch (primary) {
      await cleanupAfterFailure(primary, closeB);
    }
  }

  it('routes the same key name to each root and keeps B usable after A disposal', async () => {
    const keysA = new InMemoryProviderKeyStorage();
    const keysB = new InMemoryProviderKeyStorage();
    await keysA.saveKey('shared-name', 'root-a-secret');
    await keysB.saveKey('shared-name', 'root-b-secret');
    const hostA = await proxy(undefined, 'a'.repeat(64), keysA);
    const hostB = await proxy(undefined, 'b'.repeat(64), keysB);
    await openA(hostA.authority, 'same-label');
    await openB(hostB.authority, 'same-label');
    try {
      expect(await aManager.getProviderKeys().getKey('shared-name')).toBe(
        'root-a-secret',
      );
      expect(await bManager.getProviderKeys().getKey('shared-name')).toBe(
        'root-b-secret',
      );
      await closeA();
      expect(await bManager.getProviderKeys().getKey('shared-name')).toBe(
        'root-b-secret',
      );
    } finally {
      await Promise.all([closeA(), closeB()]);
      await Promise.all([hostA.close(), hostB.close()]);
    }
  });
});

describe('provider-manager token ownership', () => {
  let aOAuth: OAuthManager;
  const aRetiring: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await closeA();
  });
  async function closeA(): Promise<void> {
    await runCleanupSteps(aRetiring.splice(0).reverse());
  }
  async function openA(
    authority: CredentialAuthority,
    runtimeId: string,
    config?: Config,
  ): Promise<void> {
    try {
      const settings = new SettingsService();
      const manager = new ProviderManager(
        undefined,
        undefined,
        undefined,
        undefined,
        settings,
        config,
        { runtimeId },
      );

      aRetiring.push(() => manager.dispose());
      const keys = authority.createProviderKeyStorage();
      manager.bindProviderKeyStorage(keys, () => keys.close());
      const tokens = authority.createTokenStore();
      let transferred = false;
      aRetiring.push(() =>
        transferred ? undefined : createOwnedTokenStoreClose(tokens)(),
      );
      const oauth = createOwnedOAuthManager(
        tokens,
        undefined,
        undefined,
        config,
        manager,
        settings,
      );
      aOAuth = oauth;
      aRetiring.push(() => oauth.dispose());
      transferred = true;
      populateProviderManager({
        target: createProviderPopulationTarget(manager, oauth, tokens),
        readSetting: (key) => settings.get(key),
        fileSystem: new NodeFileSystem(),
        configuration:
          config === undefined
            ? { kind: 'pre-config' }
            : { kind: 'configured', config },
        contributions: { kind: 'none' },
        messages: { kind: 'none' },
        allowBrowser: false,
        activateConfiguredProvider: true,
        fakeResponses: { kind: 'disabled' },
      });
    } catch (primary) {
      await cleanupAfterFailure(primary, closeA);
    }
  }

  let bOAuth: OAuthManager;
  const bRetiring: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await closeB();
  });
  async function closeB(): Promise<void> {
    await runCleanupSteps(bRetiring.splice(0).reverse());
  }
  async function openB(
    authority: CredentialAuthority,
    runtimeId: string,
    config?: Config,
  ): Promise<void> {
    try {
      const settings = new SettingsService();
      const manager = new ProviderManager(
        undefined,
        undefined,
        undefined,
        undefined,
        settings,
        config,
        { runtimeId },
      );

      bRetiring.push(() => manager.dispose());
      const keys = authority.createProviderKeyStorage();
      manager.bindProviderKeyStorage(keys, () => keys.close());
      const tokens = authority.createTokenStore();
      let transferred = false;
      bRetiring.push(() =>
        transferred ? undefined : createOwnedTokenStoreClose(tokens)(),
      );
      const oauth = createOwnedOAuthManager(
        tokens,
        undefined,
        undefined,
        config,
        manager,
        settings,
      );
      bOAuth = oauth;
      bRetiring.push(() => oauth.dispose());
      transferred = true;
      populateProviderManager({
        target: createProviderPopulationTarget(manager, oauth, tokens),
        readSetting: (key) => settings.get(key),
        fileSystem: new NodeFileSystem(),
        configuration:
          config === undefined
            ? { kind: 'pre-config' }
            : { kind: 'configured', config },
        contributions: { kind: 'none' },
        messages: { kind: 'none' },
        allowBrowser: false,
        activateConfiguredProvider: true,
        fakeResponses: { kind: 'disabled' },
      });
    } catch (primary) {
      await cleanupAfterFailure(primary, closeB);
    }
  }

  let parentOAuth: OAuthManager;
  const parentRetiring: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await closeParent();
  });
  async function closeParent(): Promise<void> {
    await runCleanupSteps(parentRetiring.splice(0).reverse());
  }
  async function openParent(
    authority: CredentialAuthority,
    runtimeId: string,
    config?: Config,
  ): Promise<void> {
    try {
      const settings = new SettingsService();
      const manager = new ProviderManager(
        undefined,
        undefined,
        undefined,
        undefined,
        settings,
        config,
        { runtimeId },
      );

      parentRetiring.push(() => manager.dispose());
      const keys = authority.createProviderKeyStorage();
      manager.bindProviderKeyStorage(keys, () => keys.close());
      const tokens = authority.createTokenStore();
      let transferred = false;
      parentRetiring.push(() =>
        transferred ? undefined : createOwnedTokenStoreClose(tokens)(),
      );
      const oauth = createOwnedOAuthManager(
        tokens,
        undefined,
        undefined,
        config,
        manager,
        settings,
      );
      parentOAuth = oauth;
      parentRetiring.push(() => oauth.dispose());
      transferred = true;
      populateProviderManager({
        target: createProviderPopulationTarget(manager, oauth, tokens),
        readSetting: (key) => settings.get(key),
        fileSystem: new NodeFileSystem(),
        configuration:
          config === undefined
            ? { kind: 'pre-config' }
            : { kind: 'configured', config },
        contributions: { kind: 'none' },
        messages: { kind: 'none' },
        allowBrowser: false,
        activateConfiguredProvider: true,
        fakeResponses: { kind: 'disabled' },
      });
    } catch (primary) {
      await cleanupAfterFailure(primary, closeParent);
    }
  }

  const replacementRetiring: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await closeReplacement();
  });
  async function closeReplacement(): Promise<void> {
    await runCleanupSteps(replacementRetiring.splice(0).reverse());
  }
  async function openReplacement(
    authority: CredentialAuthority,
    runtimeId: string,
    config?: Config,
  ): Promise<void> {
    try {
      const settings = new SettingsService();
      const manager = new ProviderManager(
        undefined,
        undefined,
        undefined,
        undefined,
        settings,
        config,
        { runtimeId },
      );

      replacementRetiring.push(() => manager.dispose());
      const keys = authority.createProviderKeyStorage();
      manager.bindProviderKeyStorage(keys, () => keys.close());
      const tokens = authority.createTokenStore();
      let transferred = false;
      replacementRetiring.push(() =>
        transferred ? undefined : createOwnedTokenStoreClose(tokens)(),
      );
      const oauth = createOwnedOAuthManager(
        tokens,
        undefined,
        undefined,
        config,
        manager,
        settings,
      );

      replacementRetiring.push(() => oauth.dispose());
      transferred = true;
      populateProviderManager({
        target: createProviderPopulationTarget(manager, oauth, tokens),
        readSetting: (key) => settings.get(key),
        fileSystem: new NodeFileSystem(),
        configuration:
          config === undefined
            ? { kind: 'pre-config' }
            : { kind: 'configured', config },
        contributions: { kind: 'none' },
        messages: { kind: 'none' },
        allowBrowser: false,
        activateConfiguredProvider: true,
        fakeResponses: { kind: 'disabled' },
      });
    } catch (primary) {
      await cleanupAfterFailure(primary, closeReplacement);
    }
  }

  let isolatedOAuth: OAuthManager;
  const isolatedRetiring: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await closeIsolated();
  });
  async function closeIsolated(): Promise<void> {
    await runCleanupSteps(isolatedRetiring.splice(0).reverse());
  }
  async function openIsolated(
    authority: CredentialAuthority,
    runtimeId: string,
    config?: Config,
  ): Promise<void> {
    try {
      const settings = new SettingsService();
      const manager = new ProviderManager(
        undefined,
        undefined,
        undefined,
        undefined,
        settings,
        config,
        { runtimeId },
      );

      isolatedRetiring.push(() => manager.dispose());
      const keys = authority.createProviderKeyStorage();
      manager.bindProviderKeyStorage(keys, () => keys.close());
      const tokens = authority.createTokenStore();
      let transferred = false;
      isolatedRetiring.push(() =>
        transferred ? undefined : createOwnedTokenStoreClose(tokens)(),
      );
      const oauth = createOwnedOAuthManager(
        tokens,
        undefined,
        undefined,
        config,
        manager,
        settings,
      );
      isolatedOAuth = oauth;
      isolatedRetiring.push(() => oauth.dispose());
      transferred = true;
      populateProviderManager({
        target: createProviderPopulationTarget(manager, oauth, tokens),
        readSetting: (key) => settings.get(key),
        fileSystem: new NodeFileSystem(),
        configuration:
          config === undefined
            ? { kind: 'pre-config' }
            : { kind: 'configured', config },
        contributions: { kind: 'none' },
        messages: { kind: 'none' },
        allowBrowser: false,
        activateConfiguredProvider: true,
        fakeResponses: { kind: 'disabled' },
      });
    } catch (primary) {
      await cleanupAfterFailure(primary, closeIsolated);
    }
  }

  it('gives concurrently live roots different stores even for the same socket', async () => {
    const authority = new CredentialAuthority('/unconnected-test.sock');
    await openA(authority, 'a');
    await openB(authority, 'b');
    try {
      const first = aOAuth.getTokenStore();
      const second = bOAuth.getTokenStore();
      expect(first).not.toBe(second);
    } finally {
      await Promise.all([closeA(), closeB()]);
    }
  });

  it('keeps B accepted token reads alive while A replaces its socket', async () => {
    const tokens = new HeldTokenStore();
    await tokens.saveToken('test', makeToken());
    const host = await proxy(tokens);
    await openA(host.authority, 'a');
    await openB(host.authority, 'b');
    let replacementOpened = false;
    try {
      const pending = bOAuth.getTokenStore().getToken('test');
      await tokens.entered;
      await closeA();
      await openReplacement(new CredentialAuthority('/replacement.sock'), 'a');
      replacementOpened = true;
      tokens.release();
      expect(await pending).toMatchObject({ token_type: 'Bearer' });
    } finally {
      tokens.release();
      await closeB();
      if (replacementOpened) await closeReplacement();
      await host.close();
    }
  });

  it('closes A transport on disposal while B remains readable', async () => {
    const tokens = new HeldTokenStore();
    await tokens.saveToken('test', makeToken());
    const host = await proxy(tokens);
    await openA(host.authority, 'a');
    await openB(host.authority, 'b');
    try {
      const pending = aOAuth
        .getTokenStore()
        .getToken('test')
        .catch((error: unknown) => error);
      await tokens.entered;
      await aOAuth.dispose();
      const outcome = await pending;
      expect(outcome).toBeInstanceOf(Error);
      expect(outcome).toMatchObject({ message: 'Client closed' });
      tokens.release();
      expect(await bOAuth.getTokenStore().getToken('test')).toMatchObject({
        token_type: 'Bearer',
      });
    } finally {
      tokens.release();
      await Promise.all([closeA(), closeB()]);
      await host.close();
    }
  });

  it('routes two capability roots independently and leaves B readable after A disposal', async () => {
    const tokensA = new InMemoryTokenStore();
    const tokensB = new InMemoryTokenStore();
    await tokensA.saveToken('only-a', makeToken());
    await tokensB.saveToken('only-b', makeToken());
    const hostA = await proxy(tokensA, 'a'.repeat(64));
    const hostB = await proxy(tokensB, 'b'.repeat(64));
    await openA(hostA.authority, 'same-label');
    await openB(hostB.authority, 'same-label');
    try {
      await expect(bOAuth.getTokenStore().getToken('only-a')).rejects.toThrow(
        'Access denied',
      );
      expect(await aOAuth.getTokenStore().getToken('only-a')).toMatchObject({
        token_type: 'Bearer',
      });
      await aOAuth.dispose();
      expect(await bOAuth.getTokenStore().getToken('only-b')).toMatchObject({
        token_type: 'Bearer',
      });
    } finally {
      await Promise.all([closeA(), closeB()]);
      await Promise.all([hostA.close(), hostB.close()]);
    }
  });

  it('gives an isolated runtime its own store and cleanup leaves the root readable', async () => {
    const tokens = new InMemoryTokenStore();
    await tokens.saveToken('test', makeToken());
    const host = await proxy(tokens);
    await openParent(host.authority, 'same-label');
    const directory = mkdtempSync(join(tmpdir(), 'isolated-token-owner-'));
    const config = new Config({
      sessionId: 'same-label',
      targetDir: directory,
      cwd: directory,
      model: 'test-model',
      debugMode: false,
    });
    await openIsolated(host.authority, 'same-label', config);
    try {
      const rootStore = parentOAuth.getTokenStore();
      const childStore = isolatedOAuth.getTokenStore();
      expect(childStore).not.toBe(rootStore);
      expect(await childStore.getToken('test')).toMatchObject({
        token_type: 'Bearer',
      });
      await closeIsolated();
      expect(await rootStore.getToken('test')).toMatchObject({
        token_type: 'Bearer',
      });
    } finally {
      await closeIsolated();
      await closeParent();
      await config.dispose();
      rmSync(directory, { recursive: true, force: true });
      await host.close();
    }
  });
});
