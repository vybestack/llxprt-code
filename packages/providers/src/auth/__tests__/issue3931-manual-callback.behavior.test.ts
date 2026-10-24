/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { withFetchPreconnect } from '../../../../test-utils/src/fetch-test-helpers.js';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { KeyringTokenStore, oauthUIBridge } from '@vybestack/llxprt-code-auth';
import * as browserLauncher from '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js';
import { AnthropicOAuthProvider } from '../anthropic-oauth-provider.js';
import { OAuthManager } from '../oauth-manager.js';
import { ClipboardService } from '../ClipboardService.js';
import * as callbackModule from '../local-oauth-callback.js';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
} {
  let resolveValue: (value: T) => void = () => {};
  let rejectValue: (reason: Error) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return { promise, resolve: resolveValue, reject: rejectValue };
}

const initialState: {
  __oauth_needs_code?: boolean;
  __oauth_provider?: string;
  __oauth_browser_auth_complete?: boolean;
  __oauth_auth_complete?: boolean;
  __oauth_auth_error?: string;
} = {};
const oauthState = Object.assign(globalThis, initialState);

const directories: string[] = [];
function harness(persistence?: {
  started: ReturnType<typeof deferred<void>>;
  save: ReturnType<typeof deferred<void>>;
}): {
  provider: AnthropicOAuthProvider;
  manager: OAuthManager;
  store: KeyringTokenStore;
  browserStarted: Promise<void>;
  browser: ReturnType<typeof deferred<void>>;
  callback: ReturnType<typeof deferred<{ code: string; state: string }>>;
  warnings: string[];
  warningReceived: Promise<void>;
} {
  const tempRoot = resolve(import.meta.dir, '../../../../../tmp');
  mkdirSync(tempRoot, { recursive: true });
  const lockDir = mkdtempSync(resolve(tempRoot, 'issue3931-oauth-'));
  directories.push(lockDir);
  const values = new Map<string, string>();
  const store = new KeyringTokenStore({
    lockDir,
    secureStore: {
      async get(key): Promise<string | null> {
        return values.get(key) ?? null;
      },
      async set(key, value): Promise<void> {
        if (persistence) {
          persistence.started.resolve();
          await persistence.save.promise;
        }
        values.set(key, value);
      },
      async delete(key): Promise<boolean> {
        return values.delete(key);
      },
      async list(): Promise<string[]> {
        return [...values.keys()];
      },
      async has(key): Promise<boolean> {
        return values.has(key);
      },
    },
  });
  const manager = new OAuthManager(store);
  const warnings: string[] = [];
  const warningReceived = deferred<void>();
  const provider = new AnthropicOAuthProvider(store, (event) => {
    if (event.type === 'warning') {
      warnings.push(event.text);
      warningReceived.resolve();
    }
    return undefined;
  });
  manager.registerProvider(provider);
  const callback = deferred<{ code: string; state: string }>();
  vi.spyOn(callbackModule, 'startLocalOAuthCallback').mockResolvedValue({
    redirectUri: 'http://localhost:8766/callback',
    waitForCallback: () => callback.promise,
    async shutdown(): Promise<void> {
      callback.reject(new Error('Callback closed'));
    },
  });
  vi.spyOn(ClipboardService, 'copyToClipboard').mockResolvedValue();
  vi.spyOn(browserLauncher, 'shouldLaunchBrowser').mockReturnValue(true);
  const browser = deferred<void>();
  const started = deferred<void>();
  vi.spyOn(browserLauncher, 'openBrowserSecurely').mockImplementation(() => {
    started.resolve();
    return browser.promise;
  });
  return {
    provider,
    manager,
    store,
    browserStarted: started.promise,
    browser,
    callback,
    warnings,
    warningReceived: warningReceived.promise,
  };
}

function interceptExchange(): string[] {
  const requests: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    withFetchPreconnect(async (_input, init) => {
      requests.push(String(init?.body));
      return new Response(
        JSON.stringify({
          access_token: 'synthetic-session-token',
          expires_in: 3600,
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }),
  );
  return requests;
}

function redirect(body: string | undefined): unknown {
  const parsed: unknown = JSON.parse(body ?? '{}');
  return typeof parsed === 'object' &&
    parsed !== null &&
    'redirect_uri' in parsed
    ? parsed.redirect_uri
    : undefined;
}

describe('Issue 3931 real OAuth provider and persistence lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    oauthState.__oauth_needs_code = undefined;
    oauthState.__oauth_provider = undefined;
    const attempt = oauthUIBridge.getDialog();
    if (attempt) oauthUIBridge.dismissDialog(attempt.id);
    oauthState.__oauth_browser_auth_complete = undefined;
    oauthState.__oauth_auth_complete = undefined;
    oauthState.__oauth_auth_error = undefined;
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  it.each(['success', 'failure'])(
    'keeps joined manual authentication live after background caller cancellation until shared %s',
    async (outcome) => {
      const h = harness();
      interceptExchange();
      if (outcome === 'failure') {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          new Response('Rejected', { status: 400 }),
        );
      }
      const controller = new AbortController();
      const background = h.manager.authenticate('claudecode', undefined, {
        signal: controller.signal,
      });
      const backgroundResult = background.catch((error: unknown) => error);
      await h.browserStarted;
      const manual = h.manager.authenticate('claudecode', undefined, {
        signalAuthCompletion: true,
      });
      const manualResult = manual.then(
        () => 'success',
        () => 'failure',
      );
      try {
        const cancellation = new Error('Background caller departed');
        controller.abort(cancellation);
        expect(await backgroundResult).toBe(cancellation);
        expect({
          error: oauthState.__oauth_auth_error,
          complete: oauthState.__oauth_auth_complete,
          needsCode: oauthState.__oauth_needs_code,
        }).toStrictEqual({
          error: undefined,
          complete: false,
          needsCode: true,
        });
        expect(await h.store.getToken('claudecode')).toBeNull();

        h.provider.submitAuthCode('joined-manual-code');
        expect(await manualResult).toBe(outcome);
        expect((await h.store.getToken('claudecode')) !== null).toBe(
          outcome === 'success',
        );
        expect(oauthState.__oauth_auth_complete).toBe(outcome === 'success');
        expect(oauthState.__oauth_auth_error !== undefined).toBe(
          outcome === 'failure',
        );
        expect(oauthState.__oauth_auth_error ?? '').not.toContain('departed');
      } finally {
        h.browser.resolve();
        h.provider.cancelAuth();
        await Promise.all([backgroundResult, manualResult]);
      }
    },
  );

  it('accepts manual input while browser launch is pending and preserves the displayed redirect', async () => {
    const h = harness();
    const requests = interceptExchange();
    const login = h.manager.authenticate('claudecode', undefined, {
      signalAuthCompletion: true,
    });
    await h.browserStarted;
    try {
      expect(oauthState.__oauth_needs_code).toBeTruthy();
      h.provider.submitAuthCode('manual-code');
      await login;
      expect(redirect(requests[0])).toBe(
        'https://console.anthropic.com/oauth/code/callback',
      );
      expect((await h.store.getToken('claudecode'))?.access_token).toContain(
        'session-token',
      );
    } finally {
      h.browser.reject(new Error('Browser unavailable'));
      h.provider.cancelAuth();
      h.callback.reject(new Error('Test finished'));
      await login.catch(() => undefined);
    }
  });

  it('shows actionable manual guidance when the browser fails and persists manual credentials', async () => {
    const h = harness();
    const requests = interceptExchange();
    const login = h.manager.authenticate('claudecode', undefined, {
      signalAuthCompletion: true,
    });
    await h.browserStarted;
    try {
      h.browser.reject(new Error('Browser unavailable'));
      await h.warningReceived;
      expect(h.warnings.join(' ')).toContain('manually and paste the code');
      h.provider.submitAuthCode('manual-after-browser-failure');
      await login;
      expect(redirect(requests[0])).toBe(
        'https://console.anthropic.com/oauth/code/callback',
      );
      expect(oauthState.__oauth_auth_complete).toBeTruthy();
    } finally {
      h.provider.cancelAuth();
      await login.catch(() => undefined);
    }
  });

  it('allows manual login when browser launching is suppressed', async () => {
    const h = harness();
    const requests = interceptExchange();
    vi.spyOn(browserLauncher, 'shouldLaunchBrowser').mockReturnValue(false);
    const urls: string[] = [];
    h.provider.setAddItem((event) => {
      if (event.type === 'oauth_url') {
        urls.push(event.url);
        h.provider.submitAuthCode('suppressed-browser-code');
      }
      return undefined;
    });
    await h.manager.authenticate('claudecode', undefined, {
      signalAuthCompletion: true,
    });
    expect(urls).toHaveLength(1);
    expect(redirect(requests[0])).toBe(
      new URL(urls[0] ?? '').searchParams.get('redirect_uri'),
    );
    expect(oauthState.__oauth_auth_complete).toBeTruthy();
  });

  it.each(['success', 'failure'])(
    'reports completion only after a %s persistence outcome',
    async (outcome) => {
      const saveStarted = deferred<void>();
      const save = deferred<void>();
      const h = harness({ started: saveStarted, save });
      interceptExchange();
      const login = h.manager.authenticate('claudecode', undefined, {
        signalAuthCompletion: true,
      });
      const result = login.then(
        () => 'success',
        () => 'failure',
      );
      await h.browserStarted;
      h.browser.resolve();
      h.callback.resolve({ code: 'callback-code', state: 'callback-state' });
      await saveStarted.promise;
      const beforeSave = {
        dialog: oauthUIBridge.getDialog()?.status,
        complete: oauthState.__oauth_auth_complete === true,
        token: await h.store.getToken('claudecode'),
      };
      if (outcome === 'success') save.resolve();
      else save.reject(new Error('Synthetic storage failure'));
      expect(await result).toBe(outcome);
      expect(beforeSave).toStrictEqual({
        dialog: 'pending',
        complete: false,
        token: null,
      });
      expect(oauthState.__oauth_auth_complete === true).toBe(
        outcome === 'success',
      );
      expect(oauthUIBridge.getDialog()?.status).toBe(
        outcome === 'success' ? 'succeeded' : 'failed',
      );
      expect((await h.store.getToken('claudecode')) !== null).toBe(
        outcome === 'success',
      );
      expect(oauthState.__oauth_needs_code).toBe(false);
      expect(oauthState.__oauth_auth_error !== undefined).toBe(
        outcome === 'failure',
      );
    },
  );

  it('cleans up the losing manual dialog and timeout after exchange failure, then permits retry', async () => {
    vi.useFakeTimers();
    const h = harness();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Rejected', { status: 400 }),
    );
    const login = h.manager.authenticate('claudecode');
    const result = login.then(
      () => 'success',
      () => 'failure',
    );
    await h.browserStarted;
    h.browser.resolve();
    h.callback.resolve({ code: 'bad-code', state: 'state' });
    expect(await result).toBe('failure');
    expect(vi.getTimerCount()).toBe(0);
    expect(oauthState.__oauth_needs_code).toBe(false);
    expect(await h.store.getToken('claudecode')).toBeNull();
    // A new public waiter must replace a cancelled dialog, never the old pending one.
    const requests = interceptExchange();
    vi.spyOn(callbackModule, 'startLocalOAuthCallback').mockResolvedValue({
      redirectUri: 'http://localhost:8766/callback',
      async waitForCallback() {
        return { code: 'retry-code', state: 'retry-state' };
      },
      async shutdown(): Promise<void> {},
    });
    await h.manager.authenticate('claudecode', undefined, {
      signalAuthCompletion: true,
    });
    expect(redirect(requests[0])).toBe('http://localhost:8766/callback');
    expect(oauthState.__oauth_auth_complete).toBeTruthy();
    expect(await h.store.getToken('claudecode')).not.toBeNull();
  });
});
