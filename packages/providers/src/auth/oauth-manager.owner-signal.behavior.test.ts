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

interface ObservingProvider {
  readonly provider: OAuthProvider;
  readonly signals: AbortSignal[];
  readonly abortedAtEntry: boolean[];
  readonly entered: Promise<void>;
}

/** Issues a token per call; with `holdUntilAbort` it waits for its signal. */
function observingProvider(
  name: string,
  options: { readonly holdUntilAbort: boolean },
): ObservingProvider {
  const signals: AbortSignal[] = [];
  const abortedAtEntry: boolean[] = [];
  let announce = (): void => {};
  const entered = new Promise<void>((resolve) => {
    announce = resolve;
  });
  const provider: OAuthProvider = {
    name,
    initiateAuth: async (signal?: AbortSignal): Promise<OAuthToken> => {
      if (signal === undefined) throw new Error('No owner signal supplied');
      signals.push(signal);
      abortedAtEntry.push(signal.aborted);
      announce();
      if (options.holdUntilAbort) {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
      }
      return freshToken(`${name}-token-${signals.length}`);
    },
    getToken: async () => null,
    refreshToken: async () => null,
  };
  return { provider, signals, abortedAtEntry, entered };
}

function confirmingManager(store: TokenStore, bus: MessageBus): OAuthManager {
  const manager = new OAuthManager(store, undefined, {
    messageBus: bus,
    readSessionAuthPolicy: () => ({
      profileName: null,
      bucketPrompt: true,
      bucketDelay: 0,
      interactiveTimeoutMs: undefined,
      noBrowser: false,
      authOnly: false,
    }),
  });
  bus.subscribe<BucketAuthConfirmationRequest>(
    MessageBusType.BUCKET_AUTH_CONFIRMATION_REQUEST,
    (request) =>
      bus.respondToBucketAuthConfirmation(request.correlationId, true),
  );
  return manager;
}

describe('OAuthManager gives the provider a live owner signal for authentication', () => {
  it('authenticates an explicit bucket and stores the token there', async () => {
    const store = inMemoryStore();
    const manager = confirmingManager(store, new MessageBus());
    const observed = observingProvider('claudecode', { holdUntilAbort: false });
    manager.registerProvider(observed.provider);

    await manager.authenticate('claudecode', 'bucket-a');

    expect(store.tokens.get('claudecode:bucket-a')?.access_token).toBe(
      'claudecode-token-1',
    );
    expect(store.tokens.size).toBe(1);
    expect(observed.abortedAtEntry).toStrictEqual([false]);
    await manager.dispose();
  });

  it('authenticates every requested bucket, each under a live owner signal', async () => {
    const store = inMemoryStore();
    const manager = confirmingManager(store, new MessageBus());
    const observed = observingProvider('claudecode', { holdUntilAbort: false });
    manager.registerProvider(observed.provider);

    await manager.authenticateMultipleBuckets('claudecode', [
      'bucket-a',
      'bucket-b',
    ]);

    expect([...store.tokens.keys()].sort()).toStrictEqual([
      'claudecode:bucket-a',
      'claudecode:bucket-b',
    ]);
    expect(observed.abortedAtEntry).toStrictEqual([false, false]);
    await manager.dispose();
  });

  it('cancels the provider signal on dispose, fails the caller once, and skips the remaining buckets', async () => {
    const store = inMemoryStore();
    const manager = confirmingManager(store, new MessageBus());
    const observed = observingProvider('claudecode', { holdUntilAbort: true });
    manager.registerProvider(observed.provider);
    const callerOutcomes: unknown[] = [];
    const authenticating = manager
      .authenticateMultipleBuckets('claudecode', ['bucket-a', 'bucket-b'])
      .then(
        () => callerOutcomes.push('fulfilled'),
        (error: unknown) => callerOutcomes.push(error),
      );
    await observed.entered;
    expect(observed.signals[0]?.aborted).toBe(false);

    await manager.dispose();
    await authenticating;

    expect(observed.signals[0]?.aborted).toBe(true);
    expect(observed.signals).toHaveLength(1);
    expect(callerOutcomes).toHaveLength(1);
    expect(callerOutcomes[0]).toBeInstanceOf(Error);
    expect(store.tokens.size).toBe(0);
  });
});
