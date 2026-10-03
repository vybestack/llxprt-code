/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  OAuthManager,
  type OAuthToken,
  type TokenStore,
} from '@vybestack/llxprt-code-providers/auth.js';
import { AuthControl, type AuthControlDeps } from '../control/authControl.js';
import { createAgentAuthState } from '../control/authState.js';

class MemoryTokenStore implements TokenStore {
  async getToken(): Promise<OAuthToken | null> {
    return null;
  }

  async saveToken(): Promise<void> {}

  async removeToken(): Promise<void> {}

  async listProviders(): Promise<string[]> {
    return [];
  }

  async listBuckets(): Promise<string[]> {
    return [];
  }

  async getBucketStats(): Promise<null> {
    return null;
  }

  async acquireRefreshLock(): Promise<boolean> {
    return true;
  }

  async releaseRefreshLock(): Promise<void> {}

  async acquireAuthLock(): Promise<boolean> {
    return true;
  }

  async releaseAuthLock(): Promise<void> {}
}

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}

function createControl(prompt: Deferred<boolean>): {
  readonly control: AuthControl;
  readonly authState: ReturnType<typeof createAgentAuthState>;
} {
  const authState = createAgentAuthState();
  const manager = new OAuthManager(new MemoryTokenStore());
  const deps: AuthControlDeps = {
    authState,
    getCurrentProvider: () => 'provider',
    getKeyName: () => undefined,
    getStatus: () => 'unauthenticated',
    onOAuthPrompt: async () => prompt.promise,
    setBaseUrl: async () => undefined,
    keysDeps: {
      authState,
      getKeyName: () => undefined,
      setKeyName: () => undefined,
      updateProviderApiKey: async () => undefined,
    },
    getOAuthManager: () => manager,
  };
  return { control: new AuthControl(deps), authState };
}

describe('AuthControl lifecycle', () => {
  it('aborts a pending prompt and rejects new login admissions after disposal', async () => {
    const prompt = deferred<boolean>();
    const { control, authState } = createControl(prompt);
    const login = control.login('provider');
    await Promise.resolve();

    control.dispose();

    await expect(login).rejects.toThrow('OAuth login cancelled');
    await expect(control.login('provider')).rejects.toThrow(
      'Auth control is disposed',
    );
    prompt.resolve(true);
    await Promise.resolve();
    expect(authState.oauthAuthenticated.has('provider')).toBe(false);
  });

  it('rejects every auth mutation after disposal while leaving status readable', async () => {
    const prompt = deferred<boolean>();
    const { control, authState } = createControl(prompt);
    control.dispose();

    const mutations = [
      control.enableOAuth('provider'),
      control.disableOAuth('provider'),
      control.logout('provider'),
      control.switchBucket('provider', 'bucket'),
      control.mcpLogin('server'),
      control.setBaseUrl('https://example.invalid'),
    ];

    for (const mutation of mutations) {
      await expect(mutation).rejects.toThrow('Auth control is disposed');
    }
    expect(control.status('provider')).toBe('unauthenticated');
    expect(authState.oauthEnabled.size).toBe(0);
    expect(authState.oauthAuthenticated.size).toBe(0);
    expect(authState.buckets.size).toBe(0);
    expect(authState.mcpAuth.size).toBe(0);
    expect(authState.baseUrl).toBeUndefined();
  });
});
