/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTestOAuthBinding } from '../client/test-support/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MCPOAuthTokenStorage } from './oauth-token-storage.js';
import { FileTokenStorage } from './token-storage/file-token-storage.js';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  MCPOAuthProvider,
  OAUTH_DISPLAY_MESSAGE_EVENT,
  type MCPOAuthConfig,
} from './oauth-provider.js';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
const network: {
  fetch: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
} = globalThis;
const clock: {
  setTimeout: (
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => ReturnType<typeof setTimeout>;
} = globalThis;

const config: MCPOAuthConfig = {
  clientId: 'lifetime-client',
  authorizationUrl: 'https://auth.example.invalid/authorize',
  tokenUrl: 'https://auth.example.invalid/token',
  scopes: ['read', 'write'],
};

async function requestCallback(
  server: http.Server,
  query: string,
): Promise<{ status: number | undefined; body: string }> {
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Callback listener has no TCP address');
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path: `/oauth/callback?${query}`,
        agent: false,
      },
      (response) => {
        response.setEncoding('utf8');
        let body = '';
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () =>
          resolve({ status: response.statusCode, body }),
        );
        response.on('error', reject);
      },
    );
    request.on('error', reject);
  });
}

function captureAuthorization(): {
  events: EventEmitter;
  url: Promise<URL>;
  messages: () => readonly string[];
} {
  const events = new EventEmitter();
  const url = deferred<URL>();
  let messages: readonly string[] = [];
  events.on(OAUTH_DISPLAY_MESSAGE_EVENT, (message: string) => {
    messages = [...messages, message];
    const line = message
      .split('\n')
      .find((part) => part.startsWith('https://'));
    if (line !== undefined) url.resolve(new URL(line));
  });
  return { events, url: url.promise, messages: () => messages };
}

describe('MCP exported authenticate callback lifetime', () => {
  function useOAuthResources(): {
    servers: () => readonly http.Server[];
    timers: () => number;
    expectClosed: () => void;
    listening: () => Promise<http.Server>;
  } {
    let servers: readonly http.Server[] = [];
    let closed = 0;
    let cleared = 0;
    const allocatedTimers = new Set<ReturnType<typeof setTimeout>>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let listening = deferred<http.Server>();
    const listen = http.Server.prototype.listen;
    const setTimer = globalThis.setTimeout;
    const clearTimer = globalThis.clearTimeout;

    beforeEach(() => {
      servers = [];
      closed = 0;
      cleared = 0;
      allocatedTimers.clear();
      listening = deferred<http.Server>();
      vi.spyOn(http.Server.prototype, 'listen').mockImplementation(function (
        this: http.Server,
        ...args: unknown[]
      ): http.Server {
        servers = [...servers, this];
        this.on('close', () => {
          closed++;
        });
        const callback = args.find((arg) => typeof arg === 'function');
        return listen.call(this, { port: 0, host: '127.0.0.1' }, () => {
          if (typeof callback === 'function') callback();
          listening.resolve(this);
        });
      });
      vi.spyOn(clock, 'setTimeout').mockImplementation(
        (callback, delay, ...args) => {
          const timer = setTimer(callback, delay, ...args);
          if (delay === 300000) {
            timers.add(timer);
            allocatedTimers.add(timer);
          }
          return timer;
        },
      );
      vi.spyOn(globalThis, 'clearTimeout').mockImplementation((timer) => {
        for (const tracked of allocatedTimers) {
          if (tracked === timer) cleared++;
        }
        for (const tracked of timers) {
          if (tracked === timer) timers.delete(tracked);
        }
        clearTimer(timer === undefined ? undefined : Number(timer));
      });
      vi.spyOn(network, 'fetch').mockImplementation(async () => {
        throw new Error('Unexpected external network request');
      });
    });

    afterEach(async () => {
      for (const timer of timers) clearTimer(timer);
      timers.clear();
      await Promise.all(
        servers.map(async (server): Promise<void> => {
          server.closeAllConnections();
          if (server.listening) {
            await new Promise<void>((resolve, reject) => {
              server.close((error) => (error ? reject(error) : resolve()));
            });
          }
        }),
      );
      vi.restoreAllMocks();
    });

    return {
      expectClosed: () => {
        expect(closed).toBe(servers.length);
        expect(timers.size).toBe(0);
        expect(cleared).toBe(allocatedTimers.size);
      },
      servers: () => servers,
      timers: () => timers.size,
      listening: () => listening.promise,
    };
  }

  const resources = useOAuthResources();

  it('baseline: manual URL fallback retains PKCE through a failed token exchange and closes the listener', async () => {
    const display = captureAuthorization();
    const tokenRequest = deferred<URLSearchParams>();
    vi.spyOn(network, 'fetch').mockImplementation(async (_input, init) => {
      if (typeof init?.body !== 'string')
        throw new Error('Expected token form');
      tokenRequest.resolve(new URLSearchParams(init.body));
      return new Response(
        'error=invalid_grant&error_description=Expired+code',
        {
          status: 400,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      );
    });
    const result = MCPOAuthProvider.authenticate(
      {
        tokenStorage: createTestOAuthBinding().tokenStorage,
        openBrowser: createTestOAuthBinding().openBrowser,
      },
      'manual-lifetime',
      { ...config },
      undefined,
      display.events,
    ).catch((error: unknown) => error);
    const url = await display.url;
    const server = await resources.listening();
    const response = await requestCallback(
      server,
      new URLSearchParams({
        code: 'manual-code',
        state: url.searchParams.get('state') ?? '',
      }).toString(),
    );
    const form = await tokenRequest.promise;
    expect(response.status).toBe(200);
    expect(response.body).toContain('Authentication Successful!');
    expect(await result).toStrictEqual(
      new Error('Token exchange failed: invalid_grant - Expired code'),
    );
    expect(display.messages().join('\n')).toContain(
      'If the browser does not open, copy and paste this URL into your browser:',
    );
    expect(form.get('code')).toBe('manual-code');
    expect(form.get('redirect_uri')).toBe(url.searchParams.get('redirect_uri'));
    const verifier = form.get('code_verifier');
    if (verifier === null)
      throw new Error('Token exchange omitted PKCE verifier');
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(verifier).digest('base64url'),
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('read write');
    expect(server.listening).toBe(false);
    resources.expectClosed();
  });

  it('baseline: denied callback preserves the exact error and closes the listener', async () => {
    const display = captureAuthorization();
    const result = MCPOAuthProvider.authenticate(
      {
        tokenStorage: createTestOAuthBinding().tokenStorage,
        openBrowser: createTestOAuthBinding().openBrowser,
      },
      'denied-lifetime',
      { ...config },
      undefined,
      display.events,
    ).catch((error: unknown) => error);
    await display.url;
    const server = await resources.listening();
    const response = await requestCallback(server, 'error=access_denied');
    expect(await result).toStrictEqual(new Error('OAuth error: access_denied'));
    expect(response.body).toContain('Authentication Failed');
    expect(server.listening).toBe(false);
    resources.expectClosed();
  });

  it('retained red: delayed registration failure releases the listening callback server and timer', async () => {
    const entered = deferred<void>();
    const response = deferred<Response>();
    let activeFetches = 0;
    vi.spyOn(network, 'fetch').mockImplementation(async () => {
      activeFetches++;
      entered.resolve();
      try {
        return await response.promise;
      } finally {
        activeFetches--;
      }
    });
    const result = MCPOAuthProvider.authenticate(
      {
        tokenStorage: createTestOAuthBinding().tokenStorage,
        openBrowser: createTestOAuthBinding().openBrowser,
      },
      'registration-lifetime',
      {
        authorizationUrl: config.authorizationUrl,
        tokenUrl: config.tokenUrl,
        registrationUrl: 'https://auth.example.invalid/register',
      },
    ).catch((error: unknown) => error);
    await entered.promise;
    const server = await resources.listening();
    try {
      expect({
        listening: server.listening,
        fetches: activeFetches,
        timers: resources.timers(),
      }).toStrictEqual({ listening: true, fetches: 1, timers: 1 });
    } finally {
      response.resolve(
        new Response('registration unavailable', {
          status: 503,
          statusText: 'Service Unavailable',
        }),
      );
    }
    expect(await result).toStrictEqual(
      new Error(
        'Client registration failed: 503 Service Unavailable - registration unavailable',
      ),
    );
    expect({
      listening: server.listening,
      fetches: activeFetches,
      timers: resources.timers(),
    }).toStrictEqual({ listening: false, fetches: 0, timers: 0 });
    resources.expectClosed();
  });

  it('retained red: validation failure after listening releases the callback server and timer', async () => {
    const result = MCPOAuthProvider.authenticate(
      {
        tokenStorage: createTestOAuthBinding().tokenStorage,
        openBrowser: createTestOAuthBinding().openBrowser,
      },
      'validation-lifetime',
      {
        clientId: 'configured-client',
      },
    ).catch((error: unknown) => error);
    const server = await resources.listening();
    expect(await result).toStrictEqual(
      new Error(
        'Missing required OAuth configuration after discovery and registration',
      ),
    );
    expect({
      listening: server.listening,
      timers: resources.timers(),
    }).toStrictEqual({ listening: false, timers: 0 });
    resources.expectClosed();
  });

  it('retained red: denied callback releases its five-minute deadline', async () => {
    const display = captureAuthorization();
    const result = MCPOAuthProvider.authenticate(
      {
        tokenStorage: createTestOAuthBinding().tokenStorage,
        openBrowser: createTestOAuthBinding().openBrowser,
      },
      'deadline-lifetime',
      { ...config },
      undefined,
      display.events,
    ).catch((error: unknown) => error);
    await display.url;
    await requestCallback(await resources.listening(), 'error=access_denied');
    expect(await result).toStrictEqual(new Error('OAuth error: access_denied'));
    expect(resources.servers().every((server) => !server.listening)).toBe(true);
    expect(resources.timers()).toBe(0);
    resources.expectClosed();
  });

  it('preserves a registration transport error after an early denied callback', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const failure = new Error('Registration connection reset');
    vi.spyOn(network, 'fetch').mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      throw failure;
    });
    const result = MCPOAuthProvider.authenticate(
      {
        tokenStorage: createTestOAuthBinding().tokenStorage,
        openBrowser: createTestOAuthBinding().openBrowser,
      },
      'early-denial',
      {
        authorizationUrl: config.authorizationUrl,
        tokenUrl: config.tokenUrl,
        registrationUrl: 'https://auth.example.invalid/register',
      },
    ).catch((error: unknown) => error);
    await entered.promise;
    try {
      await requestCallback(await resources.listening(), 'error=access_denied');
    } finally {
      release.resolve();
    }
    expect(await result).toBe(failure);
    resources.expectClosed();
  });

  it('closes callback resources before persisting a successful manual authorization', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-auth-lifetime-'));
    const store = new FileTokenStorage('lifetime', {
      tokenFilePath: join(directory, 'tokens.json'),
      machineSecretLoader: async () => Buffer.alloc(32, 7),
    });
    try {
      const display = captureAuthorization();
      vi.spyOn(network, 'fetch').mockImplementation(async () => {
        resources.expectClosed();
        return Response.json({
          access_token: 'granted-token',
          refresh_token: 'renew-token',
          token_type: 'Bearer',
          scope: 'read write',
        });
      });
      const result = MCPOAuthProvider.authenticate(
        {
          tokenStorage: new MCPOAuthTokenStorage(store),
          openBrowser: createTestOAuthBinding().openBrowser,
        },
        'saved-lifetime',
        { ...config },
        undefined,
        display.events,
      );
      const url = await display.url;
      await requestCallback(
        await resources.listening(),
        new URLSearchParams({
          code: 'accepted-code',
          state: url.searchParams.get('state') ?? '',
        }).toString(),
      );
      const token = await result;
      const saved = await store.getCredentials('saved-lifetime');
      expect(token.accessToken).toBe('granted-token');
      expect(saved?.token).toStrictEqual(token);
      expect(saved?.clientId).toBe(config.clientId);
      expect(saved?.tokenUrl).toBe(config.tokenUrl);
      resources.expectClosed();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
