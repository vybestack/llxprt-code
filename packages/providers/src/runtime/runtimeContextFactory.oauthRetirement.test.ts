import { AdoptedProviderFixture } from '../../../agents/src/api/__tests__/helpers/adopted-provider-fixture.js';
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
import { runCleanupSteps } from '../../../agents/src/core/subagent-cleanup.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';

import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '../ProviderManager.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';

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
  const realTimers = { setTimeout, setInterval, setImmediate };
  let sequence = 0;
  let fixtureId = 0;
  let fakeTimersInstalled = false;
  let cleanupLock: string;
  let observeNativeCleanup = false;
  let cleanupEntry: { fakeClock: boolean; lockExists: boolean };
  function trace(
    boundary: string,
    state: Readonly<Record<string, boolean | readonly number[]>> = {},
  ): void {
    if (boundary === 'credentials.beforeEach:enter') fixtureId += 1;
    if (
      observeNativeCleanup &&
      boundary === 'credentials.fixture.dispose:enter'
    ) {
      cleanupEntry = {
        fakeClock: vi.isFakeTimers(),
        lockExists: fs.existsSync(cleanupLock),
      };
    }
    if (observeNativeCleanup && boundary === 'credentials.home.remove:exit') {
      expect({
        ...cleanupEntry,
        lockRemains: fs.existsSync(cleanupLock),
      }).toStrictEqual({
        fakeClock: false,
        lockExists: true,
        lockRemains: false,
      });
      observeNativeCleanup = false;
    }
    process.stderr.write(
      JSON.stringify({
        diagnostic: 'oauth-retirement-hooks',
        pid: process.pid,
        platform: process.platform,
        bun: process.versions.bun,
        fixtureId,
        sequence: sequence++,
        boundary,
        fakeTimersInstalled,
        fakeTimersActive: vi.isFakeTimers(),
        timeoutReplaced: setTimeout !== realTimers.setTimeout,
        intervalReplaced: setInterval !== realTimers.setInterval,
        immediateReplaced: setImmediate !== realTimers.setImmediate,
        ...state,
      }) + '\n',
    );
  }
  let oauth: OAuthManager;
  let release: AcquisitionRelease;
  const retiring: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    trace('runtime.afterEach.cleanup:enter');
    await runCleanupSteps(retiring.splice(0).reverse());
    trace('runtime.afterEach.cleanup:exit');
    vi.useRealTimers();
    fakeTimersInstalled = false;
  });
  const credentials = useOwnedCredentials(trace);
  function openOAuth(
    store: RecordingTokenStore,
    supplied: OAuthManager | undefined = undefined,
  ): void {
    const settings = new SettingsService();
    const config = new Config({
      sessionId: 'same-label',
      targetDir: configHome,
      cwd: configHome,
      model: 'owner-model',
      debugMode: false,
    });
    retiring.push(() => config.dispose());
    const acquisition = new AcquisitionRelease();
    release = acquisition;
    retiring.push(() => acquisition.close());
    const policy = new RuntimePolicyOwner(config);
    release.acquire('policy', () => policy.dispose());
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      settings,
      config,
    );
    release.acquire('manager', () => manager.dispose());
    oauth = new AdoptedProviderFixture(
      config,
      settings,
      'same-label',
    ).acquireOAuth(
      supplied,
      store,
      policy.session.messageBus,
      manager,
      undefined,
      credentials().authority,
      release,
    );
  }
  let configHome: string;
  let previousConfigHome: string | undefined;

  beforeEach(() => {
    trace('runtime.beforeEach:enter');
    previousConfigHome = process.env['LLXPRT_CONFIG_HOME'];
    if (previousConfigHome === undefined) {
      throw new Error('Credential fixture home is unavailable');
    }
    cleanupLock = path.join(previousConfigHome, 'native-cleanup', 'held.lock');
    fs.mkdirSync(path.dirname(cleanupLock));
    fs.writeFileSync(cleanupLock, 'owned native cleanup');
    configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-retire-'));
    fs.writeFileSync(
      path.join(configHome, 'settings.json'),
      JSON.stringify({ oauthEnabledProviders: { [PROVIDER]: true } }),
      'utf-8',
    );
    process.env['LLXPRT_CONFIG_HOME'] = configHome;
    vi.useFakeTimers();
    fakeTimersInstalled = true;
    trace('runtime.beforeEach:exit');
  });

  afterEach(() => {
    trace('runtime.afterEach.restore:enter');
    if (previousConfigHome === undefined) {
      delete process.env['LLXPRT_CONFIG_HOME'];
    } else {
      process.env['LLXPRT_CONFIG_HOME'] = previousConfigHome;
    }
    fs.rmSync(configHome, { recursive: true, force: true });
    trace('runtime.afterEach.restore:exit');
  });

  async function seedToken(store: RecordingTokenStore): Promise<void> {
    await store.saveToken(PROVIDER, tokenExpiringInTenMinutes());
  }

  it('cancels a renewal scheduled by an ordinary token read', async () => {
    trace('scheduled.body:enter');
    const store = new RecordingTokenStore();
    await seedToken(store);
    openOAuth(store);
    oauth.registerProvider(createProvider());

    await oauth.getOAuthToken(PROVIDER);
    trace('scheduled.release.close:enter');
    await release.close();
    trace('scheduled.release.close:exit');
    await advanceTimersByTimeAsync(RENEWAL_WINDOW_MS);

    expect(store.events).toStrictEqual([]);
    trace('scheduled.body:exit');
  });

  it('joins an in-flight renewal before cleanup settles', async () => {
    trace('in-flight.body:enter');
    const store = new RecordingTokenStore();
    await seedToken(store);
    openOAuth(store);
    const refreshCalls: string[] = [];
    oauth.registerProvider(
      createProvider(async () => {
        refreshCalls.push('refresh');
        return refusedRefresh();
      }),
    );
    await oauth.getOAuthToken(PROVIDER);
    const releaseAcquire = store.holdNextAcquire();

    await advanceTimersByTimeAsync(RENEWAL_WINDOW_MS);
    expect(store.events).toStrictEqual(['acquire']);

    let cleanupSettled = false;
    const cleanup = (async (): Promise<void> => {
      trace('in-flight.release.close:enter');
      await release.close();
      trace('in-flight.release.close:exit');
      cleanupSettled = true;
    })();
    await advanceTimersByTimeAsync(1000);
    expect(cleanupSettled).toBe(false);

    releaseAcquire();
    trace('in-flight.cleanup.join:enter');
    await cleanup;
    trace('in-flight.cleanup.join:exit');

    expect(store.events).toStrictEqual(['acquire', 'release']);
    expect(refreshCalls).toStrictEqual([]);
    await advanceTimersByTimeAsync(RENEWAL_WINDOW_MS);
    expect(store.events).toStrictEqual(['acquire', 'release']);
    trace('in-flight.body:exit');
  });

  it('leaves a borrowed manager and store working after the runtime is disposed', async () => {
    trace('borrowed.body:enter');
    const store = new RecordingTokenStore();
    await seedToken(store);
    const borrowed = new OAuthManager(store, createFileOAuthSettingsProvider());
    borrowed.registerProvider(createProvider());
    openOAuth(store, borrowed);

    try {
      trace('borrowed.release.close:enter');
      await release.close();
      trace('borrowed.release.close:exit');
      const token = await borrowed.getOAuthToken(PROVIDER);
      await advanceTimersByTimeAsync(RENEWAL_WINDOW_MS);

      expect(token?.access_token).toBe('access');
      expect(store.events).toContain('acquire');
    } finally {
      trace('borrowed.dispose:enter');
      await borrowed.dispose();
      trace('borrowed.dispose:exit');
    }
    trace('borrowed.body:exit');
  });

  it('joins native credential cleanup on the real clock', () => {
    observeNativeCleanup = true;
    expect(fs.existsSync(cleanupLock)).toBe(true);
  });
});
