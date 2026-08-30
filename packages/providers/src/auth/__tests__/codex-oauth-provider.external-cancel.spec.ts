/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { waitFor } from '@vybestack/llxprt-code-test-utils';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'bun:test';
import type { CodexOAuthToken, TokenStore } from '@vybestack/llxprt-code-auth';
import type { LocalOAuthCallbackOptions } from '../local-oauth-callback.js';

void vi.mock(
  '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js',
  () => ({
    openBrowserSecurely: vi.fn().mockResolvedValue(undefined),
    shouldLaunchBrowser: vi.fn().mockReturnValue(true),
  }),
);

void vi.mock('../local-oauth-callback.js', () => ({
  startLocalOAuthCallback: vi.fn(),
}));

import {
  openBrowserSecurely,
  shouldLaunchBrowser,
} from '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js';
import { CodexOAuthProvider } from '../codex-oauth-provider.js';
import { ClipboardService } from '../ClipboardService.js';
import { startLocalOAuthCallback } from '../local-oauth-callback.js';

const openBrowserMock = openBrowserSecurely as Mock<typeof openBrowserSecurely>;
const shouldLaunchBrowserMock = shouldLaunchBrowser as Mock<
  typeof shouldLaunchBrowser
>;
const startLocalOAuthCallbackMock = startLocalOAuthCallback as Mock<
  typeof startLocalOAuthCallback
>;

const BROWSER_TOKEN: CodexOAuthToken = {
  access_token: 'browser-access',
  refresh_token: 'browser-refresh',
  token_type: 'Bearer',
  expiry: 2_000_000_000,
  account_id: 'browser-account',
};

const DEVICE_TOKEN: CodexOAuthToken = {
  access_token: 'device-access',
  refresh_token: 'device-refresh',
  token_type: 'Bearer',
  expiry: 2_000_000_000,
  account_id: 'device-account',
};

function createTokenStore(): TokenStore {
  return {
    saveToken: async () => {},
    getToken: async () => null,
    removeToken: async () => {},
    listProviders: async () => [],
    listBuckets: async () => [],
    getBucketStats: async () => null,
    acquireRefreshLock: async () => true,
    releaseRefreshLock: async () => {},
    acquireAuthLock: async () => true,
    releaseAuthLock: async () => {},
  };
}

function installDeviceFlow(
  provider: CodexOAuthProvider,
  onDeviceStart: () => void,
): void {
  Reflect.set(provider, 'deviceFlow', {
    buildAuthorizationUrl: (_redirectUri: string, state: string) =>
      `https://auth.openai.test/authorize?state=${state}`,
    exchangeCodeForToken: async () => BROWSER_TOKEN,
    requestDeviceCode: async () => {
      onDeviceStart();
      return {
        device_auth_id: 'device-auth-id',
        user_code: 'DEVICE-CODE',
        interval: 1,
      };
    },
    pollForDeviceToken: async () => ({
      authorization_code: 'device-authorization-code',
      code_verifier: 'device-code-verifier',
      code_challenge: 'device-code-challenge',
    }),
    completeDeviceAuth: async () => DEVICE_TOKEN,
    refreshToken: async () => null,
  });
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => {
    throw new Error('Deferred promise was not initialized');
  };
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

type AuthSettlement =
  | { readonly status: 'resolved' }
  | { readonly status: 'rejected'; readonly reason: unknown }
  | { readonly status: 'pending' };

async function observeSettlement(
  authentication: Promise<unknown>,
): Promise<AuthSettlement> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Promise<AuthSettlement>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'pending' }), 100);
  });
  const settled = authentication.then<AuthSettlement, AuthSettlement>(
    () => ({ status: 'resolved' }),
    (reason: unknown) => ({ status: 'rejected', reason }),
  );
  const outcome = await Promise.race([settled, pending]);
  if (timer !== undefined) {
    clearTimeout(timer);
  }
  return outcome;
}

/**
 * @plan PLAN-20260827-ISSUE2562.P02
 * @requirement REQ-2562-2
 */
describe('CodexOAuthProvider external cancellation', () => {
  let provider: CodexOAuthProvider;
  let deviceStarts: number;

  beforeEach(() => {
    vi.clearAllMocks();
    shouldLaunchBrowserMock.mockReturnValue(true);
    openBrowserMock.mockResolvedValue(undefined);
    vi.spyOn(ClipboardService, 'copyToClipboard').mockResolvedValue(undefined);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    provider = new CodexOAuthProvider(createTokenStore());
    deviceStarts = 0;
    installDeviceFlow(provider, () => {
      deviceStarts += 1;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects an already-aborted signal before starting authentication infrastructure', async () => {
    let callbackStarts = 0;
    let browserStarts = 0;
    startLocalOAuthCallbackMock.mockImplementation(async () => {
      callbackStarts += 1;
      throw new Error('callback should not start');
    });
    openBrowserMock.mockImplementation(async () => {
      browserStarts += 1;
    });
    const controller = new AbortController();
    const cancellation = new DOMException('host cancelled auth', 'AbortError');
    controller.abort(cancellation);

    const authentication = provider.initiateAuth(controller.signal);

    await expect(authentication).rejects.toBe(cancellation);
    expect({ callbackStarts, browserStarts, deviceStarts }).toStrictEqual({
      callbackStarts: 0,
      browserStarts: 0,
      deviceStarts: 0,
    });
  });

  it('settles a mid-flight abort and starts a fresh flow on retry', async () => {
    const firstCallback = createDeferred<{
      code: string;
      state: string;
    }>();
    let firstState = '';
    let callbackStarts = 0;
    let callbackWaits = 0;
    let shutdowns = 0;
    startLocalOAuthCallbackMock.mockImplementation(
      async (options: LocalOAuthCallbackOptions) => {
        callbackStarts += 1;
        let closed = false;
        const shutdown = async (): Promise<void> => {
          if (closed) {
            return;
          }
          closed = true;
          shutdowns += 1;
        };
        if (callbackStarts === 1) {
          firstState = options.state;
          options.signal?.addEventListener('abort', () => void shutdown(), {
            once: true,
          });
          return {
            redirectUri: 'http://127.0.0.1:1455/callback',
            waitForCallback: () => {
              callbackWaits += 1;
              return firstCallback.promise;
            },
            shutdown,
          };
        }
        return {
          redirectUri: 'http://127.0.0.1:1455/callback',
          waitForCallback: async () => ({
            code: 'retry-code',
            state: options.state,
          }),
          shutdown,
        };
      },
    );
    const controller = new AbortController();
    const cancellation = new DOMException('host cancelled auth', 'AbortError');
    const authentication = provider.initiateAuth(controller.signal);
    while (callbackWaits === 0) {
      await Promise.resolve();
    }

    controller.abort(cancellation);
    const outcome = await observeSettlement(authentication);
    if (outcome.status === 'pending') {
      firstCallback.resolve({ code: 'late-code', state: firstState });
      await authentication.catch(() => undefined);
    }

    expect(outcome).toStrictEqual({ status: 'rejected', reason: cancellation });
    await expect(provider.initiateAuth()).resolves.toStrictEqual(BROWSER_TOKEN);
    await waitFor(() => expect(shutdowns).toBe(2));
    expect(callbackStarts).toBe(2);
  });

  it('does not switch to device flow when cancellation races with browser failure', async () => {
    let shutdowns = 0;
    startLocalOAuthCallbackMock.mockImplementation(
      async (options: LocalOAuthCallbackOptions) => ({
        redirectUri: 'http://127.0.0.1:1455/callback',
        waitForCallback: async () => ({
          code: 'unused-code',
          state: options.state,
        }),
        shutdown: async () => {
          shutdowns += 1;
        },
      }),
    );
    const controller = new AbortController();
    const cancellation = new DOMException('host cancelled auth', 'AbortError');
    openBrowserMock.mockImplementation(async () => {
      controller.abort(cancellation);
      throw new Error('browser launch failed');
    });

    const authentication = provider.initiateAuth(controller.signal);

    await expect(authentication).rejects.toBe(cancellation);
    expect({ deviceStarts, shutdowns }).toStrictEqual({
      deviceStarts: 0,
      shutdowns: 1,
    });
  });

  it('preserves device fallback for a genuine browser launch failure', async () => {
    let shutdowns = 0;
    startLocalOAuthCallbackMock.mockImplementation(async () => ({
      redirectUri: 'http://127.0.0.1:1455/callback',
      waitForCallback: async () => {
        throw new Error('callback should not be awaited');
      },
      shutdown: async () => {
        shutdowns += 1;
      },
    }));
    openBrowserMock.mockRejectedValue(new Error('browser unavailable'));

    const token = await provider.initiateAuth();

    expect(token).toStrictEqual(DEVICE_TOKEN);
    expect({ deviceStarts, shutdowns }).toStrictEqual({
      deviceStarts: 1,
      shutdowns: 1,
    });
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P04
   * @requirement REQ-2562-2
   */
  it('detaching one joined caller keeps the shared flow alive; the last departing caller aborts it', async () => {
    // Participant-counted ownership at the provider level: a signal-bearing
    // joiner detaches with its own reason while the shared browser flow
    // keeps running for the remaining caller; when the last participant
    // departs, its reason aborts the shared flow and tears down the
    // callback server. No second browser/callback is started for joins.
    const callback = createDeferred<{ code: string; state: string }>();
    let callbackStarts = 0;
    let shutdowns = 0;
    let aborted = false;
    const createShutdownCounter = (): (() => Promise<void>) => {
      let closed = false;
      return async () => {
        if (closed) {
          return;
        }
        closed = true;
        shutdowns += 1;
      };
    };
    startLocalOAuthCallbackMock.mockImplementation(
      async (options: LocalOAuthCallbackOptions) => {
        callbackStarts += 1;
        const shutdown = createShutdownCounter();
        options.signal?.addEventListener(
          'abort',
          () => {
            aborted = true;
            void shutdown();
          },
          { once: true },
        );
        return {
          redirectUri: 'http://127.0.0.1:1455/callback',
          waitForCallback: () => callback.promise,
          shutdown,
        };
      },
    );

    const ownerController = new AbortController();
    const owner = provider.initiateAuth(ownerController.signal);
    const joinerController = new AbortController();
    const joinerCancellation = new DOMException(
      'joiner cancelled auth',
      'AbortError',
    );
    const joiner = provider.initiateAuth(joinerController.signal);
    joinerController.abort(joinerCancellation);

    await expect(joiner).rejects.toBe(joinerCancellation);
    expect(callbackStarts).toBe(1);
    expect(aborted).toBe(false);
    expect(shutdowns).toBe(0);

    const ownerOutcome = await observeSettlement(owner);
    expect(ownerOutcome.status).toBe('pending');

    const ownerCancellation = new DOMException(
      'owner cancelled auth',
      'AbortError',
    );
    ownerController.abort(ownerCancellation);

    await expect(owner).rejects.toBe(ownerCancellation);
    expect(callbackStarts).toBe(1);
    await waitFor(() => expect(shutdowns).toBe(1));
    expect(aborted).toBe(true);
  });
});
