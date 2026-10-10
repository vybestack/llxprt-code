/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, it, expect } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import { OAuthManager } from './oauth-manager.js';
import {
  makeExpiredToken,
  makeToken,
  MemoryTokenStore,
  createTestProvider,
} from './__tests__/behavioral/test-utils.js';

describe('BucketFailoverHandlerImpl foreground and explicit all-bucket auth', () => {
  const configs: Config[] = [];
  afterEach(async () => {
    for (const config of configs.splice(0)) {
      await config.dispose();
    }
  });

  async function fixture(withOwner: boolean): Promise<{
    store: MemoryTokenStore;
    manager: OAuthManager;
    handler: BucketFailoverHandlerImpl;
  }> {
    const store = new MemoryTokenStore();
    const buckets = ['bucket-a', 'bucket-b', 'bucket-c'];
    for (const bucket of buckets) {
      await store.saveToken('anthropic', makeExpiredToken(bucket), bucket);
    }
    const config = withOwner
      ? new Config({
          sessionId: 'failover-auth-owner',
          targetDir: process.cwd(),
          cwd: process.cwd(),
          debugMode: false,
          model: 'test-model',
          initialSettings: {
            'auth-bucket-prompt': false,
            'auth-bucket-delay': 0,
          },
        })
      : undefined;
    if (config) {
      configs.push(config);
    }
    const manager = new OAuthManager(store, undefined, {
      config,
      readSessionAuthPolicy: () => ({
        profileName: null,
        noBrowser: false,
        authOnly: false,
        interactiveTimeoutMs: undefined,
        bucketPrompt: false,
        bucketDelay: 0,
      }),
    });
    manager.registerProvider(createTestProvider('anthropic'));
    manager.setSessionBucket('anthropic', 'bucket-a');
    return {
      store,
      manager,
      handler: new BucketFailoverHandlerImpl(buckets, 'anthropic', manager),
    };
  }

  for (const withOwner of [false, true]) {
    it(`reauthenticates the selected candidate then prepares remaining buckets (Config owner: ${withOwner})`, async () => {
      const { store, manager, handler } = await fixture(withOwner);
      expect(await handler.tryFailover({ triggeringStatus: 401 })).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-b');
      expect(manager.getSessionBucket('anthropic')).toBe('bucket-b');
      for (const bucket of ['bucket-a', 'bucket-b', 'bucket-c']) {
        expect(
          (await store.getToken('anthropic', bucket))?.expiry,
        ).toBeGreaterThan(Date.now() / 1000);
      }
    });
  }

  it('later failover uses the prepared bucket without another foreground reauth', async () => {
    const { handler } = await fixture(true);
    expect(await handler.tryFailover({ triggeringStatus: 401 })).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');

    expect(await handler.tryFailover({ triggeringStatus: 429 })).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-c');
  });

  it('does not prepare remaining buckets when the request is cancelled after the reauth switch', async () => {
    const { store, manager, handler } = await fixture(true);
    const controller = new AbortController();
    const originalSetSessionBucket = manager.setSessionBucket.bind(manager);
    manager.setSessionBucket = (...args) => {
      originalSetSessionBucket(...args);
      if (args[1] === 'bucket-b') {
        controller.abort();
      }
    };

    await expect(
      handler.tryFailover({
        triggeringStatus: 401,
        signal: controller.signal,
      }),
    ).rejects.toThrow('Aborted');

    expect(
      (await store.getToken('anthropic', 'bucket-c'))?.expiry,
    ).toBeLessThan(Date.now() / 1000);
  });

  it('explicit all-bucket auth keeps an already recovered account', async () => {
    const { store, handler } = await fixture(true);
    expect(await handler.tryFailover({ triggeringStatus: 401 })).toBe(true);
    const recovered = makeToken('already-recovered-account');
    await store.saveToken('anthropic', recovered, 'bucket-b');

    await handler.ensureBucketsAuthenticated();

    expect(await store.getToken('anthropic', 'bucket-b')).toStrictEqual(
      recovered,
    );
  });
});
