/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { KeyringTokenStore } from '@vybestack/llxprt-code-auth';
import type { OAuthProvider, OAuthToken } from '../types.js';
import { OAuthManager } from '../oauth-manager.js';

const directories: string[] = [];
const managers: OAuthManager[] = [];

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

class GatedProvider implements OAuthProvider {
  readonly name = 'gated';
  readonly started = deferred<void>();
  readonly outcome = deferred<OAuthToken>();

  async initiateAuth(): Promise<OAuthToken> {
    this.started.resolve();
    return this.outcome.promise;
  }

  async getToken(): Promise<OAuthToken | null> {
    return null;
  }

  async refreshToken(): Promise<OAuthToken | null> {
    return null;
  }
}

function liveOwner(): { manager: OAuthManager; provider: GatedProvider } {
  const tempRoot = resolve(import.meta.dir, '../../../../../tmp');
  mkdirSync(tempRoot, { recursive: true });
  const lockDir = mkdtempSync(resolve(tempRoot, 'attempt-outcomes-'));
  directories.push(lockDir);
  const values = new Map<string, string>();
  const store = new KeyringTokenStore({
    lockDir,
    secureStore: {
      async get(key): Promise<string | null> {
        return values.get(key) ?? null;
      },
      async set(key, value): Promise<void> {
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
  const manager = new OAuthManager(store, undefined, undefined, 'owned');
  managers.push(manager);
  const provider = new GatedProvider();
  manager.registerProvider(provider);
  return { manager, provider };
}

function freshToken(): OAuthToken {
  return {
    access_token: 'access',
    token_type: 'Bearer',
    expiry: Math.floor(Date.now() / 1000) + 3600,
  };
}

describe('OAuthManager attempt outcomes per owner', () => {
  afterEach(async () => {
    for (const manager of managers.splice(0)) await manager.dispose();
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  it('reports each concurrent owner its own outcome and survives the other owner teardown', async () => {
    const a = liveOwner();
    const b = liveOwner();

    const loginA = a.manager
      .authenticate('gated', 'default', { signalAuthCompletion: true })
      .then(
        () => 'succeeded',
        (error: unknown) => (error instanceof Error ? error.message : 'failed'),
      );
    const loginB = b.manager.authenticate('gated', 'default', {
      signalAuthCompletion: true,
    });
    await Promise.all([a.provider.started.promise, b.provider.started.promise]);

    a.provider.outcome.reject(new Error('owner A rejected the code'));
    b.provider.outcome.resolve(freshToken());

    expect(await loginA).toBe('owner A rejected the code');
    await loginB;

    await a.manager.dispose();

    expect(b.manager.takeAuthOutcome()).toStrictEqual({
      complete: true,
      error: undefined,
    });
    expect(a.manager.takeAuthOutcome()).toStrictEqual({
      complete: false,
      error: 'owner A rejected the code',
    });
  });

  it('consumes an outcome once', async () => {
    const owner = liveOwner();
    const login = owner.manager.authenticate('gated', 'default', {
      signalAuthCompletion: true,
    });
    await owner.provider.started.promise;
    owner.provider.outcome.resolve(freshToken());
    await login;

    expect(owner.manager.takeAuthOutcome().complete).toBe(true);
    expect(owner.manager.takeAuthOutcome()).toStrictEqual({
      complete: false,
      error: undefined,
    });
  });
});
