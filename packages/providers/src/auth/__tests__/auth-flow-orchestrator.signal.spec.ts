/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ISecureStore } from '@vybestack/llxprt-code-auth';
import { KeyringTokenStore } from '@vybestack/llxprt-code-core';
import { AuthFlowOrchestrator } from '../auth-flow-orchestrator.js';
import { ProviderRegistry } from '../provider-registry.js';
import type {
  BucketFailoverOAuthManagerLike,
  OAuthProvider,
  OAuthToken,
  TokenStore,
} from '../types.js';

function createInMemorySecureStore(): ISecureStore {
  const entries = new Map<string, string>();
  return {
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => void entries.set(key, value),
    delete: async (key) => entries.delete(key),
    list: async () => [...entries.keys()],
    has: async (key) => entries.has(key),
  };
}

function makeToken(accessToken: string): OAuthToken {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    token_type: 'Bearer',
    expiry: Math.floor(Date.now() / 1000) + 3600,
  };
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function createDeferred(): Deferred {
  let resolvePromise = (): void => {
    throw new Error('Deferred promise was not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

class GatedTokenStore extends KeyringTokenStore {
  private nextSaveGate:
    | { readonly started: Deferred; readonly release: Deferred }
    | undefined;

  private nextRemoveFailure: Error | undefined;

  failNextRemove(error: Error): void {
    this.nextRemoveFailure = error;
  }

  gateNextSave(): { readonly started: Deferred; readonly release: Deferred } {
    const gate = { started: createDeferred(), release: createDeferred() };
    this.nextSaveGate = gate;
    return gate;
  }

  override async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    const gate = this.nextSaveGate;
    if (gate) {
      this.nextSaveGate = undefined;
      gate.started.resolve();
      await gate.release.promise;
    }
    await super.saveToken(provider, token, bucket);
  }
  override async removeToken(provider: string, bucket?: string): Promise<void> {
    const failure = this.nextRemoveFailure;
    if (failure) {
      this.nextRemoveFailure = undefined;
      throw failure;
    }
    await super.removeToken(provider, bucket);
  }
}

class RecordingOAuthProvider implements OAuthProvider {
  readonly name = 'recording';
  private readonly receivedSignals: Array<AbortSignal | undefined> = [];
  private attempts = 0;

  constructor(private readonly firstFailure?: unknown) {}

  async initiateAuth(signal?: AbortSignal): Promise<OAuthToken> {
    this.receivedSignals.push(signal);
    this.attempts += 1;
    if (this.attempts === 1 && this.firstFailure !== undefined) {
      throw this.firstFailure;
    }
    return makeToken(`attempt-${this.attempts}`);
  }

  async getToken(): Promise<OAuthToken | null> {
    return null;
  }

  async refreshToken(): Promise<OAuthToken | null> {
    return null;
  }

  get signals(): ReadonlyArray<AbortSignal | undefined> {
    return [...this.receivedSignals];
  }

  get initiationCount(): number {
    return this.attempts;
  }
}

class GatedOAuthProvider implements OAuthProvider {
  readonly name = 'recording';
  readonly started = createDeferred();
  readonly refreshStarted = createDeferred();
  private readonly receivedSignals: Array<AbortSignal | undefined> = [];
  private attempts = 0;
  private pendingResolve: ((token: OAuthToken) => void) | undefined = undefined;
  private abortRejections: unknown[] = [];
  private refreshResolve: ((token: OAuthToken) => void) | undefined = undefined;
  private refreshDeferred = false;
  private autoComplete = false;

  deferNextRefresh(): void {
    this.refreshDeferred = true;
  }

  autoCompleteNext(): void {
    this.autoComplete = true;
  }

  complete(accessToken: string): void {
    this.pendingResolve?.(makeToken(accessToken));
  }

  resolveRefresh(token: OAuthToken): void {
    this.refreshResolve?.(token);
  }

  async initiateAuth(signal?: AbortSignal): Promise<OAuthToken> {
    this.attempts += 1;
    this.receivedSignals.push(signal);
    if (this.autoComplete) {
      this.autoComplete = false;
      return makeToken(`attempt-${this.attempts}`);
    }
    this.started.resolve();
    return new Promise<OAuthToken>((resolve, reject) => {
      this.pendingResolve = resolve;
      const onAbort = (): void => {
        this.abortRejections.push(signal?.reason);
        reject(signal?.reason);
      };
      if (signal?.aborted === true) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async getToken(): Promise<OAuthToken | null> {
    return null;
  }

  async refreshToken(): Promise<OAuthToken | null> {
    if (!this.refreshDeferred) {
      return null;
    }
    this.refreshDeferred = false;
    this.refreshStarted.resolve();
    return new Promise<OAuthToken>((resolve) => {
      this.refreshResolve = resolve;
    });
  }

  get signals(): ReadonlyArray<AbortSignal | undefined> {
    return [...this.receivedSignals];
  }

  get flightSignal(): AbortSignal | undefined {
    return this.receivedSignals[0];
  }

  get initiationCount(): number {
    return this.attempts;
  }

  get rejections(): readonly unknown[] {
    return [...this.abortRejections];
  }
}

/**
 * Token store whose first auth-lock acquisition is held until the test
 * releases it, so cancellation can arrive while the orchestrator waits.
 */
class LockGatedTokenStore extends KeyringTokenStore {
  private pendingLock:
    | { readonly resolve: (acquired: boolean) => void }
    | undefined;

  releaseLockAcquisition(acquired: boolean): void {
    this.pendingLock?.resolve(acquired);
    this.pendingLock = undefined;
  }

  override async acquireAuthLock(
    provider: string,
    options?: { waitMs?: number; bucket?: string },
  ): Promise<boolean> {
    void provider;
    void options;
    if (this.pendingLock === undefined) {
      return super.acquireAuthLock(provider, options);
    }
    return new Promise<boolean>((resolve) => {
      this.pendingLock = { resolve };
    });
  }
}

function createFacade(tokenStore: TokenStore): BucketFailoverOAuthManagerLike {
  return {
    getSessionBucket: () => undefined,
    setSessionBucket: () => {},
    getOAuthToken: async () => null,
    authenticate: async () => {},
    authenticateMultipleBuckets: async () => {},
    getTokenStore: () => tokenStore,
    forceRefreshToken: async () => null,
  };
}

/**
 * @plan PLAN-20260827-ISSUE2562.P02
 * @requirement REQ-2562-2
 */
describe('AuthFlowOrchestrator signal threading', () => {
  let tempDir: string;
  let tokenStore: KeyringTokenStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'auth-flow-signal-'));
    tokenStore = new KeyringTokenStore({
      secureStore: createInMemorySecureStore(),
      lockDir: join(tempDir, 'locks'),
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createOrchestratorHarness(provider: OAuthProvider): {
    readonly orchestrator: AuthFlowOrchestrator;
    readonly registry: ProviderRegistry;
  } {
    const registry = new ProviderRegistry();
    registry.registerProvider(provider);
    return {
      orchestrator: new AuthFlowOrchestrator(
        tokenStore,
        registry,
        createFacade(tokenStore),
      ),
      registry,
    };
  }

  function createOrchestrator(provider: OAuthProvider): AuthFlowOrchestrator {
    return createOrchestratorHarness(provider).orchestrator;
  }

  /**
   * Waits until the auth lock for provider/bucket is acquirable, i.e. the
   * previous attempt's asynchronous lock release (file I/O in its finally
   * block) has completed. A human-triggered retry always lands after this
   * point; a synchronous test retry would race it.
   */
  async function waitForAuthLockRelease(
    provider: string,
    bucket: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const acquired = await tokenStore.acquireAuthLock(provider, { bucket });
      if (acquired === true) {
        await tokenStore.releaseAuthLock(provider, bucket);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error(
      `Auth lock for ${provider}/${bucket} was never released after cancellation`,
    );
  }

  it('passes the caller signal to the provider', async () => {
    const provider = new RecordingOAuthProvider();
    const orchestrator = createOrchestrator(provider);
    const controller = new AbortController();

    await orchestrator.authenticate('recording', 'work', {
      signal: controller.signal,
    });

    expect(provider.signals).toStrictEqual([controller.signal]);
  });

  it('releases the auth lock after an abort rejection so a retry can proceed', async () => {
    const cancellation = new DOMException('host cancelled auth', 'AbortError');
    const provider = new RecordingOAuthProvider(cancellation);
    const orchestrator = createOrchestrator(provider);
    const controller = new AbortController();

    await expect(
      orchestrator.authenticate('recording', 'work', {
        signal: controller.signal,
      }),
    ).rejects.toBe(cancellation);
    await orchestrator.authenticate('recording', 'work');

    expect(provider.initiationCount).toBe(2);
    expect((await tokenStore.getToken('recording', 'work'))?.access_token).toBe(
      'attempt-2',
    );
  });

  it('restores the prior credential when cancellation races with persistence', async () => {
    const gatedStore = new GatedTokenStore({
      secureStore: createInMemorySecureStore(),
      lockDir: join(tempDir, 'gated-locks'),
    });
    tokenStore = gatedStore;
    const priorToken: OAuthToken = {
      access_token: 'prior-token',
      token_type: 'Bearer',
      expiry: 1,
    };
    await gatedStore.saveToken('recording', priorToken, 'work');
    const gate = gatedStore.gateNextSave();
    const provider = new RecordingOAuthProvider();
    const { orchestrator, registry } = createOrchestratorHarness(provider);
    const controller = new AbortController();
    const cancellation = new DOMException('host cancelled auth', 'AbortError');

    const authentication = orchestrator.authenticate('recording', 'work', {
      signal: controller.signal,
    });
    await gate.started.promise;
    controller.abort(cancellation);
    gate.release.resolve();

    await expect(authentication).rejects.toBe(cancellation);
    expect(await gatedStore.getToken('recording', 'work')).toEqual(priorToken);
    expect(registry.isOAuthEnabled('recording')).toBe(false);
  });

  it('removes a newly persisted credential when cancellation races with its first save', async () => {
    const gatedStore = new GatedTokenStore({
      secureStore: createInMemorySecureStore(),
      lockDir: join(tempDir, 'gated-empty-locks'),
    });
    tokenStore = gatedStore;
    const gate = gatedStore.gateNextSave();
    const provider = new RecordingOAuthProvider();
    const { orchestrator, registry } = createOrchestratorHarness(provider);
    const controller = new AbortController();
    const cancellation = new DOMException('host cancelled auth', 'AbortError');

    const authentication = orchestrator.authenticate('recording', 'work', {
      signal: controller.signal,
    });
    await gate.started.promise;
    controller.abort(cancellation);
    gate.release.resolve();

    await expect(authentication).rejects.toBe(cancellation);
    expect(await gatedStore.getToken('recording', 'work')).toBeNull();
    expect(registry.isOAuthEnabled('recording')).toBe(false);
  });

  it('preserves the cancellation reason when rollback storage fails', async () => {
    const gatedStore = new GatedTokenStore({
      secureStore: createInMemorySecureStore(),
      lockDir: join(tempDir, 'gated-failing-rollback-locks'),
    });
    tokenStore = gatedStore;
    const gate = gatedStore.gateNextSave();
    gatedStore.failNextRemove(new Error('rollback storage unavailable'));
    const provider = new RecordingOAuthProvider();
    const { orchestrator, registry } = createOrchestratorHarness(provider);
    const controller = new AbortController();
    const cancellation = new DOMException('host cancelled auth', 'AbortError');

    const authentication = orchestrator.authenticate('recording', 'work', {
      signal: controller.signal,
    });
    await gate.started.promise;
    controller.abort(cancellation);
    gate.release.resolve();

    await expect(authentication).rejects.toBe(cancellation);
    expect(registry.isOAuthEnabled('recording')).toBe(false);
  });

  it('runs signal-less callers on an un-aborted flight signal', async () => {
    // @plan PLAN-20260827-ISSUE2562.P04
    // @requirement REQ-2562-2
    // Signal-less callers cannot detach, so the flight signal they run on
    // must never be aborted on their behalf — their flow completes normally.
    const provider = new RecordingOAuthProvider();
    const orchestrator = createOrchestrator(provider);

    await orchestrator.authenticate('recording', 'work');

    expect(provider.signals.length).toBe(1);
    const flightSignal = provider.signals[0];
    expect(flightSignal).toBeDefined();
    expect(flightSignal?.aborted).toBe(false);
    expect((await tokenStore.getToken('recording', 'work'))?.access_token).toBe(
      'attempt-1',
    );
  });

  it('aborts the in-flight provider flow with the caller reason and keeps the reason on retry', async () => {
    // @plan PLAN-20260827-ISSUE2562.P04
    // @requirement REQ-2562-2
    // The provider must stay pending until the flight signal aborts, then
    // reject with the caller's reason — proving the signal actually reaches
    // the flow. The auth lock must be released so a retry succeeds.
    const cancellation = new DOMException('host cancelled auth', 'AbortError');
    const provider = new GatedOAuthProvider();
    const orchestrator = createOrchestrator(provider);
    const controller = new AbortController();

    const authentication = orchestrator.authenticate('recording', 'work', {
      signal: controller.signal,
    });
    await provider.started.promise;
    controller.abort(cancellation);

    await expect(authentication).rejects.toBe(cancellation);
    expect(provider.rejections).toStrictEqual([cancellation]);
    await waitForAuthLockRelease('recording', 'work');

    provider.autoCompleteNext();
    await orchestrator.authenticate('recording', 'work');
    expect(provider.initiationCount).toBe(2);
    expect((await tokenStore.getToken('recording', 'work'))?.access_token).toBe(
      'attempt-2',
    );
  });

  it('detaching one joined caller leaves the shared flight alive for the others', async () => {
    // @plan PLAN-20260827-ISSUE2562.P04
    // @requirement REQ-2562-2
    // A signal-bearing joiner detaches with its own reason; the underlying
    // flight keeps running for the signal-less owner and commits its token.
    const joinerCancellation = new DOMException(
      'joiner cancelled auth',
      'AbortError',
    );
    const provider = new GatedOAuthProvider();
    const orchestrator = createOrchestrator(provider);

    const owner = orchestrator.authenticate('recording', 'work');
    await provider.started.promise;
    const joinerController = new AbortController();
    const joiner = orchestrator.authenticate('recording', 'work', {
      signal: joinerController.signal,
    });

    joinerController.abort(joinerCancellation);
    await expect(joiner).rejects.toBe(joinerCancellation);
    expect(provider.flightSignal?.aborted).toBe(false);
    expect(provider.initiationCount).toBe(1);

    provider.complete('shared-token');
    await owner;

    expect((await tokenStore.getToken('recording', 'work'))?.access_token).toBe(
      'shared-token',
    );
    expect(provider.initiationCount).toBe(1);
  });

  it('the last departing caller aborts the orphaned shared flight with its own reason', async () => {
    // @plan PLAN-20260827-ISSUE2562.P04
    // @requirement REQ-2562-2
    // When every participant departs while the flow is still running, the
    // last one's reason aborts the flight; no credential is persisted and a
    // fresh caller can retry immediately.
    const firstCancellation = new DOMException(
      'first caller cancelled auth',
      'AbortError',
    );
    const lastCancellation = new DOMException(
      'last caller cancelled auth',
      'AbortError',
    );
    const provider = new GatedOAuthProvider();
    const orchestrator = createOrchestrator(provider);
    const firstController = new AbortController();
    const lastController = new AbortController();

    const first = orchestrator.authenticate('recording', 'work', {
      signal: firstController.signal,
    });
    await provider.started.promise;
    const last = orchestrator.authenticate('recording', 'work', {
      signal: lastController.signal,
    });

    firstController.abort(firstCancellation);
    await expect(first).rejects.toBe(firstCancellation);
    expect(provider.flightSignal?.aborted).toBe(false);

    lastController.abort(lastCancellation);
    await expect(last).rejects.toBe(lastCancellation);
    expect(provider.rejections).toStrictEqual([lastCancellation]);
    expect(await tokenStore.getToken('recording', 'work')).toBeNull();
    await waitForAuthLockRelease('recording', 'work');

    provider.autoCompleteNext();
    await orchestrator.authenticate('recording', 'work');
    expect(provider.initiationCount).toBe(2);
  });

  it('does not commit a refreshed credential when the caller aborts during the refresh', async () => {
    // @plan PLAN-20260827-ISSUE2562.P04
    // @requirement REQ-2562-2
    // The pre-browser refresh path honors cancellation: the refresh result
    // is discarded, the stored credential stays as it was, and no browser
    // flow starts.
    const cancellation = new DOMException('host cancelled auth', 'AbortError');
    const expiredToken: OAuthToken = {
      access_token: 'expired-token',
      refresh_token: 'expired-refresh',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) - 60,
    };
    await tokenStore.saveToken('recording', expiredToken, 'work');
    const provider = new GatedOAuthProvider();
    provider.deferNextRefresh();
    const orchestrator = createOrchestrator(provider);
    const controller = new AbortController();

    const authentication = orchestrator.authenticate('recording', 'work', {
      signal: controller.signal,
    });
    await provider.refreshStarted.promise;
    controller.abort(cancellation);
    provider.resolveRefresh(makeToken('refreshed-token'));

    await expect(authentication).rejects.toBe(cancellation);
    expect(await tokenStore.getToken('recording', 'work')).toStrictEqual(
      expiredToken,
    );
    expect(provider.initiationCount).toBe(0);
  });

  it('honors cancellation that arrives while waiting for the auth lock', async () => {
    // @plan PLAN-20260827-ISSUE2562.P04
    // @requirement REQ-2562-2
    // A caller cancelled during the (bounded, not signal-aware) lock wait
    // must not silently proceed to a successful flow once the lock opens.
    const cancellation = new DOMException('host cancelled auth', 'AbortError');
    const gatedStore = new LockGatedTokenStore({
      secureStore: createInMemorySecureStore(),
      lockDir: join(tempDir, 'lock-wait-locks'),
    });
    tokenStore = gatedStore;
    const provider = new RecordingOAuthProvider();
    const orchestrator = new AuthFlowOrchestrator(
      gatedStore,
      (() => {
        const registry = new ProviderRegistry();
        registry.registerProvider(provider);
        return registry;
      })(),
      createFacade(gatedStore),
    );
    const controller = new AbortController();

    const authentication = orchestrator.authenticate('recording', 'work', {
      signal: controller.signal,
    });
    controller.abort(cancellation);
    gatedStore.releaseLockAcquisition(true);

    await expect(authentication).rejects.toBe(cancellation);
    expect(provider.initiationCount).toBe(0);
  });
});
