/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
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
import { createProviderManager } from './providerManagerInstance.js';
import { NodeFileSystem } from './IFileSystem.js';
import { createIsolatedRuntimeContext } from '../runtime/runtimeActivationBindings.js';

function root(
  authority: CredentialAuthority,
  runtimeId: string,
): ReturnType<typeof createProviderManager> {
  return createProviderManager(
    new SettingsService(),
    { settingsService: new SettingsService(), runtimeId },
    undefined,
    authority,
    new NodeFileSystem(),
  );
}

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

async function retire(owner: ReturnType<typeof root>): Promise<void> {
  await owner.oauthManager.dispose();
  owner.manager.dispose();
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
  it('routes the same key name to each root and keeps B usable after A disposal', async () => {
    const keysA = new InMemoryProviderKeyStorage();
    const keysB = new InMemoryProviderKeyStorage();
    await keysA.saveKey('shared-name', 'root-a-secret');
    await keysB.saveKey('shared-name', 'root-b-secret');
    const hostA = await proxy(undefined, 'a'.repeat(64), keysA);
    const hostB = await proxy(undefined, 'b'.repeat(64), keysB);
    const a = root(hostA.authority, 'same-label');
    const b = root(hostB.authority, 'same-label');
    try {
      expect(await a.manager.getProviderKeys().getKey('shared-name')).toBe(
        'root-a-secret',
      );
      expect(await b.manager.getProviderKeys().getKey('shared-name')).toBe(
        'root-b-secret',
      );
      await retire(a);
      expect(await b.manager.getProviderKeys().getKey('shared-name')).toBe(
        'root-b-secret',
      );
    } finally {
      await Promise.all([retire(a), retire(b)]);
      await Promise.all([hostA.close(), hostB.close()]);
    }
  });
});

describe('provider-manager token ownership', () => {
  it('gives concurrently live roots different stores even for the same socket', async () => {
    const authority = new CredentialAuthority('/unconnected-test.sock');
    const a = root(authority, 'a');
    const b = root(authority, 'b');
    try {
      const first = a.oauthManager.getTokenStore();
      const second = b.oauthManager.getTokenStore();
      expect(first).not.toBe(second);
    } finally {
      await Promise.all([retire(a), retire(b)]);
    }
  });

  it('keeps B accepted token reads alive while A replaces its socket', async () => {
    const tokens = new HeldTokenStore();
    await tokens.saveToken('test', makeToken());
    const host = await proxy(tokens);
    const a = root(host.authority, 'a');
    const b = root(host.authority, 'b');
    let replacement: ReturnType<typeof root> | undefined;
    try {
      const pending = b.oauthManager.getTokenStore().getToken('test');
      await tokens.entered;
      await retire(a);
      replacement = root(new CredentialAuthority('/replacement.sock'), 'a');
      tokens.release();
      expect(await pending).toMatchObject({ token_type: 'Bearer' });
    } finally {
      tokens.release();
      await retire(b);
      if (replacement) await retire(replacement);
      await host.close();
    }
  });

  it('closes A transport on disposal while B remains readable', async () => {
    const tokens = new HeldTokenStore();
    await tokens.saveToken('test', makeToken());
    const host = await proxy(tokens);
    const a = root(host.authority, 'a');
    const b = root(host.authority, 'b');
    try {
      const pending = a.oauthManager
        .getTokenStore()
        .getToken('test')
        .catch((error: unknown) => error);
      await tokens.entered;
      await a.oauthManager.dispose();
      const outcome = await pending;
      expect(outcome).toBeInstanceOf(Error);
      expect(outcome).toMatchObject({ message: 'Client closed' });
      tokens.release();
      expect(
        await b.oauthManager.getTokenStore().getToken('test'),
      ).toMatchObject({ token_type: 'Bearer' });
    } finally {
      tokens.release();
      await Promise.all([retire(a), retire(b)]);
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
    const a = root(hostA.authority, 'same-label');
    const b = root(hostB.authority, 'same-label');
    try {
      await expect(
        b.oauthManager.getTokenStore().getToken('only-a'),
      ).rejects.toThrow('Access denied');
      expect(
        await a.oauthManager.getTokenStore().getToken('only-a'),
      ).toMatchObject({ token_type: 'Bearer' });
      await a.oauthManager.dispose();
      expect(
        await b.oauthManager.getTokenStore().getToken('only-b'),
      ).toMatchObject({ token_type: 'Bearer' });
    } finally {
      await Promise.all([retire(a), retire(b)]);
      await Promise.all([hostA.close(), hostB.close()]);
    }
  });

  it('gives an isolated runtime its own store and cleanup leaves the root readable', async () => {
    const tokens = new InMemoryTokenStore();
    await tokens.saveToken('test', makeToken());
    const host = await proxy(tokens);
    const parent = root(host.authority, 'same-label');
    const config = new Config({
      sessionId: 'same-label',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      model: 'test-model',
      debugMode: false,
    });
    const isolated = createIsolatedRuntimeContext(
      { config, credentialAuthority: host.authority },
      new SettingsService(),
    );
    try {
      const rootStore = parent.oauthManager.getTokenStore();
      const childStore = isolated.oauthManager.getTokenStore();
      expect(childStore).not.toBe(rootStore);
      expect(await childStore.getToken('test')).toMatchObject({
        token_type: 'Bearer',
      });
      await isolated.cleanup();
      expect(await rootStore.getToken('test')).toMatchObject({
        token_type: 'Bearer',
      });
    } finally {
      await isolated.cleanup();
      await retire(parent);
      await config.dispose();
      await host.close();
    }
  });
});
