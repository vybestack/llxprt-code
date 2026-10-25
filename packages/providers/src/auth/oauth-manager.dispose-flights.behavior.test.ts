/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { ProxySocketClient } from '@vybestack/llxprt-code-auth/proxy/proxy-socket-client.js';
import { ProxyTokenStore } from '@vybestack/llxprt-code-auth/proxy/proxy-token-store.js';
import type { InteractiveAuthHostHandler } from './interactive-auth-coordinator.js';
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
  failNextRefreshRelease = false;
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

  override async releaseRefreshLock(): Promise<void> {
    if (this.failNextRefreshRelease) {
      this.failNextRefreshRelease = false;
      this.events.push('refresh-release-failed');
      throw new Error('refresh lock release failed');
    }
  }

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

interface HeldHost {
  readonly handler: InteractiveAuthHostHandler;
  readonly entered: Promise<void>;
  readonly hold: { release: () => void };
  readonly signals: AbortSignal[];
}

/** A host handler that waits on a gate and ignores its session signal. */
function heldHost(): HeldHost {
  const entered = gate();
  const hold = gate();
  const signals: AbortSignal[] = [];
  const handler: InteractiveAuthHostHandler = async (_challenge, signal) => {
    signals.push(signal);
    entered.release();
    await hold.promise;
  };
  return { handler, entered: entered.promise, hold, signals };
}

function interactivePrompt(
  timeoutMs?: number,
): Parameters<OAuthManager['requestInteractiveAuth']>[0] {
  return {
    provider: 'host-auth',
    bucket: 'default',
    requester: { runtimeKind: 'agent' },
    reason: 'authentication-required',
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

describe('OAuthManager dispose joins interactive host handlers', () => {
  async function disposeWithHeldHandler(
    prepare: (
      manager: OAuthManager,
      first: HeldHost,
      request: ReturnType<typeof track>,
    ) => Promise<void>,
    timeoutMs?: number,
  ): Promise<void> {
    const store = new RecordingStore();
    const manager = new OAuthManager(store, undefined, undefined, 'owned');
    const first = heldHost();
    manager.bindInteractiveAuthHost(first.handler);
    const request = track(
      manager.requestInteractiveAuth(interactivePrompt(timeoutMs)),
    );
    await first.entered;
    try {
      await prepare(manager, first, request);
      const disposing = track(manager.dispose());
      await flush();
      expect(disposing.isSettled()).toBe(false);
      expect(store.events).not.toContain('store-close');

      first.hold.release();
      expect(await disposing.outcome).toBeUndefined();
      expect(request.isSettled()).toBe(true);
      expect(store.events).toStrictEqual(['store-close']);
    } finally {
      first.hold.release();
      await request.outcome;
      await manager.dispose();
    }
  }

  it('keeps dispose pending while an active handler ignores its signal', async () => {
    await disposeWithHeldHandler(async (_manager, first) => {
      expect(first.signals[0]?.aborted).toBe(false);
    });
  });

  it('keeps dispose pending for the handler of a session cancelled before dispose', async () => {
    await disposeWithHeldHandler(async (manager, _first, request) => {
      expect(manager.cancelInteractiveAuth()).toBe(1);
      expect(manager.getInteractiveAuthSessions()).toHaveLength(0);
      expect(await request.outcome).toBeInstanceOf(Error);
    });
  });

  it('keeps dispose pending for the handler of a session that timed out', async () => {
    await disposeWithHeldHandler(async (manager, _first, request) => {
      expect(await request.outcome).toBeInstanceOf(Error);
      expect(manager.getInteractiveAuthSessions()).toHaveLength(0);
    }, 20);
  });

  it('keeps dispose pending for the old host handler after the host was replaced', async () => {
    await disposeWithHeldHandler(async (manager, _first, request) => {
      const second = heldHost();
      manager.bindInteractiveAuthHost(second.handler);
      expect(manager.cancelInteractiveAuth()).toBe(1);
      expect(await request.outcome).toBeInstanceOf(Error);
      second.hold.release();
    });
  });

  it('rejects interactive requests made after dispose started', async () => {
    const store = new RecordingStore();
    const manager = new OAuthManager(store, undefined, undefined, 'owned');
    const first = heldHost();
    manager.bindInteractiveAuthHost(first.handler);
    const request = track(manager.requestInteractiveAuth(interactivePrompt()));
    await first.entered;
    const disposing = track(manager.dispose());
    const lateHost = heldHost();
    try {
      manager.bindInteractiveAuthHost(lateHost.handler);
      const late = track(manager.requestInteractiveAuth(interactivePrompt()));
      await flush();
      expect(late.isSettled()).toBe(true);
      expect(String((await late.outcome) as Error)).toContain('disposed');
      expect(disposing.isSettled()).toBe(false);
    } finally {
      first.hold.release();
      lateHost.hold.release();
      await request.outcome;
      await disposing.outcome;
    }
  });

  it('leaves an independent manager and its held handler to settle on its own gate', async () => {
    const managerA = new OAuthManager(
      new RecordingStore(),
      undefined,
      undefined,
      'owned',
    );
    const storeB = new RecordingStore();
    const managerB = new OAuthManager(storeB, undefined, undefined, 'owned');
    const hostA = heldHost();
    const hostB = heldHost();
    managerA.bindInteractiveAuthHost(hostA.handler);
    managerB.bindInteractiveAuthHost(hostB.handler);
    const requestA = track(
      managerA.requestInteractiveAuth(interactivePrompt()),
    );
    const requestB = track(
      managerB.requestInteractiveAuth(interactivePrompt()),
    );
    await Promise.all([hostA.entered, hostB.entered]);

    const disposingA = track(managerA.dispose());
    try {
      await flush();
      expect(disposingA.isSettled()).toBe(false);
      expect(hostA.signals[0]?.aborted).toBe(true);
      expect(hostB.signals[0]?.aborted).toBe(false);
      expect(requestB.isSettled()).toBe(false);
      expect(managerB.getInteractiveAuthSessions()).toHaveLength(1);

      hostB.hold.release();
      expect(await requestB.outcome).toBeUndefined();
      expect(disposingA.isSettled()).toBe(false);
      expect(storeB.events).toStrictEqual([]);
    } finally {
      hostA.hold.release();
      hostB.hold.release();
      await requestA.outcome;
      await disposingA.outcome;
      await managerB.dispose();
    }
  });

  it('serves a new interactive session on another manager while this one is disposing', async () => {
    const managerA = new OAuthManager(
      new RecordingStore(),
      undefined,
      undefined,
      'owned',
    );
    const managerB = new OAuthManager(
      new RecordingStore(),
      undefined,
      undefined,
      'owned',
    );
    const hostA = heldHost();
    managerA.bindInteractiveAuthHost(hostA.handler);
    managerB.bindInteractiveAuthHost(async () => {});
    const requestA = track(
      managerA.requestInteractiveAuth(interactivePrompt()),
    );
    await hostA.entered;
    const disposingA = track(managerA.dispose());
    try {
      await flush();
      await managerB.requestInteractiveAuth(interactivePrompt());
      expect(disposingA.isSettled()).toBe(false);
    } finally {
      hostA.hold.release();
      await requestA.outcome;
      await disposingA.outcome;
      await managerB.dispose();
    }
  });
});

describe('OAuthManager multi-bucket authentication honors the caller signal', () => {
  it('cancels a held multi-bucket authentication while the manager stays usable', async () => {
    const store = new RecordingStore();
    const manager = new OAuthManager(
      store,
      undefined,
      {
        readSessionAuthPolicy: () => ({
          profileName: null,
          bucketPrompt: false,
          bucketDelay: 0,
          interactiveTimeoutMs: undefined,
          noBrowser: false,
          authOnly: false,
        }),
      },
      'owned',
    );
    const entered = gate();
    let held = false;
    const provider: OAuthProvider = {
      name: 'multi',
      initiateAuth: async (signal?: AbortSignal): Promise<OAuthToken> => {
        if (held || signal === undefined) return freshToken('multi-free');
        held = true;
        entered.release();
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
        throw new Error('unreachable');
      },
      getToken: async () => null,
      refreshToken: async () => null,
    };
    manager.registerProvider(provider);
    const caller = new AbortController();
    const authenticating = track(
      manager.authenticateMultipleBuckets(
        'multi',
        ['one', 'two'],
        undefined,
        caller.signal,
      ),
    );
    try {
      await entered.promise;
      expect(authenticating.isSettled()).toBe(false);

      caller.abort(new Error('caller gave up'));
      const outcome = await Promise.race([
        authenticating.outcome,
        sleep(1000).then(() => 'still-held'),
      ]);
      expect(outcome).toBeInstanceOf(Error);
      expect(store.events).not.toContain('store-close');
      expect(store.events.filter((e) => e === 'lock-acquire')).toHaveLength(
        store.events.filter((e) => e === 'lock-release').length,
      );

      await manager.authenticate('multi', 'three');
      expect(store.tokens.has('multi:three')).toBe(true);
    } finally {
      caller.abort(new Error('test cleanup'));
      await authenticating.outcome;
      await manager.dispose();
    }
  });
});

interface HeldRefresh {
  readonly provider: OAuthProvider;
  readonly entered: Promise<void>;
  readonly hold: { release: () => void };
}

/** refreshToken waits on a gate and ignores its signal while waiting. */
function heldRefreshProvider(
  name: string,
  outcome: 'refresh' | 'fail',
): HeldRefresh {
  const entered = gate();
  const hold = gate();
  const provider: OAuthProvider = {
    name,
    initiateAuth: async (): Promise<OAuthToken> => freshToken(`${name}-auth`),
    getToken: async () => null,
    refreshToken: async (): Promise<OAuthToken> => {
      entered.release();
      await hold.promise;
      if (outcome === 'fail') throw new Error('provider refresh failed');
      return freshToken(`${name}-refreshed`);
    },
  };
  return { provider, entered: entered.promise, hold };
}

function expiredToken(access: string): OAuthToken {
  return { ...freshToken(access), expiry: Math.floor(Date.now() / 1000) - 60 };
}

describe('OAuthManager dispose reports refresh-lock release failures', () => {
  async function disposeDuringRefresh(
    start: (manager: OAuthManager, store: RecordingStore) => Promise<unknown>,
    prepare: (store: RecordingStore) => void,
    outcome: 'refresh' | 'fail',
  ): Promise<{
    readonly caller: unknown;
    readonly disposal: unknown;
    readonly events: readonly string[];
  }> {
    const store = new RecordingStore();
    const manager = new OAuthManager(store, undefined, undefined, 'owned');
    const held = heldRefreshProvider('held', outcome);
    manager.registerProvider(held.provider);
    prepare(store);
    const running = track(start(manager, store));
    await held.entered;
    const disposing = track(manager.dispose());
    try {
      await flush();
      expect(disposing.isSettled()).toBe(false);
      held.hold.release();
      const disposal = await disposing.outcome;
      return { caller: await running.outcome, disposal, events: store.events };
    } finally {
      held.hold.release();
      await running.outcome;
      await disposing.outcome;
    }
  }

  it('reports a refresh-lock release failure once when a token read refresh is admitted at dispose', async () => {
    const result = await disposeDuringRefresh(
      (manager) => manager.getToken('held', 'default'),
      (store) => {
        store.tokens.set('held:default', expiredToken('stale'));
        store.failNextRefreshRelease = true;
      },
      'refresh',
    );

    expect(result.caller).toBeInstanceOf(Error);
    expect((result.caller as Error).message).toBe(
      'refresh lock release failed',
    );
    expect(result.disposal).toBeInstanceOf(AggregateError);
    expect(countMessages(result.disposal, 'refresh lock release failed')).toBe(
      1,
    );
    expect(result.events.slice(-2)).toStrictEqual([
      'refresh-release-failed',
      'store-close',
    ]);
  });

  it('reports a refresh-lock release failure once when a forced refresh is admitted at dispose', async () => {
    const result = await disposeDuringRefresh(
      (manager) => manager.forceRefreshToken('held', 'old-access', 'default'),
      (store) => {
        store.tokens.set('held:default', {
          ...freshToken('old-access'),
          access_token: 'old-access',
        });
        store.failNextRefreshRelease = true;
      },
      'refresh',
    );

    expect(result.caller).toBeInstanceOf(Error);
    expect((result.caller as Error).message).toBe(
      'refresh lock release failed',
    );
    expect(result.disposal).toBeInstanceOf(AggregateError);
    expect(countMessages(result.disposal, 'refresh lock release failed')).toBe(
      1,
    );
    expect(result.events.slice(-2)).toStrictEqual([
      'refresh-release-failed',
      'store-close',
    ]);
  });

  it('keeps provider errors and owner aborts out of disposal when the lock releases cleanly', async () => {
    const result = await disposeDuringRefresh(
      (manager) => manager.getToken('held', 'default'),
      (store) => {
        store.tokens.set('held:default', expiredToken('stale'));
      },
      'fail',
    );

    expect(result.caller).toBeInstanceOf(Error);
    expect(result.disposal).toBeUndefined();
    expect(result.events).not.toContain('refresh-release-failed');
    expect(result.events[result.events.length - 1]).toBe('store-close');
  });
});
