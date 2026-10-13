/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach } from 'bun:test';
import { ProxyTokenStore } from '@vybestack/llxprt-code-auth/proxy/proxy-token-store.js';
import type { OAuthToken, TokenStore } from '@vybestack/llxprt-code-auth';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { CredentialProxyServer } from '../../../../../providers/src/auth/proxy/credential-proxy-server.js';
import {
  InMemoryTokenStore,
  InMemoryProviderKeyStorage,
} from '../../../../../providers/src/auth/proxy/__tests__/credential-proxy-server-helpers.js';

class ObservedTokenTransport extends ProxyTokenStore {
  closeCount = 0;

  constructor(socketPath: string) {
    super(socketPath);
    const client = this.getClient();
    const close = client.close.bind(client);
    client.close = (): void => {
      this.closeCount += 1;
      close();
    };
  }
}

export class OwnedCredentialFixture {
  readonly authority: CredentialAuthority;
  private readonly transports: ObservedTokenTransport[] = [];
  private readonly keys: Array<{
    storage: ReturnType<CredentialAuthority['createProviderKeyStorage']>;
    closes: number;
    cleanup: () => void;
  }> = [];

  private constructor(
    socketPath: string,
    private readonly server: CredentialProxyServer,
  ) {
    const transports = this.transports;
    const keys = this.keys;
    this.authority = new (class extends CredentialAuthority {
      override createProviderKeyStorage(): ReturnType<
        CredentialAuthority['createProviderKeyStorage']
      > {
        const storage = super.createProviderKeyStorage();
        const close = storage.close.bind(storage);
        const observed = { storage, closes: 0, cleanup: close };
        storage.close = (): void => {
          observed.closes += 1;
          close();
        };
        keys.push(observed);
        return storage;
      }
      override createTokenStore(): TokenStore {
        const transport = new ObservedTokenTransport(socketPath);
        transports.push(transport);
        return transport;
      }
    })(socketPath);
  }

  static async create(): Promise<OwnedCredentialFixture> {
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: new InMemoryProviderKeyStorage(),
    });
    return new OwnedCredentialFixture(await server.start(), server);
  }

  snapshot(): readonly number[] {
    return this.transports.map((transport) => transport.closeCount);
  }

  keySnapshot(): readonly number[] {
    return this.keys.map((key) => key.closes);
  }

  async listProviders(index: number): Promise<string[]> {
    const transport = this.transports.find((_, position) => position === index);
    if (transport === undefined) throw new Error('Missing acquired transport');
    return transport.listProviders();
  }

  async saveToken(
    index: number,
    provider: string,
    token: OAuthToken,
  ): Promise<void> {
    const transport = this.transports.find((_, position) => position === index);
    if (transport === undefined) throw new Error('Missing acquired transport');
    await transport.saveToken(provider, token);
  }

  async dispose(): Promise<void> {
    for (const key of this.keys) key.cleanup();
    for (const transport of this.transports) transport.getClient().close();
    await this.server.stop();
  }
}

export function useOwnedCredentials(): () => OwnedCredentialFixture {
  let fixture: OwnedCredentialFixture;
  let home: string;
  let previousHome: string | undefined;
  beforeEach(async () => {
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    home = await mkdtemp(join(tmpdir(), 'preferred-credential-owner-'));
    process.env.LLXPRT_CONFIG_HOME = home;
    await writeFile(
      join(home, 'settings.json'),
      JSON.stringify({ oauthEnabledProviders: { codex: true } }),
    );
    fixture = await OwnedCredentialFixture.create();
  });
  afterEach(async () => {
    try {
      await fixture.dispose();
    } finally {
      if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = previousHome;
      await rm(home, { recursive: true, force: true });
    }
  });
  return () => fixture;
}
