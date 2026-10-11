/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTestOAuthCapabilities } from './test-support/index.js';

import * as http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MCPOAuthTokenStorage } from '../auth/index.js';
import { FileTokenStorage } from '../auth/token-storage/file-token-storage.js';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import {
  bindMcpOAuthCapabilities,
  handleAutomaticOAuth,
  McpOAuthOperations,
} from './mcp-oauth-helpers.js';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const network: {
  fetch: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
} = globalThis;
const config = { url: 'https://same.invalid/mcp' };
const header = 'resource_metadata="https://same.invalid/resource"';

describe('automatic OAuth owner lifetime', () => {
  afterEach(() => vi.restoreAllMocks());
  it('deduplicates within A, lets identical B finish, and joins A cancellation', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let requests = 0;
    let signalA: AbortSignal | null | undefined;
    vi.spyOn(network, 'fetch').mockImplementation(async (_input, init) => {
      requests++;
      if (requests === 1) {
        signalA = init?.signal;
        entered.resolve();
        await release.promise;
      }
      return new Response(null, { status: 404 });
    });
    const controller = new AbortController();
    const a = new McpOAuthOperations(createTestOAuthCapabilities());
    const b = new McpOAuthOperations(createTestOAuthCapabilities());
    const reason = new Error('only A');
    const first = handleAutomaticOAuth(
      'same',
      config,
      header,
      a,
      controller.signal,
    ).catch((e: unknown) => e);
    await entered.promise;
    const duplicate = handleAutomaticOAuth(
      'same',
      config,
      header,
      a,
      controller.signal,
    ).catch((e: unknown) => e);
    expect(await handleAutomaticOAuth('same', config, header, b)).toBe(false);
    const beforeAbort = requests;
    controller.abort(reason);
    let joined = false;
    const joining = a.cancelAndJoin().then(() => {
      joined = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(signalA?.aborted).toBe(true);
    expect(joined).toBe(false);
    release.resolve();
    expect(await first).toBe(reason);
    expect(await duplicate).toBe(reason);
    await joining;
    expect(requests).toBe(beforeAbort);
  });

  it('returns the original pre-abort reason without starting discovery', async () => {
    const controller = new AbortController();
    const reason = new Error('already cancelled');
    controller.abort(reason);
    let requests = 0;
    vi.spyOn(network, 'fetch').mockImplementation(async () => {
      requests++;
      return new Response(null, { status: 404 });
    });
    expect(
      await handleAutomaticOAuth(
        'same',
        config,
        header,
        new McpOAuthOperations(createTestOAuthCapabilities()),
        controller.signal,
      ).catch((error: unknown) => error),
    ).toBe(reason);
    expect(requests).toBe(0);
  });

  it('keeps caller cancellation identity when the deadline passes during joining', async () => {
    vi.useFakeTimers();
    const entered = deferred<void>();
    const release = deferred<void>();
    const controller = new AbortController();
    const reason = new Error('caller cancelled first');
    vi.spyOn(network, 'fetch').mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      return new Response(null, { status: 404 });
    });
    const owner = new McpOAuthOperations(createTestOAuthCapabilities(), 20);
    const result = handleAutomaticOAuth(
      'same',
      config,
      header,
      owner,
      controller.signal,
    ).catch((error: unknown) => error);
    try {
      await entered.promise;
      controller.abort(reason);
      vi.advanceTimersByTime(20);
      release.resolve();
      expect(await result).toBe(reason);
    } finally {
      release.resolve();
      await owner.cancelAndJoin();
      vi.useRealTimers();
    }
  });

  it('timeout aborts discovery but retains the dedup entry until actual settlement', async () => {
    const entered = deferred<void>();
    const aborted = deferred<void>();
    const release = deferred<void>();
    let requests = 0;
    vi.spyOn(network, 'fetch').mockImplementation(async (_input, init) => {
      requests++;
      init?.signal?.addEventListener('abort', () => aborted.resolve(), {
        once: true,
      });
      entered.resolve();
      await release.promise;
      return new Response(null, { status: 404 });
    });
    const owner = new McpOAuthOperations(createTestOAuthCapabilities(), 20);
    let settled = false;
    const work = handleAutomaticOAuth('same', config, header, owner).then(
      (value) => {
        settled = true;
        return value;
      },
    );
    await entered.promise;
    await aborted.promise;
    const duplicate = handleAutomaticOAuth('same', config, header, owner);
    expect(settled).toBe(false);
    expect(requests).toBe(1);
    release.resolve();
    expect(await work).toBe(false);
    expect(await duplicate).toBe(false);
  });
});

describe('automatic helper with real browser callback and token persistence', () => {
  afterEach(() => vi.restoreAllMocks());
  it('joins cancelled registration A while same-name/URL B authenticates once', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-owner-'));
    const store = new FileTokenStorage('owner-b', {
      tokenFilePath: join(directory, 'b.json'),
      machineSecretLoader: async () => Buffer.alloc(32, 7),
    });
    const storeA = new FileTokenStorage('owner-a', {
      tokenFilePath: join(directory, 'a.json'),
      machineSecretLoader: async () => Buffer.alloc(32, 8),
    });
    const entered = deferred<void>();
    const release = deferred<void>();
    const controller = new AbortController();
    const reason = new Error('registration A cancelled');
    const nativeFetch = globalThis.fetch;
    const listen = http.Server.prototype.listen;
    const servers: http.Server[] = [];
    vi.spyOn(http.Server.prototype, 'listen').mockImplementation(function (
      this: http.Server,
      ...args: unknown[]
    ): http.Server {
      servers.push(this);
      const callback = args.find((arg) => typeof arg === 'function');
      return listen.call(this, { port: 0, host: '127.0.0.1' }, () => {
        if (typeof callback === 'function') callback();
      });
    });
    let registrations = 0;
    let browsers = 0;
    let exchanges = 0;
    let signalA: AbortSignal | null | undefined;
    vi.spyOn(network, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('oauth-protected-resource'))
        return new Response(null, { status: 404 });
      if (url.includes('.well-known/'))
        return Response.json({
          issuer: 'https://same.invalid',
          authorization_endpoint: 'https://same.invalid/authorize',
          token_endpoint: 'https://same.invalid/token',
          registration_endpoint: 'https://same.invalid/register',
        });
      if (url.endsWith('/register')) {
        registrations++;
        if (registrations === 1) {
          signalA = init?.signal;
          entered.resolve();
          await release.promise;
        }
        return Response.json({ client_id: 'registered-client' });
      }
      if (url.endsWith('/token')) {
        exchanges++;
        return Response.json({
          access_token: 'B-token',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      throw new Error(`Unexpected external request ${url}`);
    });
    const openBrowser = async (value: string): Promise<void> => {
      browsers++;
      const url = new URL(value);
      const callback = new URL(url.searchParams.get('redirect_uri')!);
      callback.hostname = '127.0.0.1';
      callback.searchParams.set('state', url.searchParams.get('state')!);
      callback.searchParams.set('code', 'B-code');
      const response = await nativeFetch(callback);
      expect(response.status).toBe(200);
      await response.text();
    };
    let browsersA = 0;
    const a = new McpOAuthOperations(
      bindMcpOAuthCapabilities({
        tokenStorage: new MCPOAuthTokenStorage(storeA),
        openBrowser: async (url) => {
          browsersA++;
          await openBrowser(url);
        },
      }),
    );
    const b = new McpOAuthOperations(
      bindMcpOAuthCapabilities({
        tokenStorage: new MCPOAuthTokenStorage(store),
        openBrowser,
      }),
    );
    const workA = handleAutomaticOAuth(
      'same',
      config,
      header,
      a,
      controller.signal,
    ).catch((e: unknown) => e);
    try {
      await entered.promise;
      const duplicate = handleAutomaticOAuth(
        'same',
        config,
        header,
        a,
        controller.signal,
      ).catch((e: unknown) => e);
      const workB = handleAutomaticOAuth('same', config, header, b);
      controller.abort(reason);
      let joined = false;
      const joining = a.cancelAndJoin().then(() => {
        joined = true;
      });
      expect(await workB).toBe(true);
      expect(joined).toBe(false);
      expect(signalA?.aborted).toBe(true);
      expect(registrations).toBe(2);
      expect(browsers).toBe(1);
      expect(browsersA).toBe(0);
      expect(await storeA.getCredentials('same')).toBeNull();
      expect(exchanges).toBe(1);
      release.resolve();
      expect(await workA).toBe(reason);
      expect(await duplicate).toBe(reason);
      await joining;
      expect((await store.getCredentials('same'))?.token.accessToken).toBe(
        'B-token',
      );
      expect(servers.every((server) => !server.listening)).toBe(true);
      expect(browsers).toBe(1);
      expect(browsersA).toBe(0);
      expect(await storeA.getCredentials('same')).toBeNull();
    } finally {
      controller.abort();
      release.resolve();
      await Promise.all([a.cancelAndJoin(), b.cancelAndJoin(), workA]);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
