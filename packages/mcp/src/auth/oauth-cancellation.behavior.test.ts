/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as http from 'node:http';
import { EventEmitter, getEventListeners } from 'node:events';
import {
  MCPOAuthProvider,
  OAUTH_DISPLAY_MESSAGE_EVENT,
  type MCPOAuthConfig,
} from './oauth-provider.js';
import { MCPOAuthTokenStorage } from './oauth-token-storage.js';
import type { OAuthCredentials, TokenStorage } from './token-storage/index.js';
import type { HostBrowserLauncher } from '../host/hostServices.js';
let openBrowser: HostBrowserLauncher;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const config: MCPOAuthConfig = {
  clientId: 'cancellation-client',
  authorizationUrl: 'https://auth.example.invalid/authorize',
  tokenUrl: 'https://auth.example.invalid/token',
};
const network: {
  fetch: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
} = globalThis;

function authorization(): {
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
    if (line) url.resolve(new URL(line));
  });
  return { events, url: url.promise, messages: () => messages };
}
async function callback(url: URL): Promise<void> {
  const target = new URL(url.searchParams.get('redirect_uri') ?? '');
  target.search = new URLSearchParams({
    code: 'accepted',
    state: url.searchParams.get('state') ?? '',
  }).toString();
  await new Promise<void>((resolve, reject) => {
    const request = http.get(target, { agent: false }, (response) => {
      response.resume();
      response.on('end', resolve);
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}
function observe<T>(work: Promise<T>): {
  result: Promise<unknown>;
  settled: () => boolean;
} {
  let settled = false;
  const result = work.then(
    (value) => {
      settled = true;
      return value;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  return { result, settled: () => settled };
}
async function turn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('MCP request-local authentication cancellation', () => {
  let servers: readonly http.Server[];
  let closures: ReadonlyArray<Promise<void>>;
  let beforeListening: () => void;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const setTimer = globalThis.setTimeout;
  const clearTimer = globalThis.clearTimeout;
  let closed: number;
  let browserStarts: number;
  let writes: readonly OAuthCredentials[];
  let reads: number;
  const listen = http.Server.prototype.listen;
  const nativeFetch = globalThis.fetch;
  const store: TokenStorage = {
    async setCredentials(value): Promise<void> {
      writes = [...writes, value];
    },
    async getCredentials(name): Promise<OAuthCredentials | null> {
      reads++;
      return writes.find((value) => value.serverName === name) ?? null;
    },
    async deleteCredentials(): Promise<void> {},
    async listServers(): Promise<string[]> {
      return writes.map((value) => value.serverName);
    },
    async getAllCredentials(): Promise<Map<string, OAuthCredentials>> {
      return new Map(writes.map((value) => [value.serverName, value]));
    },
    async clearAll(): Promise<void> {
      writes = [];
    },
  };
  beforeEach(() => {
    servers = [];
    closures = [];
    beforeListening = () => {};
    timers.clear();
    closed = 0;
    browserStarts = 0;
    writes = [];
    reads = 0;
    vi.spyOn(http.Server.prototype, 'listen').mockImplementation(function (
      this: http.Server,
      ...args: unknown[]
    ): http.Server {
      servers = [...servers, this];
      const closure = deferred<void>();
      closures = [...closures, closure.promise];
      this.once('close', () => {
        closed++;
        closure.resolve();
      });
      const callback = args.find((arg) => typeof arg === 'function');
      const server = listen.call(this, { port: 0, host: '127.0.0.1' }, () => {
        if (typeof callback === 'function') callback();
      });
      beforeListening();
      return server;
    });
    const clock: {
      setTimeout: (
        callback: (...args: unknown[]) => void,
        delay?: number,
        ...args: unknown[]
      ) => ReturnType<typeof setTimeout>;
    } = globalThis;
    vi.spyOn(clock, 'setTimeout').mockImplementation(
      (callback, delay, ...args) => {
        const timer = setTimer(callback, delay, ...args);
        if (delay === 300000) timers.add(timer);
        return timer;
      },
    );
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation((timer) => {
      for (const tracked of timers)
        if (tracked === timer) timers.delete(tracked);
      clearTimer(timer === undefined ? undefined : Number(timer));
    });
    openBrowser = async (): Promise<void> => {
      browserStarts++;
      throw new Error('Use manual URL');
    };
    vi.spyOn(network, 'fetch').mockImplementation(async () => {
      throw new Error('Unexpected network');
    });
  });
  afterEach(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await Promise.all(closures);
    for (const timer of timers) clearTimer(timer);
    vi.restoreAllMocks();
  });
  function expectClosed(): void {
    expect(servers.every((server) => !server.listening)).toBe(true);
    expect(closed).toBe(servers.length);
    expect(timers.size).toBe(0);
  }

  it('rejects pre-aborted input with the original reason without starting work', async () => {
    const controller = new AbortController();
    const reason = { cancelled: 'before entry' };
    controller.abort(reason);
    const display = authorization();
    const work = observe(
      MCPOAuthProvider.authenticate(
        {
          tokenStorage: new MCPOAuthTokenStorage(store),
          openBrowser,
        },
        'pre-abort',
        {},
        'https://same.invalid/mcp',
        display.events,
        controller.signal,
      ),
    );
    expect(await work.result).toBe(reason);
    expect(servers.length).toBe(0);
    expect(display.messages()).toStrictEqual([]);
    expect(browserStarts).toBe(0);
    expect(writes).toStrictEqual([]);
  });

  for (const phase of [
    'HEAD',
    'protected',
    'metadata',
    'header',
    'registration-metadata',
    'registration',
    'token',
  ] as const) {
    it(`joins abort-ignoring ${phase} fetch before rejecting and starting no later effects`, async () => {
      const controller = new AbortController();
      const reason = new Error(`cancel ${phase}`);
      const entered = deferred<AbortSignal | null | undefined>();
      const release = deferred<Response>();
      let active = 0;
      let requests = 0;
      const endpoint = 'https://same.invalid/mcp';
      vi.spyOn(network, 'fetch').mockImplementation(async (_input, init) => {
        requests++;
        if (phase === 'header' && requests === 1)
          return new Response(null, {
            status: 401,
            headers: {
              'www-authenticate':
                'Bearer resource_metadata="https://same.invalid/resource"',
            },
          });
        if ((phase === 'protected' || phase === 'metadata') && requests === 1)
          return new Response(null);
        if (phase === 'metadata' && requests === 2)
          return Response.json({
            resource: endpoint,
            authorization_servers: ['https://same.invalid'],
          });
        active++;
        entered.resolve(init?.signal);
        try {
          return await release.promise;
        } finally {
          active--;
        }
      });
      const registration =
        phase === 'registration' || phase === 'registration-metadata';
      const registrationConfig = registration
        ? {
            authorizationUrl: config.authorizationUrl,
            tokenUrl: config.tokenUrl,
            ...(phase === 'registration'
              ? { registrationUrl: 'https://same.invalid/register' }
              : {}),
          }
        : {};
      const input = phase === 'token' ? { ...config } : registrationConfig;
      const display = authorization();
      const work = observe(
        MCPOAuthProvider.authenticate(
          {
            tokenStorage: new MCPOAuthTokenStorage(store),
            openBrowser,
          },
          'same-server',
          input,
          endpoint,
          display.events,
          controller.signal,
        ),
      );
      if (phase === 'token') await callback(await display.url);
      const fetchSignal = await entered.promise;
      controller.abort(reason);
      const listeningAfterAbort = servers.some((server) => server.listening);
      const deadlinesAfterAbort = timers.size;
      await turn();
      const pending = !work.settled();
      const activeAtAbort = active;
      release.resolve(
        Response.json({
          client_id: 'late',
          access_token: 'late',
          token_type: 'Bearer',
        }),
      );
      expect(await work.result).toBe(reason);
      expect(fetchSignal).toBe(controller.signal);
      expect(pending).toBe(true);
      expect(activeAtAbort).toBe(1);
      expect(listeningAfterAbort).toBe(false);
      expect(deadlinesAfterAbort).toBe(0);
      expect(active).toBe(0);
      expect(writes).toStrictEqual([]);
      expect(browserStarts).toBe(phase === 'token' ? 1 : 0);
      expect(display.messages().length).toBe(phase === 'token' ? 1 : 0);
      expect(getEventListeners(controller.signal, 'abort')).toStrictEqual([]);
      expectClosed();
    });
  }

  it('aborts native loopback fetch and joins its settlement', async () => {
    const entered = deferred<void>();
    const server = http.createServer((_request, _response) =>
      entered.resolve(),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Expected TCP address');
    let active = 0;
    vi.spyOn(network, 'fetch').mockImplementation(async (input, init) => {
      active++;
      try {
        return await nativeFetch(input, init);
      } finally {
        active--;
      }
    });
    const controller = new AbortController();
    const reason = new Error('native cancelled');
    const work = observe(
      MCPOAuthProvider.authenticate(
        {
          tokenStorage: new MCPOAuthTokenStorage(store),
          openBrowser,
        },
        'native',
        {},
        `http://127.0.0.1:${address.port}/mcp`,
        undefined,
        controller.signal,
      ),
    );
    await entered.promise;
    controller.abort(reason);
    expect(await work.result).toBe(reason);
    expect(active).toBe(0);
    expect(browserStarts).toBe(0);
    expect(writes).toStrictEqual([]);
  });

  it('cancels the callback wait and closes its listener', async () => {
    const controller = new AbortController();
    const display = authorization();
    const work = observe(
      MCPOAuthProvider.authenticate(
        {
          tokenStorage: new MCPOAuthTokenStorage(store),
          openBrowser,
        },
        'waiting',
        { ...config },
        undefined,
        display.events,
        controller.signal,
      ),
    );
    await display.url;
    await turn();
    const reason = new Error('cancel callback');
    controller.abort(reason);
    expect(await work.result).toBe(reason);
    expect(writes).toStrictEqual([]);
    expectClosed();
  });

  it('does not open a browser if the manual display cancels synchronously', async () => {
    const controller = new AbortController();
    const reason = new Error('display cancelled');
    const display = authorization();
    display.events.on(OAUTH_DISPLAY_MESSAGE_EVENT, () =>
      controller.abort(reason),
    );
    const work = observe(
      MCPOAuthProvider.authenticate(
        {
          tokenStorage: new MCPOAuthTokenStorage(store),
          openBrowser,
        },
        'display',
        { ...config },
        undefined,
        display.events,
        controller.signal,
      ),
    );
    expect(await work.result).toBe(reason);
    expect(browserStarts).toBe(0);
    expectClosed();
  });

  it('joins a pending browser operation and does not swallow abort as manual fallback', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const controller = new AbortController();
    const reason = new Error('browser cancelled');
    openBrowser = async (): Promise<void> => {
      entered.resolve();
      await release.promise;
      throw new Error('late browser failure');
    };
    const work = observe(
      MCPOAuthProvider.authenticate(
        {
          tokenStorage: new MCPOAuthTokenStorage(store),
          openBrowser,
        },
        'browser',
        { ...config },
        undefined,
        authorization().events,
        controller.signal,
      ),
    );
    await entered.promise;
    controller.abort(reason);
    await turn();
    const pending = !work.settled();
    release.resolve();
    expect(await work.result).toBe(reason);
    expect(pending).toBe(true);
    expect(writes).toStrictEqual([]);
    expectClosed();
  });

  for (const phase of ['write', 'verify'] as const) {
    it(`joins non-abortable storage ${phase} and never reports success`, async () => {
      const entered = deferred<void>();
      const release = deferred<void>();
      const controller = new AbortController();
      const reason = new Error('storage cancelled');
      const method = phase === 'write' ? 'setCredentials' : 'getCredentials';
      if (method === 'setCredentials')
        vi.spyOn(store, method).mockImplementation(async (value) => {
          entered.resolve();
          await release.promise;
          writes = [...writes, value];
        });
      else
        vi.spyOn(store, method).mockImplementation(async () => {
          entered.resolve();
          await release.promise;
          return writes[0] ?? null;
        });
      vi.spyOn(network, 'fetch').mockImplementation(async () =>
        Response.json({ access_token: 'accepted', token_type: 'Bearer' }),
      );
      const display = authorization();
      const work = observe(
        MCPOAuthProvider.authenticate(
          {
            tokenStorage: new MCPOAuthTokenStorage(store),
            openBrowser,
          },
          'storage',
          { ...config },
          undefined,
          display.events,
          controller.signal,
        ),
      );
      await callback(await display.url);
      await entered.promise;
      controller.abort(reason);
      await turn();
      const pending = !work.settled();
      release.resolve();
      expect(await work.result).toBe(reason);
      expect(pending).toBe(true);
      expect(writes.length).toBe(1);
      expect(reads).toBe(0);
      expectClosed();
    });
  }

  it('joins listener startup when aborted before the listening notification', async () => {
    const controller = new AbortController();
    const reason = new Error('cancel startup');
    beforeListening = () => controller.abort(reason);
    const display = authorization();
    const work = observe(
      MCPOAuthProvider.authenticate(
        {
          tokenStorage: new MCPOAuthTokenStorage(store),
          openBrowser,
        },
        'startup',
        { ...config },
        undefined,
        display.events,
        controller.signal,
      ),
    );
    expect(await work.result).toBe(reason);
    expect(servers.length).toBe(1);
    expect(display.messages()).toStrictEqual([]);
    expect(browserStarts).toBe(0);
    expect(writes).toStrictEqual([]);
    expect(getEventListeners(controller.signal, 'abort')).toStrictEqual([]);
    expectClosed();
  });

  for (const phase of ['registration', 'metadata', 'token'] as const) {
    it(`joins an abort-ignoring ${phase} response body before rejecting`, async () => {
      const controller = new AbortController();
      const reason = new Error('cancel body');
      const entered = deferred<void>();
      const release = deferred<void>();
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(stream): Promise<void> {
            entered.resolve();
            await release.promise;
            stream.enqueue(
              new TextEncoder().encode(
                JSON.stringify({
                  client_id: 'late-client',
                  access_token: 'late-token',
                  token_type: 'Bearer',
                }),
              ),
            );
            stream.close();
          },
        },
        { highWaterMark: 0 },
      );
      vi.spyOn(network, 'fetch').mockImplementation(
        async () =>
          new Response(body, {
            headers: { 'content-type': 'application/json' },
          }),
      );
      const registrationConfig = {
        authorizationUrl: config.authorizationUrl,
        tokenUrl: config.tokenUrl,
        ...(phase === 'registration'
          ? { registrationUrl: 'https://same.invalid/register' }
          : {}),
      };
      const display = authorization();
      const work = observe(
        MCPOAuthProvider.authenticate(
          {
            tokenStorage: new MCPOAuthTokenStorage(store),
            openBrowser,
          },
          'body',
          phase === 'token' ? { ...config } : registrationConfig,
          undefined,
          display.events,
          controller.signal,
        ),
      );
      if (phase === 'token') await callback(await display.url);
      await entered.promise;
      controller.abort(reason);
      await turn();
      const pending = !work.settled();
      release.resolve();
      expect(await work.result).toBe(reason);
      expect(pending).toBe(true);
      expect(writes).toStrictEqual([]);
      expect(display.messages().length).toBe(phase === 'token' ? 1 : 0);
      expect(getEventListeners(controller.signal, 'abort')).toStrictEqual([]);
      expectClosed();
    });
  }

  it('joins a transport rejection after abort and preserves the abort reason', async () => {
    const controller = new AbortController();
    const reason = new Error('cancel transport');
    const entered = deferred<void>();
    const release = deferred<void>();
    vi.spyOn(network, 'fetch').mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      throw new Error('late transport failure');
    });
    const display = authorization();
    const work = observe(
      MCPOAuthProvider.authenticate(
        {
          tokenStorage: new MCPOAuthTokenStorage(store),
          openBrowser,
        },
        'transport',
        {
          authorizationUrl: config.authorizationUrl,
          registrationUrl: 'https://same.invalid/register',
        },
        undefined,
        display.events,
        controller.signal,
      ),
    );
    await entered.promise;
    controller.abort(reason);
    await turn();
    const pending = !work.settled();
    release.resolve();
    expect(await work.result).toBe(reason);
    expect(pending).toBe(true);
    expect(display.messages()).toStrictEqual([]);
    expectClosed();
  });

  it('isolates simultaneous registration signals even with the same input object', async () => {
    const a = new AbortController();
    const b = new AbortController();
    const reason = new Error('cancel registration A');
    const enteredA = deferred<void>();
    const enteredB = deferred<void>();
    const releaseA = deferred<void>();
    const releaseB = deferred<void>();
    const shared: MCPOAuthConfig = {
      authorizationUrl: config.authorizationUrl,
      tokenUrl: config.tokenUrl,
      registrationUrl: 'https://same.invalid/register',
    };
    vi.spyOn(network, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) === shared.registrationUrl) {
        const isA = init?.signal === a.signal;
        const entered = isA ? enteredA : enteredB;
        const release = isA ? releaseA : releaseB;
        entered.resolve();
        await release.promise;
        return Response.json({ client_id: isA ? 'client-a' : 'client-b' });
      }
      return Response.json({ access_token: 'token-b', token_type: 'Bearer' });
    });
    const displayA = authorization();
    const displayB = authorization();
    const resultA = observe(
      MCPOAuthProvider.authenticate(
        {
          tokenStorage: new MCPOAuthTokenStorage(store),
          openBrowser,
        },
        'same-registration',
        shared,
        'https://same.invalid/mcp',
        displayA.events,
        a.signal,
      ),
    );
    const resultB = observe(
      MCPOAuthProvider.authenticate(
        {
          tokenStorage: new MCPOAuthTokenStorage(store),
          openBrowser,
        },
        'same-registration',
        shared,
        'https://same.invalid/mcp',
        displayB.events,
        b.signal,
      ),
    );
    await Promise.all([enteredA.promise, enteredB.promise]);
    a.abort(reason);
    await turn();
    const bothPending = !resultA.settled() && !resultB.settled();
    releaseA.resolve();
    expect(await resultA.result).toBe(reason);
    expect(bothPending).toBe(true);
    releaseB.resolve();
    const urlB = await displayB.url;
    expect(urlB.searchParams.get('client_id')).toBe('client-b');
    await callback(urlB);
    expect(await resultB.result).toMatchObject({ accessToken: 'token-b' });
    expect(shared.clientId).toBeUndefined();
    expect(displayA.messages()).toStrictEqual([]);
    expect(writes.map((value) => value.clientId)).toStrictEqual(['client-b']);
    expect(getEventListeners(a.signal, 'abort')).toStrictEqual([]);
    expect(getEventListeners(b.signal, 'abort')).toStrictEqual([]);
    expectClosed();
  });

  it('keeps identical server-name and URL request B alive when A is aborted', async () => {
    const a = new AbortController();
    const b = new AbortController();
    const reason = new Error('only A');
    vi.spyOn(network, 'fetch').mockImplementation(async () =>
      Response.json({ access_token: 'request-b-token', token_type: 'Bearer' }),
    );
    const displayA = authorization();
    const displayB = authorization();
    const shared = { ...config };
    const resultA = observe(
      MCPOAuthProvider.authenticate(
        {
          tokenStorage: new MCPOAuthTokenStorage(store),
          openBrowser,
        },
        'identical',
        shared,
        'https://same.invalid/mcp',
        displayA.events,
        a.signal,
      ),
    );
    const resultB = observe(
      MCPOAuthProvider.authenticate(
        {
          tokenStorage: new MCPOAuthTokenStorage(store),
          openBrowser,
        },
        'identical',
        shared,
        'https://same.invalid/mcp',
        displayB.events,
        b.signal,
      ),
    );
    await displayA.url;
    const urlB = await displayB.url;
    a.abort(reason);
    expect(await resultA.result).toBe(reason);
    expect(b.signal.aborted).toBe(false);
    await callback(urlB);
    expect(await resultB.result).toMatchObject({
      accessToken: 'request-b-token',
    });
    expect(writes.map((value) => value.token.accessToken)).toStrictEqual([
      'request-b-token',
    ]);
    expectClosed();
  });
});
