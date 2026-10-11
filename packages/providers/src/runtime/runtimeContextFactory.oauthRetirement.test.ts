/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { MemoryTokenStore } from '../auth/__tests__/behavioral/test-utils.js';
import { createFileOAuthSettingsProvider } from '../auth/file-oauth-settings.js';
import { OAuthManager } from '../auth/oauth-manager.js';
import type { OAuthProvider, OAuthToken } from '../auth/types.js';
import { useRuntimeTestOwners } from './__tests__/runtime-owner-test-helpers.js';

const PROVIDER = 'renewal-test-provider';
const RENEWAL_WINDOW_MS = 11 * 60 * 1000;

/** Records every refresh-lock interaction in order; the first acquire can be held. */
class RecordingTokenStore extends MemoryTokenStore {
  readonly events: string[] = [];
  private gate: Promise<void> | undefined;

  holdNextAcquire(): () => void {
    let release: () => void = () => {};
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  override async acquireRefreshLock(): Promise<boolean> {
    this.events.push('acquire');
    const pending = this.gate;
    this.gate = undefined;
    await pending;
    return true;
  }

  override async releaseRefreshLock(): Promise<void> {
    this.events.push('release');
  }
}

async function refusedRefresh(): Promise<OAuthToken> {
  throw new Error('Retired renewal must not refresh a token');
}

function createProvider(
  refreshToken: OAuthProvider['refreshToken'] = refusedRefresh,
): OAuthProvider {
  return {
    name: PROVIDER,
    initiateAuth: async () => {
      throw new Error('Interactive auth is not part of renewal');
    },
    getToken: async () => null,
    refreshToken,
  };
}

function tokenExpiringInTenMinutes(): OAuthToken {
  return {
    access_token: 'access',
    token_type: 'Bearer',
    refresh_token: 'refresh',
    expiry: Date.now() / 1000 + 600,
  };
}

describe('runtime cleanup retires the OAuthManager it owns', () => {
  const owners = useRuntimeTestOwners();
  let configHome: string;
  let previousConfigHome: string | undefined;

  beforeEach(() => {
    previousConfigHome = process.env['LLXPRT_CONFIG_HOME'];
    configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-retire-'));
    fs.writeFileSync(
      path.join(configHome, 'settings.json'),
      JSON.stringify({ oauthEnabledProviders: { [PROVIDER]: true } }),
      'utf-8',
    );
    process.env['LLXPRT_CONFIG_HOME'] = configHome;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousConfigHome === undefined) {
      delete process.env['LLXPRT_CONFIG_HOME'];
    } else {
      process.env['LLXPRT_CONFIG_HOME'] = previousConfigHome;
    }
    fs.rmSync(configHome, { recursive: true, force: true });
  });

  async function seedToken(store: RecordingTokenStore): Promise<void> {
    await store.saveToken(PROVIDER, tokenExpiringInTenMinutes());
  }

  it('cancels a renewal scheduled by an ordinary token read', async () => {
    const store = new RecordingTokenStore();
    await seedToken(store);
    const handle = owners.isolated({ tokenStore: store });
    handle.oauthManager.registerProvider(createProvider());

    await handle.oauthManager.getOAuthToken(PROVIDER);
    await handle.cleanup();
    await advanceTimersByTimeAsync(RENEWAL_WINDOW_MS);

    expect(store.events).toStrictEqual([]);
  });

  it('joins an in-flight renewal before cleanup settles', async () => {
    const store = new RecordingTokenStore();
    await seedToken(store);
    const handle = owners.isolated({ tokenStore: store });
    const refreshCalls: string[] = [];
    handle.oauthManager.registerProvider(
      createProvider(async () => {
        refreshCalls.push('refresh');
        return refusedRefresh();
      }),
    );
    await handle.oauthManager.getOAuthToken(PROVIDER);
    const releaseAcquire = store.holdNextAcquire();

    await advanceTimersByTimeAsync(RENEWAL_WINDOW_MS);
    expect(store.events).toStrictEqual(['acquire']);

    let cleanupSettled = false;
    const cleanup = (async (): Promise<void> => {
      await handle.cleanup();
      cleanupSettled = true;
    })();
    await advanceTimersByTimeAsync(1000);
    expect(cleanupSettled).toBe(false);

    releaseAcquire();
    await cleanup;

    expect(store.events).toStrictEqual(['acquire', 'release']);
    expect(refreshCalls).toStrictEqual([]);
    await advanceTimersByTimeAsync(RENEWAL_WINDOW_MS);
    expect(store.events).toStrictEqual(['acquire', 'release']);
  });

  it('leaves a borrowed manager and store working after the runtime is disposed', async () => {
    const store = new RecordingTokenStore();
    await seedToken(store);
    const borrowed = new OAuthManager(store, createFileOAuthSettingsProvider());
    borrowed.registerProvider(createProvider());
    const handle = owners.isolated({
      tokenStore: store,
      oauthManager: borrowed,
    });

    try {
      await handle.cleanup();
      const token = await borrowed.getOAuthToken(PROVIDER);
      await advanceTimersByTimeAsync(RENEWAL_WINDOW_MS);

      expect(token?.access_token).toBe('access');
      expect(store.events).toContain('acquire');
    } finally {
      await borrowed.dispose();
    }
  });
});
