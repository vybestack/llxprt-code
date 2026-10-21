/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, spyOn } from 'bun:test';
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

type CredentialFixtureTrace = (
  boundary: string,
  state?: Readonly<Record<string, boolean | readonly number[]>>,
) => void;

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
    private readonly trace?: CredentialFixtureTrace,
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

  static async create(
    trace?: CredentialFixtureTrace,
  ): Promise<OwnedCredentialFixture> {
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: new InMemoryProviderKeyStorage(),
    });
    trace?.('credentials.server.start:enter');
    const socketPath = await server.start();
    trace?.('credentials.server.start:exit', {
      socketAssigned: server.getSocketPath() !== null,
    });
    return new OwnedCredentialFixture(socketPath, server, trace);
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
    this.trace?.('credentials.clients.close:enter', {
      transportCloses: this.snapshot(),
      keyCloses: this.keySnapshot(),
    });
    for (const key of this.keys) key.cleanup();
    for (const transport of this.transports) transport.getClient().close();
    this.trace?.('credentials.server.stop:enter', {
      socketAssigned: this.server.getSocketPath() !== null,
      transportCloses: this.snapshot(),
      keyCloses: this.keySnapshot(),
    });
    await this.server.stop();
    this.trace?.('credentials.server.stop:exit', {
      socketAssigned: this.server.getSocketPath() !== null,
    });
  }
}

export function useOwnedCredentials(
  trace?: CredentialFixtureTrace,
): () => OwnedCredentialFixture {
  let fixture: OwnedCredentialFixture;
  let home: string;
  let previousHome: string | undefined;
  beforeEach(async () => {
    trace?.('credentials.beforeEach:enter');
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    trace?.('credentials.home.create:enter');
    home = await mkdtemp(join(tmpdir(), 'preferred-credential-owner-'));
    trace?.('credentials.home.create:exit');
    process.env.LLXPRT_CONFIG_HOME = home;
    trace?.('credentials.settings.write:enter');
    await writeFile(
      join(home, 'settings.json'),
      JSON.stringify({ oauthEnabledProviders: { codex: true } }),
    );
    trace?.('credentials.settings.write:exit');
    trace?.('credentials.fixture.create:enter');
    fixture = await OwnedCredentialFixture.create(trace);
    trace?.('credentials.fixture.create:exit');
    trace?.('credentials.beforeEach:exit');
  });
  afterEach(async () => {
    trace?.('credentials.afterEach:enter');
    try {
      trace?.('credentials.fixture.dispose:enter');
      await fixture.dispose();
      trace?.('credentials.fixture.dispose:exit');
    } finally {
      trace?.('credentials.afterEach.finally:enter');
      if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = previousHome;
      trace?.('credentials.home.remove:enter');
      await rm(home, { recursive: true, force: true });
      trace?.('credentials.home.remove:exit');
    }
    trace?.('credentials.afterEach:exit');
  });
  return () => fixture;
}

export function failCredentialProxyShutdown(error: Error): {
  mockRestore(): void;
} {
  const stop = CredentialProxyServer.prototype.stop;
  return spyOn(CredentialProxyServer.prototype, 'stop').mockImplementationOnce(
    async function (this: CredentialProxyServer): Promise<void> {
      await stop.call(this);
      throw error;
    },
  );
}

export function observeCredentialProxyStarts(): {
  servers: CredentialProxyServer[];
  endpoints: string[];
  mockRestore(): void;
} {
  const servers: CredentialProxyServer[] = [];
  const endpoints: string[] = [];
  const start = CredentialProxyServer.prototype.start;
  const capture = spyOn(
    CredentialProxyServer.prototype,
    'start',
  ).mockImplementation(async function (
    this: CredentialProxyServer,
  ): Promise<string> {
    servers.push(this);
    const endpoint = await start.call(this);
    endpoints.push(endpoint);
    return endpoint;
  });
  return { servers, endpoints, mockRestore: () => capture.mockRestore() };
}
