/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { ProxySocketClient } from '@vybestack/llxprt-code-auth/proxy/proxy-socket-client.js';
import { ProxyTokenStore } from '@vybestack/llxprt-code-auth/proxy/proxy-token-store.js';
import { OAuthManager } from './oauth-manager.js';
import type { OAuthProvider, OAuthToken } from './types.js';

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

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

class RecordingClient extends ProxySocketClient {
  constructor(private readonly events: string[]) {
    super('/nonexistent/oauth-dispose-flights.sock');
  }

  override close(): void {
    this.events.push('store-close');
    super.close();
  }
}

/** In-memory token store whose locks may be shared with a peer store. */
class RecordingStore extends ProxyTokenStore {
  readonly events: string[] = [];
  readonly tokens = new Map<string, OAuthToken>();
  acquireGate: Promise<void> | undefined;
  failNextRelease = false;
  private readonly recordingClient = new RecordingClient(this.events);

  constructor(private readonly locks: Set<string> = new Set()) {
    super('/nonexistent/oauth-dispose-flights.sock');
  }

  override getClient(): ProxySocketClient {
    return this.recordingClient;
  }

  private key(provider: string, bucket?: string): string {
    return `${provider}:${bucket ?? 'default'}`;
  }

  override async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    return this.tokens.get(this.key(provider, bucket)) ?? null;
  }

  override async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    this.tokens.set(this.key(provider, bucket), token);
  }

  override async removeToken(provider: string, bucket?: string): Promise<void> {
    this.tokens.delete(this.key(provider, bucket));
  }

  override async listProviders(): Promise<string[]> {
    return [];
  }

  override async listBuckets(): Promise<string[]> {
    return [];
  }

  override async getBucketStats(): Promise<null> {
    return null;
  }

  override async acquireRefreshLock(): Promise<boolean> {
    return true;
  }

  override async releaseRefreshLock(): Promise<void> {}

  override async acquireAuthLock(
    provider: string,
    options?: { waitMs?: number; bucket?: string },
  ): Promise<boolean> {
    await this.acquireGate;
    const key = this.key(provider, options?.bucket);
    const deadline = Date.now() + (options?.waitMs ?? 0);
    while (this.locks.has(key)) {
      if (Date.now() >= deadline) return false;
      await sleep(5);
    }
    this.locks.add(key);
    this.events.push('lock-acquire');
    return true;
  }

  override async releaseAuthLock(
    provider: string,
    bucket?: string,
  ): Promise<void> {
    if (this.failNextRelease) {
      this.failNextRelease = false;
      this.events.push('lock-release-failed');
      throw new Error('auth lock release failed');
    }
    this.locks.delete(this.key(provider, bucket));
    this.events.push('lock-release');
  }
}

interface HeldProvider {
  readonly provider: OAuthProvider;
  readonly entered: Promise<void>;
  readonly hold: { release: () => void };
  readonly signals: AbortSignal[];
}

/** initiateAuth waits on a gate and ignores its signal while waiting. */
function heldProvider(name: string): HeldProvider {
  const entered = gate();
  const hold = gate();
  const signals: AbortSignal[] = [];
  const provider: OAuthProvider = {
    name,
    initiateAuth: async (signal?: AbortSignal): Promise<OAuthToken> => {
      if (signal !== undefined) signals.push(signal);
      entered.release();
      await hold.promise;
      return freshToken(`${name}-token`);
    },
    getToken: async () => null,
    refreshToken: async () => null,
  };
  return { provider, entered: entered.promise, hold, signals };
}

function immediateProvider(name: string): OAuthProvider {
  return {
    name,
    initiateAuth: async (): Promise<OAuthToken> => freshToken(`${name}-token`),
    getToken: async () => null,
    refreshToken: async () => null,
  };
}

function track<T>(promise: Promise<T>): {
  readonly isSettled: () => boolean;
  readonly outcome: Promise<unknown>;
} {
  let settled = false;
  const outcome = promise.then(
    () => {
      settled = true;
      return undefined;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  return { isSettled: () => settled, outcome };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function flatten(error: unknown): unknown[] {
  if (error instanceof AggregateError)
    return [error, ...error.errors.flatMap(flatten)];
  return [error];
}

function countMessages(error: unknown, message: string): number {
  return flatten(error).filter(
    (item) => item instanceof Error && item.message === message,
  ).length;
}

describe('OAuthManager dispose joins its authentication flights', () => {
  it('keeps dispose pending while the flight runs, rejects late callers, and releases the lock before closing the store', async () => {
    const storeA = new RecordingStore();
    const storeB = new RecordingStore();
    const managerA = new OAuthManager(storeA, undefined, undefined, 'owned');
    const managerB = new OAuthManager(storeB, undefined, undefined, 'owned');
    const held = heldProvider('held');
    managerA.registerProvider(held.provider);
    managerB.registerProvider(immediateProvider('held'));
    const authenticating = track(managerA.authenticate('held', 'default'));
    await held.entered;

    const disposing = track(managerA.dispose());
    await flush();
    try {
      expect(disposing.isSettled()).toBe(false);
      expect(held.signals[0]?.aborted).toBe(true);
      await expect(managerA.authenticate('held', 'default')).rejects.toThrow(
        'disposed',
      );
      await managerB.authenticate('held', 'default');
      expect(storeB.tokens.has('held:default')).toBe(true);

      held.hold.release();
      expect(await disposing.outcome).toBeUndefined();
      expect(await authenticating.outcome).toBeInstanceOf(Error);
      expect(storeA.events).toStrictEqual([
        'lock-acquire',
        'lock-release',
        'store-close',
      ]);
      expect(storeA.tokens.size).toBe(0);
    } finally {
      held.hold.release();
      await authenticating.outcome;
      await disposing.outcome;
      await managerB.dispose();
    }
  });

  it('hands the owner signal to authentication started by a token read without a host', async () => {
    const store = new RecordingStore();
    const manager = new OAuthManager(store, undefined, undefined, 'owned');
    const held = heldProvider('held');
    manager.registerProvider(held.provider);
    const reading = track(manager.getToken('held', 'default'));
    await held.entered;

    const disposing = track(manager.dispose());
    try {
      expect(held.signals[0]?.aborted).toBe(true);
      held.hold.release();
      expect(await disposing.outcome).toBeUndefined();
      expect(await reading.outcome).toBeInstanceOf(Error);
      expect(store.events).toStrictEqual([
        'lock-acquire',
        'lock-release',
        'store-close',
      ]);
    } finally {
      held.hold.release();
      await reading.outcome;
      await disposing.outcome;
    }
  });

  it('releases a lock acquired after the owner aborted, so a peer is not left waiting', async () => {
    const sharedLocks = new Set<string>();
    const storeA = new RecordingStore(sharedLocks);
    const storeB = new RecordingStore(sharedLocks);
    const managerA = new OAuthManager(storeA, undefined, undefined, 'owned');
    const managerB = new OAuthManager(storeB, undefined, undefined, 'owned');
    const lockGate = gate();
    storeA.acquireGate = lockGate.promise;
    managerA.registerProvider(immediateProvider('held'));
    managerB.registerProvider(immediateProvider('held'));
    const authenticating = track(managerA.authenticate('held', 'work'));
    await flush();

    const disposing = track(managerA.dispose());
    await flush();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      lockGate.release();
      expect(await disposing.outcome).toBeUndefined();
      expect(await authenticating.outcome).toBeInstanceOf(Error);
      expect(storeA.events).toStrictEqual([
        'lock-acquire',
        'lock-release',
        'store-close',
      ]);

      const peer = managerB.authenticate('held', 'work').then(() => 'done');
      const timeout = new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve('waited'), 3000);
      });
      expect(await Promise.race([peer, timeout])).toBe('done');
      expect(storeB.tokens.has('held:work')).toBe(true);
    } finally {
      lockGate.release();
      if (timer !== undefined) clearTimeout(timer);
      await authenticating.outcome;
      await disposing.outcome;
      await managerB.dispose();
    }
  });

  it('keeps retiring after a lock release fails and reports that failure once', async () => {
    const store = new RecordingStore();
    const manager = new OAuthManager(store, undefined, undefined, 'owned');
    const held = heldProvider('held');
    manager.registerProvider(held.provider);
    const authenticating = track(manager.authenticate('held', 'default'));
    await held.entered;
    store.failNextRelease = true;

    const disposing = track(manager.dispose());
    try {
      held.hold.release();
      const failure = await disposing.outcome;
      expect(failure).toBeInstanceOf(AggregateError);
      expect(countMessages(failure, 'auth lock release failed')).toBe(1);
      expect(
        flatten(failure).filter(
          (item) => item instanceof DOMException && item.name === 'AbortError',
        ),
      ).toHaveLength(0);
      expect(store.events).toStrictEqual([
        'lock-acquire',
        'lock-release-failed',
        'store-close',
      ]);
    } finally {
      held.hold.release();
      await authenticating.outcome;
      await disposing.outcome;
    }
  });
});
