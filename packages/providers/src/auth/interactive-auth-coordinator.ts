/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { oauthUIBridge, type OAuthUIEvent } from '@vybestack/llxprt-code-auth';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { RuntimeKind } from '../runtime/active-runtime-identity.js';

const logger = new DebugLogger('llxprt:auth:interactive-coordinator');

export const DEFAULT_INTERACTIVE_AUTH_TIMEOUT_MS = 1_200_000;

/**
 * Runtime kinds that may request interactive auth. `'unregistered'` is a
 * declared sentinel for callers running outside any registered runtime
 * scope; consumers displaying the requester must treat it as valid.
 */
export type InteractiveAuthRequesterKind = RuntimeKind | 'unregistered';

export type InteractiveAuthOutcomeKind =
  | 'succeeded'
  | 'cancelled'
  | 'failed'
  | 'timed_out';

export type InteractiveAuthReason =
  | 'authentication-required'
  | 'reauthentication-required';

export interface InteractiveAuthChallenge {
  readonly provider: string;
  readonly bucket: string;
  readonly requester: {
    readonly runtimeKind: InteractiveAuthRequesterKind;
    readonly runtimeId?: string;
    readonly taskId?: string;
  };
  readonly reason: InteractiveAuthReason;
  readonly correlationId: string;
}

export interface InteractiveAuthOutcome {
  readonly kind: InteractiveAuthOutcomeKind;
  readonly correlationId: string;
  readonly error?: Error;
}

export type InteractiveAuthHostHandler = (
  challenge: InteractiveAuthChallenge,
  sessionSignal: AbortSignal,
) => Promise<void>;

export interface InteractiveAuthRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface InteractiveAuthSessionStatus {
  readonly provider: string;
  readonly bucket: string;
  readonly waiterCount: number;
  readonly startedAtMs: number;
}

export interface InteractiveAuthStateChangeEvent {
  readonly type: 'waiting' | 'settled';
  readonly provider: string;
  readonly bucket: string;
  readonly waiterCount: number;
  readonly kind?: InteractiveAuthOutcomeKind;
}

export type InteractiveAuthStateChangeListener = (
  event: InteractiveAuthStateChangeEvent,
) => void;

export class InteractiveAuthError extends Error {
  constructor(
    message: string,
    readonly outcomeKind: InteractiveAuthOutcomeKind,
    readonly correlationId: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InteractiveAuthUnavailableError extends InteractiveAuthError {
  constructor(challenge: InteractiveAuthChallenge) {
    super(
      `No interactive host is available to run ${challenge.provider}/${challenge.bucket} authentication. Run \`/auth ${challenge.provider}\` from the interactive host session.`,
      'failed',
      challenge.correlationId,
    );
  }
}

export class InteractiveAuthHostUnavailableError extends InteractiveAuthError {
  constructor(challenge: InteractiveAuthChallenge, cause: unknown) {
    super(
      `The interactive host could not access OAuth infrastructure for ${challenge.provider}/${challenge.bucket}: ${cause instanceof Error ? cause.message : String(cause)}`,
      'failed',
      challenge.correlationId,
    );
  }
}

export class InteractiveAuthCancelledError extends InteractiveAuthError {
  constructor(message: string, correlationId: string) {
    super(message, 'cancelled', correlationId);
  }
}

interface InteractiveAuthWaiter {
  readonly correlationId: string;
  readonly requesterRuntimeKind: string;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (outcome: InteractiveAuthOutcome) => void;
  abortListener: (() => void) | undefined;
  settled: boolean;
}

interface InteractiveAuthSession {
  readonly key: string;
  readonly challenge: InteractiveAuthChallenge;
  readonly controller: AbortController;
  readonly waiters: Set<InteractiveAuthWaiter>;
  readonly startedAtMs: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  settled: boolean;
}

function sessionKey(provider: string, bucket: string): string {
  return `${provider}::${bucket}`;
}

function copyChallenge(
  challenge: InteractiveAuthChallenge,
): InteractiveAuthChallenge {
  const { runtimeKind, runtimeId, taskId } = challenge.requester;
  return {
    provider: challenge.provider,
    bucket: challenge.bucket,
    requester: {
      runtimeKind,
      ...(runtimeId === undefined ? {} : { runtimeId }),
      ...(taskId === undefined ? {} : { taskId }),
    },
    reason: challenge.reason,
    correlationId: challenge.correlationId,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createAbortReason(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

/**
 * Coordinates host-owned authentication and waiter lifetimes for one process.
 *
 * @plan PLAN-20260827-ISSUE2562.P01
 * @requirement REQ-2562-1
 */
export class InteractiveAuthCoordinator {
  private hostHandler: InteractiveAuthHostHandler | undefined;
  private readonly sessions = new Map<string, InteractiveAuthSession>();
  private readonly listeners = new Set<InteractiveAuthStateChangeListener>();

  bindHost(handler: InteractiveAuthHostHandler): void {
    this.hostHandler = handler;
  }

  unbindHost(): void {
    this.hostHandler = undefined;
  }

  hasHost(): boolean {
    return this.hostHandler !== undefined;
  }

  requestAuth(
    challenge: InteractiveAuthChallenge,
    opts: InteractiveAuthRequestOptions = {},
  ): Promise<InteractiveAuthOutcome> {
    const handler = this.hostHandler;
    if (!handler) {
      return Promise.reject(new InteractiveAuthUnavailableError(challenge));
    }

    if (opts.signal?.aborted === true) {
      return Promise.resolve({
        kind: 'cancelled',
        correlationId: challenge.correlationId,
      });
    }

    const key = sessionKey(challenge.provider, challenge.bucket);
    const activeSession = this.sessions.get(key);
    if (activeSession) {
      const { waiter, outcome } = this.registerWaiter(
        activeSession,
        challenge,
        opts.signal,
      );
      this.notifyWaiting(activeSession, waiter);
      return outcome;
    }

    const session: InteractiveAuthSession = {
      key,
      challenge: copyChallenge(challenge),
      controller: new AbortController(),
      waiters: new Set<InteractiveAuthWaiter>(),
      startedAtMs: Date.now(),
      timer: undefined,
      settled: false,
    };
    this.sessions.set(key, session);
    // Register the waiter and start the attempt BEFORE emitting any event:
    // observers (state listeners, the OAuth UI bridge) may synchronously
    // re-enter cancelActiveSessions(), so no notification may fire while the
    // session is still half-constructed.
    const { waiter, outcome } = this.registerWaiter(
      session,
      challenge,
      opts.signal,
    );
    this.startSession(
      session,
      handler,
      opts.timeoutMs ?? DEFAULT_INTERACTIVE_AUTH_TIMEOUT_MS,
    );
    this.notifyWaiting(session, waiter);
    return outcome;
  }

  cancelActiveSessions(
    reason = 'Interactive authentication cancelled',
  ): number {
    const activeSessions = [...this.sessions.values()];
    for (const session of activeSessions) {
      this.settleSession(
        session,
        'cancelled',
        undefined,
        createAbortReason(reason),
      );
    }
    return activeSessions.length;
  }

  async dispose(): Promise<void> {
    this.cancelActiveSessions(
      'Interactive authentication coordinator disposed',
    );
  }

  getActiveSessions(): readonly InteractiveAuthSessionStatus[] {
    return [...this.sessions.values()].map((session) => ({
      provider: session.challenge.provider,
      bucket: session.challenge.bucket,
      waiterCount: session.waiters.size,
      startedAtMs: session.startedAtMs,
    }));
  }

  onStateChange(listener: InteractiveAuthStateChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private registerWaiter(
    session: InteractiveAuthSession,
    challenge: InteractiveAuthChallenge,
    signal: AbortSignal | undefined,
  ): {
    waiter: InteractiveAuthWaiter;
    outcome: Promise<InteractiveAuthOutcome>;
  } {
    let resolveOutcome: (outcome: InteractiveAuthOutcome) => void;
    const outcome = new Promise<InteractiveAuthOutcome>((resolve) => {
      resolveOutcome = resolve;
    });
    const waiter: InteractiveAuthWaiter = {
      correlationId: challenge.correlationId,
      requesterRuntimeKind: challenge.requester.runtimeKind,
      signal,
      resolve: resolveOutcome!,
      abortListener: undefined,
      settled: false,
    };
    if (signal) {
      const abortListener = (): void => {
        this.detachWaiter(session, waiter);
      };
      waiter.abortListener = abortListener;
      signal.addEventListener('abort', abortListener, { once: true });
    }
    session.waiters.add(waiter);
    return { waiter, outcome };
  }

  /**
   * Emits the waiting notifications for a registered waiter. May re-enter the
   * coordinator synchronously (listeners can call cancelActiveSessions), so
   * callers must only invoke it on a fully started session and tolerate the
   * session becoming terminal during the call.
   */
  private notifyWaiting(
    session: InteractiveAuthSession,
    waiter: InteractiveAuthWaiter,
  ): void {
    if (waiter.settled || session.settled) {
      return;
    }
    this.emitStateChange({
      type: 'waiting',
      provider: session.challenge.provider,
      bucket: session.challenge.bucket,
      waiterCount: session.waiters.size,
    });
    this.emitOAuthUIEvent({
      type: 'oauth_waiting',
      provider: session.challenge.provider,
      bucket: session.challenge.bucket,
      requesterRuntimeKind: waiter.requesterRuntimeKind,
      correlationId: waiter.correlationId,
      waiterCount: session.waiters.size,
    });
  }

  private startSession(
    session: InteractiveAuthSession,
    handler: InteractiveAuthHostHandler,
    timeoutMs: number,
  ): void {
    // A re-entrant cancel may already have settled the session (for example
    // via an earlier waiter notification); never start a terminal session.
    if (session.settled || this.sessions.get(session.key) !== session) {
      return;
    }

    session.timer = setTimeout(() => {
      this.settleSession(
        session,
        'timed_out',
        undefined,
        createAbortReason('Interactive authentication timed out'),
      );
    }, timeoutMs);

    const handlerPromise = Promise.resolve().then(() =>
      handler(session.challenge, session.controller.signal),
    );
    void handlerPromise.catch(() => undefined);
    void handlerPromise
      .then(
        () => {
          this.settleSession(session, 'succeeded');
        },
        (error: unknown) => {
          if (isAbortError(error)) {
            this.settleSession(
              session,
              'cancelled',
              undefined,
              createAbortReason('Interactive authentication was aborted'),
            );
            return;
          }
          this.settleSession(session, 'failed', toError(error));
        },
      )
      .catch(() => undefined);
  }

  private detachWaiter(
    session: InteractiveAuthSession,
    waiter: InteractiveAuthWaiter,
  ): void {
    if (session.settled || waiter.settled) {
      return;
    }

    session.waiters.delete(waiter);
    this.settleWaiter(session, waiter, 'cancelled', session.waiters.size);
    if (session.waiters.size === 0) {
      this.settleSession(
        session,
        'cancelled',
        undefined,
        createAbortReason('Interactive authentication has no active waiters'),
      );
      return;
    }

    // settleWaiter emits synchronously, so a listener can settle the session
    // re-entrantly. settleSession removes the session from the registry, so
    // this identity check catches that without announcing that a terminal
    // session is still waiting.
    if (this.sessions.get(session.key) !== session) {
      return;
    }

    this.emitStateChange({
      type: 'waiting',
      provider: session.challenge.provider,
      bucket: session.challenge.bucket,
      waiterCount: session.waiters.size,
    });
  }

  private settleSession(
    session: InteractiveAuthSession,
    kind: InteractiveAuthOutcomeKind,
    error?: Error,
    abortReason?: unknown,
  ): void {
    if (session.settled || this.sessions.get(session.key) !== session) {
      return;
    }

    session.settled = true;
    this.sessions.delete(session.key);
    if (session.timer !== undefined) {
      clearTimeout(session.timer);
      session.timer = undefined;
    }
    if (!session.controller.signal.aborted) {
      session.controller.abort(
        abortReason ??
          error ??
          createAbortReason(`Interactive authentication settled as ${kind}`),
      );
    }

    const waiterCount = session.waiters.size;
    for (const waiter of session.waiters) {
      this.settleWaiter(session, waiter, kind, waiterCount, error);
    }
    session.waiters.clear();
    this.emitStateChange({
      type: 'settled',
      provider: session.challenge.provider,
      bucket: session.challenge.bucket,
      waiterCount,
      kind,
    });
  }

  private settleWaiter(
    session: InteractiveAuthSession,
    waiter: InteractiveAuthWaiter,
    kind: InteractiveAuthOutcomeKind,
    waiterCount: number,
    error?: Error,
  ): void {
    if (waiter.settled) {
      return;
    }

    waiter.settled = true;
    if (waiter.signal && waiter.abortListener) {
      waiter.signal.removeEventListener('abort', waiter.abortListener);
      waiter.abortListener = undefined;
    }
    waiter.resolve({
      kind,
      correlationId: waiter.correlationId,
      ...(error === undefined ? {} : { error }),
    });
    this.emitOAuthUIEvent({
      type: 'oauth_settled',
      provider: session.challenge.provider,
      bucket: session.challenge.bucket,
      requesterRuntimeKind: waiter.requesterRuntimeKind,
      correlationId: waiter.correlationId,
      waiterCount,
      kind,
    });
  }

  /**
   * @plan PLAN-20260827-ISSUE2562.P05
   * @requirement REQ-2562-4
   */
  private emitOAuthUIEvent(event: OAuthUIEvent): void {
    try {
      oauthUIBridge.emit(event);
    } catch (error) {
      logger.debug(
        () =>
          `Failed to emit interactive authentication UI event: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private emitStateChange(event: InteractiveAuthStateChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // State listeners are external observers and cannot own coordinator state.
      }
    }
  }
}

export const interactiveAuthCoordinator = new InteractiveAuthCoordinator();
