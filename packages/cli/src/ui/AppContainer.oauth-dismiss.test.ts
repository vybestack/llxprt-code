import { withFetchPreconnect } from '../../../test-utils/src/fetch-test-helpers.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import React, { act, useState, useSyncExternalStore } from 'react';
import { Text } from 'ink';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { KeyringTokenStore, oauthUIBridge } from '@vybestack/llxprt-code-auth';
import {
  OAuthManager,
  interactiveAuthCoordinator,
} from '@vybestack/llxprt-code-providers/auth.js';
import { AnthropicOAuthProvider } from '../../../providers/src/auth/anthropic-oauth-provider.js';
import * as browser from '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js';
import * as callbackModule from '../../../providers/src/auth/local-oauth-callback.js';
import { ClipboardService } from '../../../providers/src/auth/ClipboardService.js';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { renderWithProviders, waitFor } from '../__tests__/render.js';
import { useUpdateAndOAuthBridges } from './containers/AppContainer/hooks/useUpdateAndOAuthBridges.js';
import { useOAuthOrchestration } from './hooks/useOAuthOrchestration.js';
import { OAuthCodeDialog } from './components/OAuthCodeDialog.js';
import {
  createDialogStore,
  selectDialogOpen,
} from './stores/dialog/dialogStore.js';
import { createDialogOpeners } from './stores/dialog/dialogOpeners.js';
import { getOAuthGlobalState } from './oauthGlobalState.js';
import type { HistoryItemWithoutId } from './types.js';
import { Colors } from './colors.js';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolveValue: (value: T) => void = () => {};
  let rejectValue: (error: Error) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return { promise, resolve: resolveValue, reject: rejectValue };
}

const fixtureRoot = resolve(
  import.meta.dir,
  '../../../../tmp/issue3931-lazy-auth',
);
const directories: string[] = [];
function harness(): {
  manager: OAuthManager;
  store: KeyringTokenStore;
  callback: ReturnType<typeof deferred<{ code: string; state: string }>>;
  ready: Promise<void>;
  saveStarted: Promise<void>;
  save: ReturnType<typeof deferred<void>>;
  ui: ReturnType<typeof renderWithProviders>;
  actions: string[];
} {
  mkdirSync(fixtureRoot, { recursive: true });
  const lockDir = mkdtempSync(resolve(fixtureRoot, 'locks-'));
  directories.push(lockDir);
  const values = new Map<string, string>();
  const saveStarted = deferred<void>();
  const save = deferred<void>();
  const store = new KeyringTokenStore({
    lockDir,
    secureStore: {
      async get(key): Promise<string | null> {
        return values.get(key) ?? null;
      },
      async set(key, value): Promise<void> {
        saveStarted.resolve();
        await save.promise;
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
  const provider = new AnthropicOAuthProvider(store);
  const manager = new OAuthManager(store);
  manager.registerProvider(provider);
  const callback = deferred<{ code: string; state: string }>();
  const ready = deferred<void>();
  vi.spyOn(callbackModule, 'startLocalOAuthCallback').mockResolvedValue({
    redirectUri: 'http://localhost:8766/callback',
    waitForCallback: () => callback.promise,
    async shutdown(): Promise<void> {
      callback.reject(new Error('Callback closed'));
    },
  });
  vi.spyOn(browser, 'shouldLaunchBrowser').mockReturnValue(true);
  vi.spyOn(browser, 'openBrowserSecurely').mockImplementation(async () => {
    ready.resolve();
  });
  vi.spyOn(ClipboardService, 'copyToClipboard').mockResolvedValue();
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    withFetchPreconnect(
      async () =>
        new Response(
          JSON.stringify({
            access_token: 'synthetic-lazy-token',
            expires_in: 3600,
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    ),
  );
  const storeUI = createDialogStore();
  const dialogs = createDialogOpeners(storeUI);
  const actions: string[] = [];
  function Host(): React.JSX.Element {
    const [history, setHistory] = useState<string[]>([]);
    const [authError, setAuthError] = useState<string | null>(null);
    const open = useSyncExternalStore(storeUI.store.subscribe, () =>
      selectDialogOpen(storeUI.store.getState(), 'oauthCode'),
    );
    const addItem = React.useCallback(
      (item: Omit<HistoryItemWithoutId, 'id'>): number => {
        if ('text' in item && typeof item.text === 'string') {
          const text = item.text;
          setHistory((old) => [...old, text]);
        }
        return 1;
      },
      [],
    );
    useUpdateAndOAuthBridges({
      addItem,
      setUpdateInfo: () => {},
      oauthControl: {
        authenticate: manager.authenticate.bind(manager),
        attachProviderMessages: manager.attachAddItemToProviders.bind(manager),
      },
    });
    useOAuthOrchestration({
      appDispatch: (action) => {
        actions.push(action.type);
      },
      dialogs,
      isOAuthCodeDialogOpen: open,
      getActiveProviderName: () => 'claudecode',
      setAuthError,
    });
    return React.createElement(
      React.Fragment,
      null,
      open
        ? React.createElement(OAuthCodeDialog, {
            provider: 'claudecode',
            onClose: () => dialogs.oauthCode.close(),
            onSubmit: (code: string) => provider.submitAuthCode(code),
          })
        : React.createElement(
            Text,
            { color: Colors.Foreground },
            'Code dialog closed',
          ),
      React.createElement(
        Text,
        { color: Colors.Foreground },
        [
          ...history,
          authError ? `Hidden AuthDialog error: ${authError}` : '',
        ].join('\n'),
      ),
    );
  }
  return {
    manager,
    store,
    callback,
    ready: ready.promise,
    saveStarted: saveStarted.promise,
    save,
    ui: renderWithProviders(React.createElement(Host)),
    actions,
  };
}

async function tick(): Promise<void> {
  await act(async () => {
    await advanceTimersByTimeAsync(200);
  });
}
function request(): ReturnType<typeof interactiveAuthCoordinator.requestAuth> {
  return interactiveAuthCoordinator.requestAuth({
    provider: 'claudecode',
    bucket: 'default',
    requester: { runtimeKind: 'cli-interactive' },
    reason: 'authentication-required',
    correlationId: 'prompt-lazy-auth',
  });
}

describe('prompt-triggered lazy authentication dialog', () => {
  beforeEach(async () => {
    await interactiveAuthCoordinator.dispose();
    oauthUIBridge.clearPending();
    vi.useFakeTimers();
  });
  afterEach(async () => {
    await interactiveAuthCoordinator.dispose();
    interactiveAuthCoordinator.unbindHost();
    oauthUIBridge.clearCallback();
    oauthUIBridge.clearPending();
    const attempt = oauthUIBridge.getDialog();
    if (attempt) oauthUIBridge.dismissDialog(attempt.id);
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.assign(getOAuthGlobalState(), {
      __oauth_needs_code: undefined,
      __oauth_provider: undefined,
      __oauth_auth_complete: undefined,
      __oauth_auth_error: undefined,
      __oauth_browser_auth_complete: undefined,
    });
    for (const dir of directories.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  it('keeps fixture storage inside the assigned project root', () => {
    expect(resolve(fixtureRoot, '../..')).toBe(
      resolve(import.meta.dir, '../../../..'),
    );
  });

  it('accepts a new attempt after manual failure without unmounting the host dialog', async () => {
    const h = harness();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Rejected', { status: 400 }),
    );
    const first = request();
    const nextCallback = deferred<{ code: string; state: string }>();
    let second: ReturnType<typeof request> | undefined;
    try {
      await h.ready;
      await tick();
      await act(async () => {
        h.ui.stdin.write('\x1b[200~first-code\x1b[201~');
      });
      await waitFor(() => expect(h.ui.lastFrame()).toContain('first-code'));
      await act(async () => {
        h.ui.stdin.write('\r');
      });
      expect((await first).kind).toBe('failed');
      await tick();
      expect(h.ui.lastFrame()).toContain('authentication failed:');
      const nextReady = deferred<void>();
      vi.spyOn(callbackModule, 'startLocalOAuthCallback').mockResolvedValue({
        redirectUri: 'http://localhost:8766/callback',
        waitForCallback: () => nextCallback.promise,
        async shutdown(): Promise<void> {
          nextCallback.reject(new Error('Retry callback closed'));
        },
      });
      vi.spyOn(browser, 'openBrowserSecurely').mockImplementation(async () => {
        nextReady.resolve();
      });
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        withFetchPreconnect(
          async () =>
            new Response(
              JSON.stringify({ access_token: 'retry-token', expires_in: 3600 }),
              { headers: { 'Content-Type': 'application/json' } },
            ),
        ),
      );
      second = request();
      await nextReady.promise;
      await tick();
      expect(h.ui.lastFrame()).not.toContain(
        'Waiting for authentication to finish',
      );
      await act(async () => {
        h.ui.stdin.write('\x1b[200~retry-code\x1b[201~');
      });
      await waitFor(() => expect(h.ui.lastFrame()).toContain('retry-code'));
      await act(async () => {
        h.ui.stdin.write('\r');
      });
      await h.saveStarted;
      await tick();
      expect(h.ui.lastFrame()).toContain(
        'Waiting for authentication to finish',
      );
      h.save.resolve();
      expect((await second).kind).toBe('succeeded');
      await tick();
      expect(h.ui.lastFrame()).toContain('Code dialog closed');
      expect(await h.store.getToken('claudecode')).not.toBeNull();
    } finally {
      nextCallback.resolve({ code: 'cleanup-code', state: 'cleanup-state' });
      h.save.resolve();
      h.ui.unmount();
      await first;
      await second;
    }
  });

  it('closes the actual host-challenge dialog only after callback credentials persist, without command completion', async () => {
    const h = harness();
    const outcome = request();
    try {
      await h.ready;
      await tick();
      expect(h.ui.lastFrame()).toContain('Claudecode OAuth');
      h.callback.resolve({ code: 'callback-code', state: 'callback-state' });
      await h.saveStarted;
      await tick();
      expect(h.ui.lastFrame()).toContain('Claudecode OAuth');
      expect(await h.store.getToken('claudecode')).toBeNull();
      h.save.resolve();
      expect((await outcome).kind).toBe('succeeded');
      await tick();
      await waitFor(() =>
        expect(h.ui.lastFrame()).toContain('Code dialog closed'),
      );
      expect(await h.store.getToken('claudecode')).not.toBeNull();
      expect(h.actions).not.toContain('SET_NEEDS_RELOGIN');
    } finally {
      h.save.resolve();
      h.ui.unmount();
      await outcome;
    }
  });

  it.each(['exchange', 'save'])(
    'ends manual waiting and renders the terminal %s error in history',
    async (failure) => {
      const h = harness();
      if (failure === 'exchange')
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          new Response('Rejected', { status: 400 }),
        );
      const outcome = request();
      try {
        await h.ready;
        await tick();
        await act(async () => {
          h.ui.stdin.write('\x1b[200~manual-code\x1b[201~');
        });
        await waitFor(() => expect(h.ui.lastFrame()).toContain('manual-code'));
        await act(async () => {
          h.ui.stdin.write('\r');
        });
        let pendingFrame = '';
        if (failure === 'save') {
          await h.saveStarted;
          await tick();
          pendingFrame = h.ui.lastFrame() ?? '';
          h.save.reject(new Error('Synthetic keyring write failure'));
        }
        expect(
          pendingFrame.includes('Waiting for authentication to finish'),
        ).toBe(failure === 'save');
        expect((await outcome).kind).toBe('failed');
        await tick();
        await waitFor(() => {
          expect(h.ui.lastFrame()).toContain('Claudecode OAuth');
          expect(h.ui.lastFrame()).not.toContain(
            'Waiting for authentication to finish',
          );
          expect(h.ui.lastFrame()).not.toContain('Hidden AuthDialog error:');
          expect(h.ui.lastFrame()).toMatch(
            failure === 'save'
              ? /keyring write failure/
              : /[Ee]xchange|400|[Aa]uthorization/,
          );
        });
        expect(await h.store.getToken('claudecode')).toBeNull();
      } finally {
        h.save.resolve();
        h.ui.unmount();
        await outcome;
      }
    },
  );

  it('keeps the active lazy dialog open when an unrelated command flight fails', async () => {
    const h = harness();
    const outcome = request();
    try {
      await h.ready;
      await tick();
      await h.manager
        .authenticate('unknown-provider', undefined, {
          signalAuthCompletion: true,
        })
        .catch(() => undefined);
      await tick();
      expect(h.ui.lastFrame()).toContain('Claudecode OAuth');
      h.callback.resolve({ code: 'callback-code', state: 'callback-state' });
      h.save.resolve();
      expect((await outcome).kind).toBe('succeeded');
    } finally {
      h.save.resolve();
      h.ui.unmount();
      await outcome;
    }
  });
  it.each(['exchange', 'save'])(
    'renders callback %s failure without stale AuthDialog errors',
    async (failure) => {
      const h = harness();
      if (failure === 'exchange')
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          new Response('Rejected', { status: 400 }),
        );
      const outcome = request();
      try {
        await h.ready;
        await tick();
        h.callback.resolve({ code: 'bad-callback', state: 'state' });
        if (failure === 'save') {
          await h.saveStarted;
          h.save.reject(new Error('Synthetic callback keyring failure'));
        }
        expect((await outcome).kind).toBe('failed');
        await tick();
        expect(h.ui.lastFrame()).toContain('Claudecode OAuth');
        expect(h.ui.lastFrame()).toContain('authentication failed:');
        expect(h.ui.lastFrame()).not.toContain('Hidden AuthDialog error:');
        expect(await h.store.getToken('claudecode')).toBeNull();
      } finally {
        h.save.resolve();
        h.ui.unmount();
        await outcome;
      }
    },
  );

  it.each(['success', 'failure'])(
    'keeps a manual participant live after the prompt participant detaches until shared %s',
    async (result) => {
      const h = harness();
      if (result === 'failure')
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          new Response('Rejected', { status: 400 }),
        );
      const controller = new AbortController();
      const background = h.manager
        .authenticate('claudecode', undefined, { signal: controller.signal })
        .catch((error: unknown) => error);
      await h.ready;
      const outcome = request();
      try {
        await tick();
        const departed = new Error('Prompt participant detached');
        controller.abort(departed);
        expect(await background).toBe(departed);
        await tick();
        expect(h.ui.lastFrame()).toContain('Claudecode OAuth');
        expect(h.ui.lastFrame()).not.toContain('authentication failed:');
        await act(async () => {
          h.ui.stdin.write('\x1b[200~joined-code\x1b[201~');
        });
        await waitFor(() => expect(h.ui.lastFrame()).toContain('joined-code'));
        await act(async () => {
          h.ui.stdin.write('\r');
        });
        h.save.resolve();
        expect((await outcome).kind).toBe(
          result === 'success' ? 'succeeded' : 'failed',
        );
        await tick();
        expect(h.ui.lastFrame()).not.toContain(
          'Waiting for authentication to finish',
        );
        expect(h.ui.lastFrame()).not.toContain('Prompt participant detached');
        expect((await h.store.getToken('claudecode')) !== null).toBe(
          result === 'success',
        );
      } finally {
        h.save.resolve();
        h.ui.unmount();
        await outcome;
      }
    },
  );

  it('ignores successful command completion from another bucket without a dialog', async () => {
    const h = harness();
    h.save.resolve();
    await h.store.saveToken(
      'claudecode',
      {
        access_token: 'existing-other-bucket',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'other',
    );
    const outcome = request();
    try {
      await h.ready;
      await tick();
      await h.manager.authenticate('claudecode', 'other', {
        signalAuthCompletion: true,
      });
      await tick();
      expect(h.ui.lastFrame()).toContain('Claudecode OAuth');
      expect(h.ui.lastFrame()).not.toContain('authentication failed:');
      h.callback.resolve({ code: 'active-callback', state: 'state' });
      expect((await outcome).kind).toBe('succeeded');
      await tick();
      expect(h.ui.lastFrame()).toContain('Code dialog closed');
    } finally {
      h.ui.unmount();
      await outcome;
    }
  });
  it('keeps the newer bucket dialog open when an older persistence flight settles', async () => {
    const h = harness();
    const first = request();
    let second: Promise<void> = Promise.resolve();
    try {
      await h.ready;
      await tick();
      h.callback.resolve({ code: 'first-callback', state: 'first-state' });
      await h.saveStarted;
      const secondCallback = deferred<{ code: string; state: string }>();
      const secondReady = deferred<void>();
      vi.spyOn(callbackModule, 'startLocalOAuthCallback').mockResolvedValue({
        redirectUri: 'http://localhost:8766/callback',
        waitForCallback: () => secondCallback.promise,
        async shutdown(): Promise<void> {
          secondCallback.reject(new Error('Second callback closed'));
        },
      });
      vi.spyOn(browser, 'openBrowserSecurely').mockImplementation(async () => {
        secondReady.resolve();
      });
      second = h.manager.authenticate('claudecode', 'second');
      await secondReady.promise;
      await tick();
      h.save.resolve();
      expect((await first).kind).toBe('succeeded');
      await tick();
      expect(h.ui.lastFrame()).toContain('Claudecode OAuth');
      expect(await h.store.getToken('claudecode', 'second')).toBeNull();
      secondCallback.resolve({
        code: 'second-callback',
        state: 'second-state',
      });
      await second;
      await tick();
      expect(h.ui.lastFrame()).toContain('Code dialog closed');
      expect(await h.store.getToken('claudecode', 'second')).not.toBeNull();
    } finally {
      h.save.resolve();
      h.ui.unmount();
      await first;
      await second;
    }
  });
  it('lets Escape dismiss the pending view without reopening it when the existing flight finishes', async () => {
    const h = harness();
    const outcome = request();
    try {
      await h.ready;
      await tick();
      await act(async () => {
        h.ui.stdin.write('\x1b');
      });
      await tick();
      expect(h.ui.lastFrame()).toContain('Code dialog closed');
      h.callback.resolve({ code: 'after-dismissal', state: 'state' });
      h.save.resolve();
      expect((await outcome).kind).toBe('succeeded');
      await tick();
      expect(h.ui.lastFrame()).not.toContain('Claudecode OAuth');
      expect(await h.store.getToken('claudecode')).not.toBeNull();
    } finally {
      h.save.resolve();
      h.ui.unmount();
      await outcome;
    }
  });
});
