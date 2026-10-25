/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type BucketAuthConfirmationRequest,
} from '@vybestack/llxprt-code-policy/confirmation-bus/types.js';
import { OAuthManager } from './oauth-manager.js';
import type { OAuthProvider, OAuthToken, TokenStore } from './types.js';

function freshToken(access: string): OAuthToken {
  return {
    access_token: access,
    refresh_token: `refresh-${access}`,
    expiry: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'Bearer',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inMemoryStore(): TokenStore & {
  readonly tokens: Map<string, OAuthToken>;
} {
  const tokens = new Map<string, OAuthToken>();
  const key = (provider: string, bucket?: string): string =>
    `${provider}:${bucket ?? 'default'}`;
  return {
    tokens,
    getToken: async (provider, bucket) =>
      tokens.get(key(provider, bucket)) ?? null,
    saveToken: async (provider, token, bucket) => {
      tokens.set(key(provider, bucket), token);
    },
    removeToken: async (provider, bucket) => {
      tokens.delete(key(provider, bucket));
    },
    listProviders: async () => [],
    listBuckets: async () => [],
    getBucketStats: async () => null,
    acquireRefreshLock: async () => true,
    releaseRefreshLock: async () => {},
    acquireAuthLock: async () => true,
    releaseAuthLock: async () => {},
  };
}

function countingProvider(name: string): {
  readonly provider: OAuthProvider;
  readonly initiations: () => number;
} {
  let initiations = 0;
  const provider: OAuthProvider = {
    name,
    initiateAuth: async (): Promise<OAuthToken> => {
      initiations += 1;
      return freshToken(`${name}-token`);
    },
    getToken: async () => null,
    refreshToken: async () => null,
  };
  return { provider, initiations: () => initiations };
}

function managerOn(
  bus: MessageBus,
  store: TokenStore,
  policy: { readonly bucketPrompt: boolean; readonly bucketDelay: number },
): OAuthManager {
  return new OAuthManager(store, undefined, {
    messageBus: bus,
    readSessionAuthPolicy: () => ({
      profileName: null,
      bucketPrompt: policy.bucketPrompt,
      bucketDelay: policy.bucketDelay,
      interactiveTimeoutMs: undefined,
      noBrowser: false,
      authOnly: false,
    }),
  });
}

function requestFor(
  bus: MessageBus,
  provider: string,
): Promise<BucketAuthConfirmationRequest> {
  return new Promise((resolve) => {
    const unsubscribe = bus.subscribe<BucketAuthConfirmationRequest>(
      MessageBusType.BUCKET_AUTH_CONFIRMATION_REQUEST,
      (request) => {
        if (request.provider !== provider) return;
        unsubscribe();
        resolve(request);
      },
    );
  });
}

async function settlesWithin<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ readonly settled: boolean; readonly outcome?: unknown }> {
  const outcome = promise.then(
    () => ({ settled: true, outcome: undefined }),
    (error: unknown) => ({ settled: true, outcome: error }),
  );
  return Promise.race([outcome, sleep(ms).then(() => ({ settled: false }))]);
}

describe('OAuthManager dispose cancels an admitted multi-bucket authentication', () => {
  it('abandons its own confirmation while the prompt is waiting and leaves a peer on the same bus waiting for its user', async () => {
    const bus = new MessageBus();
    const storeA = inMemoryStore();
    const storeB = inMemoryStore();
    const managerA = managerOn(bus, storeA, {
      bucketPrompt: true,
      bucketDelay: 0,
    });
    const managerB = managerOn(bus, storeB, {
      bucketPrompt: true,
      bucketDelay: 0,
    });
    const a = countingProvider('alpha');
    const b = countingProvider('beta');
    managerA.registerProvider(a.provider);
    managerB.registerProvider(b.provider);
    const requestA = requestFor(bus, 'alpha');
    const requestB = requestFor(bus, 'beta');
    const authenticatingA = managerA
      .authenticateMultipleBuckets('alpha', ['one', 'two'])
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    const authenticatingB = managerB.authenticateMultipleBuckets('beta', [
      'one',
    ]);
    const [, peerRequest] = await Promise.all([requestA, requestB]);

    try {
      const disposal = await settlesWithin(managerA.dispose(), 1000);
      expect(disposal.settled).toBe(true);
      expect(disposal.outcome).toBeUndefined();
      expect(await authenticatingA).toBeInstanceOf(Error);
      expect(a.initiations()).toBe(0);
      expect(
        bus.listenerCount(MessageBusType.BUCKET_AUTH_CONFIRMATION_RESPONSE),
      ).toBe(1);

      const peerStillWaiting = await settlesWithin(authenticatingB, 50);
      expect(peerStillWaiting.settled).toBe(false);
      bus.respondToBucketAuthConfirmation(peerRequest.correlationId, true);
      await authenticatingB;
      expect(storeB.tokens.has('beta:one')).toBe(true);
      expect(b.initiations()).toBe(1);
    } finally {
      bus.cancelPendingConfirmations();
      await authenticatingA;
      await authenticatingB.catch(() => undefined);
      await managerA.dispose();
      await managerB.dispose();
    }
  });

  it('stops waiting between buckets when the owner disposes, and a peer manager still authenticates', async () => {
    const bus = new MessageBus();
    const managerA = managerOn(bus, inMemoryStore(), {
      bucketPrompt: false,
      bucketDelay: 60_000,
    });
    const storeB = inMemoryStore();
    const managerB = managerOn(bus, storeB, {
      bucketPrompt: false,
      bucketDelay: 0,
    });
    const a = countingProvider('alpha');
    const b = countingProvider('beta');
    managerA.registerProvider(a.provider);
    managerB.registerProvider(b.provider);
    const authenticatingA = managerA
      .authenticateMultipleBuckets('alpha', ['one', 'two'])
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    await sleep(50);
    expect(a.initiations()).toBe(0);

    try {
      const disposal = await settlesWithin(managerA.dispose(), 1000);
      expect(disposal.settled).toBe(true);
      expect(disposal.outcome).toBeUndefined();
      expect(await authenticatingA).toBeInstanceOf(Error);
      expect(a.initiations()).toBe(0);

      await managerB.authenticateMultipleBuckets('beta', ['one', 'two']);
      expect(storeB.tokens.has('beta:one')).toBe(true);
      expect(storeB.tokens.has('beta:two')).toBe(true);
    } finally {
      bus.cancelPendingConfirmations();
      await managerA.dispose();
      await managerB.dispose();
    }
  });
});
