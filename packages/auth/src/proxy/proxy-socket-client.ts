/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unix domain socket client for credential proxy protocol.
 *
 * @plan PLAN-20260731-GHBROKER.P05
 * @requirement REQ-006, REQ-007
 * @pseudocode 002-frame-and-cancel.md lines 12-66
 */

import * as net from 'node:net';
import * as crypto from 'node:crypto';
import { encodeFrame, FrameDecoder } from './framing.js';

export const REQUEST_TIMEOUT_MS = 30000;
export const IDLE_TIMEOUT_MS = 300000;
export const PROTOCOL_VERSION = 2;

export type ProxyResponse = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  code?: string;
  retryAfter?: number;
};

/**
 * Per-request options controlling timeout and cancellation.
 *
 * @plan PLAN-20260731-GHBROKER.P05
 * @requirement REQ-007
 * @pseudocode 002-frame-and-cancel.md lines 12-32, Contract
 */
export interface RequestOptions {
  /** Per-op timeout override (ms). Defaults to REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Caller-supplied abort signal (Ctrl+C). Sends a cancel frame on abort. */
  signal?: AbortSignal;
}

/** Validates that a decoded frame has the shape of a ProxyResponse, guarding
 *  against adversarial or malformed server responses with unexpected types
 *  for `ok`, `code`, or `error`. */
function isProxyResponseFrame(
  frame: Record<string, unknown>,
): frame is ProxyResponse {
  if (typeof frame.ok !== 'boolean') return false;
  if (frame.code !== undefined && typeof frame.code !== 'string') return false;
  if (frame.error !== undefined && typeof frame.error !== 'string')
    return false;
  if (frame.retryAfter !== undefined && typeof frame.retryAfter !== 'number')
    return false;
  if (
    frame.data !== undefined &&
    (typeof frame.data !== 'object' ||
      frame.data === null ||
      Array.isArray(frame.data))
  )
    return false;
  return true;
}

interface PendingRequest {
  resolve: (value: ProxyResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ProxySocketClient {
  private readonly socketPath: string;
  private readonly capabilityToken: string | undefined;
  private socket: net.Socket | null = null;
  private decoder: FrameDecoder = new FrameDecoder({
    onPartialFrameTimeout: () => this.handlePartialFrameTimeout(),
  });
  private pendingRequests: Map<string, PendingRequest> = new Map();
  /**
   * Detaches abort listeners for requests that settle without aborting.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-007
   */
  private abortCleanups: Map<string, () => void> = new Map();

  /**
   * Detaches and forgets the abort listener for a settled request.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-007
   */
  private releaseAbortCleanup(id: string): void {
    const cleanup = this.abortCleanups.get(id);
    if (cleanup) {
      cleanup();
      this.abortCleanups.delete(id);
    }
  }

  /**
   * Detaches every outstanding abort listener. Used when the connection is
   * torn down and all pending requests are rejected at once.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-007
   */
  private releaseAllAbortCleanups(): void {
    for (const cleanup of this.abortCleanups.values()) cleanup();
    this.abortCleanups.clear();
  }
  private handshakeComplete: boolean = false;
  /**
   * Protocol version negotiated with the server during handshake. A v1
   * server returns version 1; a v2 server returns 2. This is used to gate
   * frame-size expectations on responses (v1 cannot receive >64 KiB).
   *
   * @plan PLAN-20260731-GHBROKER.P05
   * @requirement REQ-006
   * @pseudocode 002-frame-and-cancel.md lines 67-76
   */
  private _negotiatedVersion: number = PROTOCOL_VERSION;

  /** The protocol version negotiated during handshake (read-only). */
  get negotiatedVersion(): number {
    return this._negotiatedVersion;
  }
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private connectingPromise: Promise<void> | null = null;
  private handshakeResolver: {
    resolve: (value: ProxyResponse) => void;
    reject: (reason: Error) => void;
  } | null = null;

  constructor(socketPath: string, capabilityToken?: string) {
    this.socketPath = socketPath;
    this.capabilityToken = capabilityToken;
  }

  async ensureConnected(): Promise<void> {
    if (this.socket !== null && this.handshakeComplete) {
      this.resetIdleTimer();
      return;
    }
    if (this.connectingPromise) {
      await this.connectingPromise;
      return;
    }
    this.connectingPromise = this.connectAndHandshake();
    try {
      await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }

  private isConnected(): boolean {
    return this.socket !== null && this.handshakeComplete;
  }

  /**
   * Sends a request op with optional timeout override and cancellation
   * signal. Resolves with the server response or rejects on timeout /
   * cancellation / connection error.
   *
   * @plan PLAN-20260731-GHBROKER.P05
   * @requirement REQ-007
   * @pseudocode 002-frame-and-cancel.md lines 12-32
   */
  async request(
    op: string,
    payload: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<ProxyResponse> {
    if (!this.isConnected()) {
      await this.ensureConnected();
    } else {
      this.resetIdleTimer();
    }
    return this.sendRequest(op, payload, options);
  }

  /**
   * Builds and sends a request frame, registering the pending entry with a
   * per-op timeout. On timeout, sends a cancel frame before rejecting so
   * host-side work is freed. If an abort signal is provided, wires the
   * abort handler to cancel + reject.
   *
   * @plan PLAN-20260731-GHBROKER.P05
   * @requirement REQ-007
   * @pseudocode 002-frame-and-cancel.md lines 14-20, 38-41
   */
  private sendRequest(
    op: string,
    payload: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<ProxyResponse> {
    const id = crypto.randomUUID();
    // Post-handshake frames carry the NEGOTIATED version, not our maximum.
    // Against a v1 peer, sending v: 2 here makes every request unparseable
    // and the connection silently useless — which is exactly the case the
    // negotiation exists to handle.
    const frame = { v: this._negotiatedVersion, id, op, payload };
    const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;

    const promise = new Promise<ProxyResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        this.releaseAbortCleanup(id);
        this.cancel(id);
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
        // resetIdleTimer returned early while this request was pending, so
        // without re-arming here a timed-out request leaves the connection
        // with no idle timer at all and it never closes.
        this.maybeArmIdleTimer();
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timer });
    });

    // Wire abort signal: on abort, delete the pending entry, send a cancel
    // frame, and reject with 'Request cancelled'.
    if (options?.signal) {
      const signal = options.signal;
      if (signal.aborted) {
        // Mirror the abort handler below exactly. Dropping the entry without
        // clearing its timer left the timeout armed to fire against a
        // request that no longer exists, and skipping maybeArmIdleTimer
        // meant a connection whose last request was pre-aborted would never
        // idle-close.
        const pending = this.pendingRequests.get(id);
        if (pending) clearTimeout(pending.timer);
        this.pendingRequests.delete(id);
        this.releaseAbortCleanup(id);
        // Cannot await here — fire-and-forget the cancel frame.
        this.cancel(id);
        this.maybeArmIdleTimer();
        return Promise.reject(new Error('Request cancelled'));
      }
      const abortHandler = (): void => {
        const pending = this.pendingRequests.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(id);
          this.releaseAbortCleanup(id);
          this.cancel(id);
          pending.reject(new Error('Request cancelled'));
          this.maybeArmIdleTimer();
        }
      };
      signal.addEventListener('abort', abortHandler, { once: true });
      // `once` only removes the listener if it actually fires. A request
      // that settles normally would otherwise leave it attached, and a
      // long-lived or reused signal — a session-level controller, say —
      // would accumulate one listener per request.
      this.abortCleanups.set(id, () =>
        signal.removeEventListener('abort', abortHandler),
      );
    }

    this.socket!.write(encodeFrame(frame));
    this.resetIdleTimer();
    return promise;
  }

  /**
   * Sends a cancel frame for the given request id, asking the server to
   * abort host-side work. Idempotent — if the connection is down it is a
   * no-op.
   *
   * @plan PLAN-20260731-GHBROKER.P05
   * @requirement REQ-007
   * @pseudocode 002-frame-and-cancel.md lines 33-36
   */
  cancel(id: string): void {
    if (!this.isConnected()) return;
    const cancelFrame = {
      v: this._negotiatedVersion,
      id: crypto.randomUUID(),
      op: 'cancel',
      payload: { targetId: id },
    };
    this.socket!.write(encodeFrame(cancelFrame));
  }

  close(): void {
    this.cancelIdleTimer();
    this.destroy('Client closed');
  }

  gracefulClose(): void {
    this.handshakeComplete = false;
    // Reject any pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection closing'));
    }
    this.pendingRequests.clear();
    this.releaseAllAbortCleanups();
    if (this.handshakeResolver) {
      const resolver = this.handshakeResolver;
      this.handshakeResolver = null;
      resolver.reject(new Error('Connection closing'));
    }
    if (this.socket !== null) {
      // Remove listeners to prevent stale close events from affecting new connections
      this.socket.removeAllListeners();
      this.socket.end();
      this.socket = null;
    }
    this.decoder.reset();
  }

  private async connectAndHandshake(): Promise<void> {
    try {
      await this.connect();
      await this.handshake();
    } catch (err) {
      try {
        this.destroy(err instanceof Error ? err.message : 'Handshake failed');
      } catch {
        // Swallow cleanup errors so the original failure is not masked
      }
      throw err;
    }
  }

  private async connect(): Promise<void> {
    this.socket = net.createConnection(this.socketPath);
    this.decoder = new FrameDecoder({
      onPartialFrameTimeout: () => this.handlePartialFrameTimeout(),
    });
    this.socket.on('data', (chunk: Buffer) => this.onData(chunk));
    this.socket.on('error', (err: Error) => this.onError(err));
    this.socket.on('end', () => this.onClose());
    this.socket.on('close', () => this.onClose());
    await new Promise<void>((resolve, reject) => {
      this.socket!.once('connect', resolve);
      this.socket!.once('error', reject);
    });
    this.socket.unref();
  }

  /**
   * Performs the protocol handshake. Advertises support for versions 1-2
   * so a v1 server negotiates down to v1 and a v2 server negotiates up.
   * Records the negotiated version to gate frame-size expectations.
   *
   * @plan PLAN-20260731-GHBROKER.P05
   * @requirement REQ-006
   * @pseudocode 002-frame-and-cancel.md lines 67-76
   */
  private async handshake(): Promise<void> {
    const payload: Record<string, unknown> = { minVersion: 1, maxVersion: 2 };
    if (this.capabilityToken) {
      payload.capabilityToken = this.capabilityToken;
    }
    const request = {
      v: PROTOCOL_VERSION,
      op: 'handshake',
      payload,
    };
    this.socket!.write(encodeFrame(request));

    const response = await new Promise<ProxyResponse>((resolve, reject) => {
      this.handshakeResolver = { resolve, reject };
      const timer = setTimeout(() => {
        this.handshakeResolver = null;
        reject(new Error(`Handshake timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      const originalResolve = this.handshakeResolver.resolve;
      this.handshakeResolver.resolve = (value) => {
        clearTimeout(timer);
        originalResolve(value);
      };
      const originalReject = this.handshakeResolver.reject;
      this.handshakeResolver.reject = (reason) => {
        clearTimeout(timer);
        originalReject(reason);
      };
    });

    if (response.ok !== true) {
      if (response.code === 'UNAUTHORIZED') {
        throw new Error(
          'Credential proxy authentication failed: ' +
            (response.error ?? 'invalid or missing capability token'),
        );
      }
      const codeInfo = response.code ? ` [${response.code}]` : '';
      throw new Error(
        'Handshake failed' +
          codeInfo +
          ': ' +
          (response.error ?? 'unknown error'),
      );
    }
    // Record the negotiated version from the server's handshake_ack.
    const serverVersion = response.data?.version as number | undefined;
    this._negotiatedVersion =
      typeof serverVersion === 'number' ? serverVersion : 1;
    this.handshakeComplete = true;
    this.resetIdleTimer();
  }

  private onData(chunk: Buffer): void {
    try {
      const frames = this.decoder.feed(chunk);
      for (const frame of frames) {
        if (this.processFrame(frame)) return;
      }
    } catch {
      this.destroy('Frame decode error');
    }
  }

  /**
   * Processes a single decoded frame. Returns true if the socket was
   * destroyed and the caller should stop iterating.
   */
  private processFrame(frame: Record<string, unknown>): boolean {
    if (this.handshakeResolver) {
      this.resolveHandshake(frame);
      return this.socket === null;
    }
    this.resolvePendingRequest(frame);
    return this.socket === null;
  }

  private resolveHandshake(frame: Record<string, unknown>): void {
    const resolver = this.handshakeResolver;
    if (resolver === null) {
      return;
    }
    this.handshakeResolver = null;
    if (isProxyResponseFrame(frame)) {
      resolver.resolve(frame);
    } else {
      // Reject first, then clean up. destroy() will not double-reject
      // because handshakeResolver was already nulled above.
      resolver.reject(new Error('Malformed handshake response from proxy'));
      this.destroy('Malformed handshake response from proxy');
    }
  }

  /**
   * Resolves (or rejects) the pending request matching the response frame
   * id. After deleting, re-arms the idle timer if no requests remain, so a
   * genuinely idle connection still closes on schedule.
   *
   * @plan PLAN-20260731-GHBROKER.P05
   * @requirement REQ-007
   * @pseudocode 002-frame-and-cancel.md lines 30-32
   */
  private resolvePendingRequest(frame: Record<string, unknown>): void {
    const id = frame.id as string | undefined;
    if (!id) {
      return;
    }
    const pending = this.pendingRequests.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(id);
      this.releaseAbortCleanup(id);
      if (isProxyResponseFrame(frame)) {
        pending.resolve(frame);
      } else {
        pending.reject(new Error(`Malformed response for request ${id}`));
        this.destroy('Malformed response from proxy — connection reset');
        return;
      }
      this.maybeArmIdleTimer();
    }
  }

  private onError(_err: Error): void {
    this.destroy('Credential proxy connection lost. Restart the session.');
  }

  private onClose(): void {
    if (this.handshakeComplete || this.handshakeResolver) {
      this.destroy('Credential proxy connection lost. Restart the session.');
    }
  }

  private handlePartialFrameTimeout(): void {
    this.destroy(
      'Credential proxy partial frame timeout. Connection will be reset.',
    );
  }

  private destroy(message: string): void {
    this.cancelIdleTimer();

    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pendingRequests.clear();
    this.releaseAllAbortCleanups();

    this.handshakeComplete = false;

    if (this.socket !== null) {
      this.socket.destroy();
      this.socket = null;
    }
    this.decoder.reset();

    if (this.handshakeResolver) {
      const resolver = this.handshakeResolver;
      this.handshakeResolver = null;
      resolver.reject(new Error(message));
    }
  }

  /**
   * Arms the idle timer only when no requests are outstanding. While work
   * is pending, the timer is suppressed so a long silent operation is not
   * killed by the idle-close logic. This fixes the concept: idle means
   * "no work outstanding", not "no bytes moving".
   *
   * @plan PLAN-20260731-GHBROKER.P05
   * @requirement REQ-007
   * @pseudocode 002-frame-and-cancel.md lines 26-32
   */
  private resetIdleTimer(): void {
    this.cancelIdleTimer();
    if (this.pendingRequests.size > 0) return;
    this.armIdleTimer();
  }

  /**
   * Arms the idle timer if and only if no pending requests remain. Called
   * after a request is resolved/deleted so a now-idle connection restarts
   * its close countdown.
   *
   * @plan PLAN-20260731-GHBROKER.P05
   * @requirement REQ-007
   * @pseudocode 002-frame-and-cancel.md lines 30-32
   */
  private maybeArmIdleTimer(): void {
    if (this.pendingRequests.size === 0 && this.idleTimer === null) {
      this.armIdleTimer();
    }
  }

  private armIdleTimer(): void {
    this.idleTimer = setTimeout(() => this.gracefulClose(), IDLE_TIMEOUT_MS);
    this.idleTimer.unref();
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
