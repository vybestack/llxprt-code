/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Host-side credential proxy server that listens on a Unix domain socket
 * (POSIX) or a Windows named pipe (win32) and serves token/key operations
 * to sandboxed inner processes.
 *
 * @plan PLAN-20250214-CREDPROXY.P15
 * @requirement R1, R2, R3
 * @pseudocode analysis/pseudocode/005-credential-proxy-server.md
 */

import * as net from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
// @plan:PLAN-20260608-ISSUE1586.P15 — auth types from auth package
import type { TokenStore, OAuthToken } from '@vybestack/llxprt-code-auth';
import {
  FrameDecoder,
  encodeFrame,
} from '@vybestack/llxprt-code-auth/proxy/framing.js';
import { mergeRefreshedToken } from '@vybestack/llxprt-code-auth/token-merge.js';
import { sanitizeTokenForProxy } from '@vybestack/llxprt-code-auth/token-sanitization.js';
// ProviderKeyStorage now lives in the storage package
import type { ProviderKeyStorageLike } from '@vybestack/llxprt-code-storage';
import {
  CredentialProxyOAuthHandler,
  type OAuthFlowInterface,
} from './credential-proxy-oauth-handler.js';
import type { RefreshCoordinator } from './refresh-coordinator.js';
import { ConcurrentDispatchRegistry } from './concurrent-dispatch-registry.js';
import { auditLog } from './audit-log.js';
import { ResponseWriter } from './response-writer.js';
import { handleCancel } from './cancel-handler.js';
import {
  computeNegotiatedVersion,
  validateCapabilityToken,
} from './handshake-helpers.js';
import {
  buildHandlerMap,
  mergeExtraHandlers,
  resolveRegisteredHandler,
} from './extra-handler-merger.js';
import type { ProxyRequestHandlerFn } from './credential-proxy-handler-type.js';
import type { ConnectionState } from './credential-proxy-state.js';

export type { OAuthFlowInterface } from './credential-proxy-oauth-handler.js';
export type { RequestHandler } from './github-broker-request-handler.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = 2;

/** Max frames per chunk before a connection is considered flooding and destroyed. */
const MAX_FRAMES_PER_CHUNK = 100;

/** Grace period (ms) for a client to read a rejected-handshake frame before force-destroy. */
const HANDSHAKE_DESTROY_TIMEOUT_MS = 3000;

const isWindows = process.platform === 'win32';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface CredentialProxyServerOptions {
  tokenStore: TokenStore;
  providerKeyStorage: ProviderKeyStorageLike;
  socketDir?: string;
  /** Flow factories for OAuth initiation - maps provider name to factory function */
  flowFactories?: Map<string, () => OAuthFlowInterface>;
  /** OAuth session timeout in milliseconds (default 10 minutes) */
  oauthSessionTimeoutMs?: number;
  /** RefreshCoordinator for rate-limited, deduplicated token refresh */
  refreshCoordinator?: RefreshCoordinator;
  /**
   * Per-session capability token. When configured, every connecting client
   * MUST present this token in the handshake payload or the connection is
   * rejected with UNAUTHORIZED. Connections that present a valid token are
   * treated as sandbox connections (enumeration operations return empty
   * arrays). When omitted, connections are allowed without a token
   * (non-sandbox / legacy backward compatibility).
   */
  capabilityToken?: string;
  /**
   * Extra request handlers merged into the server's requestHandlers at
   * construction. If any key collides with a built-in op name, the
   * constructor THROWS (fail fast). A silent override of get_api_key would
   * be catastrophic.
   *
   * The handler signature must match the server's internal handler type:
   * (socket, id, payload, state, signal) => Promise<void> | void.
   *
   * @plan PLAN-20260731-GHBROKER.P08
   * @requirement REQ-003
   * @pseudocode 003-github-broker.md lines 01-06
   */
  extraHandlers?: Record<string, unknown>;
}

// ─── Per-Connection State ────────────────────────────────────────────────────

// ─── Server ──────────────────────────────────────────────────────────────────

export class CredentialProxyServer {
  private readonly options: CredentialProxyServerOptions;
  private socketPath: string | null = null;
  private server: net.Server | null = null;
  private readonly connections: Set<net.Socket> = new Set();
  private readonly oauthHandler: CredentialProxyOAuthHandler;
  private nextConnectionId: number = 1;
  private readonly connectionStates: Map<net.Socket, ConnectionState> =
    new Map();
  private readonly expectedTokenHash: Buffer | null;

  constructor(options: CredentialProxyServerOptions) {
    if (
      options.capabilityToken !== undefined &&
      options.capabilityToken.length === 0
    ) {
      throw new Error(
        'capabilityToken must be a non-empty string when provided',
      );
    }
    this.options = options;
    this.oauthHandler = new CredentialProxyOAuthHandler(options);
    this.expectedTokenHash = options.capabilityToken
      ? crypto.createHash('sha256').update(options.capabilityToken).digest()
      : null;
    mergeExtraHandlers(this.requestHandlers, options.extraHandlers);
    // Built once here, after extras are merged, so the table is fixed for
    // the lifetime of the server. See buildHandlerMap for why it is a Map.
    this.handlers = buildHandlerMap(this.requestHandlers);
    this.handlerNames = [...this.handlers.keys()];
  }

  async start(): Promise<string> {
    if (this.server !== null) {
      throw new Error('Server is already started');
    }

    const socketPath = this.buildSocketPath();
    this.socketPath = socketPath;

    // Windows named pipes have no on-disk directory to create; only POSIX
    // Unix-domain sockets live on the filesystem.
    if (!isWindows) {
      const dir = path.dirname(socketPath);
      fs.mkdirSync(dir, { mode: 0o700, recursive: true });
    }

    this.server = net.createServer((socket) => this.handleConnection(socket));

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      // Node accepts a `\\.\pipe\...` string here unchanged on Windows. Node/
      // libuv create the pipe with the system default security descriptor and
      // do NOT apply a per-user DACL, so the 128-bit nonce in the pipe name is
      // the primary access-control barrier (the same unguessability defense the
      // POSIX socket path relies on).
      this.server!.listen(socketPath, () => {
        this.server!.removeListener('error', reject);
        resolve();
      });
    });

    if (!isWindows) {
      // Set socket permissions to owner read/write only (0o600).
      // On Windows there is no on-disk file to chmod; the named pipe uses the
      // system default security descriptor (no per-user DACL is applied by
      // Node), so the 128-bit nonce is the sole access-control mechanism.
      fs.chmodSync(socketPath, 0o600);
    }

    return socketPath;
  }

  async stop(): Promise<void> {
    // Close through `end()`, not `destroy()`, and stop reading first. The point
    // is ORDERING: `server.close()` below only calls back once the connection
    // count reaches zero, so ending here keeps `stop()` from returning before
    // every peer has had an event-loop turn to observe the close. `destroy()`
    // returned before that turn, leaving a client that still believed it was
    // connected to hang its next request to the request timeout rather than
    // report the loss (issue #3061).
    for (const socket of this.connections) {
      this.endAndDestroyAfter(socket, Buffer.alloc(0));
    }
    this.connections.clear();

    const socketPathToClean = this.socketPath;
    this.socketPath = null;

    try {
      if (this.server !== null) {
        const srv = this.server;
        this.server = null;
        await new Promise<void>((resolve) => {
          srv.close(() => resolve());
        });
      }
    } finally {
      // Windows named pipes are released when the server closes; there is no
      // on-disk file to unlink. Only POSIX Unix-domain sockets need cleanup.
      if (!isWindows && socketPathToClean !== null) {
        try {
          fs.unlinkSync(socketPathToClean);
        } catch {
          // Socket file may already be removed
        }
      }
    }
  }

  getSocketPath(): string | null {
    return this.socketPath;
  }

  private buildSocketPath(): string {
    // Use 128-bit cryptographic nonce, base64url encoded for compactness
    // (macOS has ~104 char limit on Unix socket paths)
    const nonce = crypto.randomBytes(16).toString('base64url');

    if (isWindows) {
      // Windows named pipe. Use string concatenation (not path.join) so the
      // `\\.\pipe` prefix is preserved. base64url never contains a backslash, so the
      // nonce cannot corrupt the pipe namespace. The socketDir option is
      // intentionally ignored — a named pipe has no directory component.
      return `\\\\.\\pipe\\lxcp-${process.pid}-${nonce}`;
    }

    const tmpdir = fs.realpathSync(os.tmpdir());
    const uid = process.getuid?.() ?? process.pid;
    // Use short directory name "lc-" to fit within macOS socket path limits
    const dir = this.options.socketDir ?? path.join(tmpdir, `lc-${uid}`);
    return path.join(dir, `${process.pid}-${nonce}.sock`);
  }

  private handleConnection(socket: net.Socket): void {
    this.connections.add(socket);
    const connectionId = this.nextConnectionId++;
    const state: ConnectionState = {
      id: connectionId,
      isSandboxConnection: false,
      negotiatedVersion: PROTOCOL_VERSION,
      pending: new ConcurrentDispatchRegistry(),
      writer: new ResponseWriter(
        socket,
        connectionId,
        (level, connId, op, details) =>
          this.auditLog(level, connId, op, details),
        () => state.negotiatedVersion,
      ),
    };
    this.connectionStates.set(socket, state);
    this.auditLog('INFO', connectionId, 'connect');

    const decoder = new FrameDecoder({
      onPartialFrameTimeout: () => {
        this.auditLog('WARN', state.id, 'partial_frame_timeout');
        socket.destroy();
      },
      maxFramesPerFeed: MAX_FRAMES_PER_CHUNK,
    });
    const handshakeState = { completed: false, rejected: false };

    socket.on('data', (chunk: Buffer) => {
      let frames: Array<Record<string, unknown>>;
      try {
        frames = decoder.feed(chunk);
      } catch {
        this.auditLog('WARN', state.id, 'frame_decode_error');
        socket.destroy();
        return;
      }

      try {
        this.processFrames(socket, frames, state, handshakeState);
      } catch {
        this.auditLog('ERROR', state.id, 'process_frames_error');
        socket.destroy();
      }
    });

    let connectionCleanedUp = false;
    const cleanupConnection = (op: string): void => {
      if (connectionCleanedUp) return;
      connectionCleanedUp = true;
      state.pending.abortAll();
      this.connections.delete(socket);
      this.connectionStates.delete(socket);
      this.auditLog('INFO', connectionId, op);
    };

    socket.on('close', () => cleanupConnection('disconnect'));

    socket.on('error', () => cleanupConnection('socket_error'));
  }

  private processFrames(
    socket: net.Socket,
    frames: Array<Record<string, unknown>>,
    state: ConnectionState,
    handshakeState: { completed: boolean; rejected: boolean },
  ): void {
    // Cap frames per chunk to prevent unbounded promise-chain growth from
    // a malicious client sending thousands of tiny frames in one TCP segment.
    if (frames.length > MAX_FRAMES_PER_CHUNK) {
      this.auditLog('WARN', state.id, 'frame_flood', {
        count: frames.length,
      });
      socket.destroy();
      return;
    }
    for (const frame of frames) {
      if (
        socket.destroyed ||
        !this.shouldContinueProcessing(socket, frame, state, handshakeState)
      )
        break;
    }
  }

  private shouldContinueProcessing(
    socket: net.Socket,
    frame: Record<string, unknown>,
    state: ConnectionState,
    handshakeState: { completed: boolean; rejected: boolean },
  ): boolean {
    if (!handshakeState.completed) {
      if (handshakeState.rejected) return false;
      const ok = this.handleHandshake(socket, frame, state);
      if (!ok) {
        handshakeState.rejected = true;
        return false;
      }
      handshakeState.completed = true;
      return true;
    }
    // Dispatch concurrently. Whole-buffer socket.write() calls are appended
    // in call order and cannot interleave bytes mid-buffer (net.Socket is a
    // stream.Duplex), so no serialization chain is needed. Frames from one
    // chunk still START in arrival order because processFrames iterates
    // synchronously; they may COMPLETE in any order, which is intended and
    // correct because responses carry id.
    //
    // @plan PLAN-20260731-GHBROKER.P03
    // @requirement REQ-005
    // @pseudocode 001-concurrent-dispatch.md lines 8-22
    void this.dispatchRequest(socket, frame, state).catch((err) => {
      this.auditLog('ERROR', state.id, 'unhandled_dispatch', {
        error: String(err),
      });
      if (!socket.destroyed) socket.destroy();
    });
    return true;
  }

  private handleHandshake(
    socket: net.Socket,
    frame: Record<string, unknown>,
    state: ConnectionState,
  ): boolean {
    const negotiatedVersion = computeNegotiatedVersion(frame, PROTOCOL_VERSION);

    if (negotiatedVersion === undefined) {
      this.auditLog('WARN', state.id, 'handshake_rejected', {
        reason: 'version_mismatch',
      });
      // Use end() instead of write()+destroy() so the error frame is flushed
      // to the OS before the socket is torn down, preventing ECONNRESET on the
      // client side which would mask the specific UNKNOWN_VERSION error code.
      this.endAndDestroyAfter(
        socket,
        encodeFrame({
          v: PROTOCOL_VERSION,
          op: 'handshake',
          ok: false,
          code: 'UNKNOWN_VERSION',
          error: 'Unsupported protocol version',
        }),
      );
      return false;
    }
    state.negotiatedVersion = negotiatedVersion;

    // Validate capability token if the server is configured with one.
    // Note: there is no rate limiting on failed handshake attempts — a
    // malicious local process could repeatedly reconnect to attempt brute
    // force. This is mitigated by the 256-bit token entropy (infeasible to
    // brute-force) and audit logging of every unauthorized attempt. Rate
    // limiting could be added in a future enhancement if needed.
    if (this.expectedTokenHash !== null) {
      const payload = this.asRecord(frame.payload);
      const presentedToken = payload.capabilityToken;
      if (
        typeof presentedToken !== 'string' ||
        !validateCapabilityToken(presentedToken, this.expectedTokenHash)
      ) {
        this.auditLog('ERROR', state.id, 'handshake_unauthorized', {
          reason: 'invalid_capability_token',
        });
        // Use end() instead of write()+destroy() so the error frame is flushed
        // to the OS before the socket is torn down, preventing ECONNRESET on the
        // client side which would mask the specific UNAUTHORIZED error code.
        this.endAndDestroyAfter(
          socket,
          encodeFrame({
            v: PROTOCOL_VERSION,
            op: 'handshake',
            ok: false,
            code: 'UNAUTHORIZED',
            error: 'Invalid or missing capability token',
          }),
        );
        return false;
      }
      state.isSandboxConnection = true;
    }

    this.auditLog('INFO', state.id, 'handshake_ok', {
      sandbox: state.isSandboxConnection,
      version: state.negotiatedVersion,
    });
    socket.write(
      encodeFrame({
        // Reply at the NEGOTIATED version, not the server maximum. A v1
        // client that negotiated down cannot parse a v2 frame, so replying
        // with our max breaks the very compatibility the handshake just
        // established.
        v: state.negotiatedVersion,
        op: 'handshake',
        ok: true,
        data: { version: state.negotiatedVersion },
      }),
    );
    return true;
  }

  /** Delegates to the standalone auditLog function (extracted for line count). */
  private auditLog = auditLog;

  private asRecord(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  /**
   * Prototype-safe dispatch table, built from requestHandlers after extras
   * are merged. See the constructor for why this is a Map.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-002, REQ-015
   */
  private readonly handlers: Map<string, ProxyRequestHandlerFn>;
  /** Registered operation names; the only strings used as dispatch keys. */
  private readonly handlerNames: readonly string[];

  private readonly requestHandlers: Partial<
    Record<
      string,
      (
        socket: net.Socket,
        id: string,
        payload: Record<string, unknown>,
        state: ConnectionState,
        signal: AbortSignal,
      ) => Promise<void> | void
    >
  > = {
    get_token: (socket, id, payload, state) =>
      this.handleGetToken(socket, id, payload, state),
    save_token: (socket, id, payload, state) =>
      this.handleSaveToken(socket, id, payload, state),
    remove_token: (socket, id, payload, state) =>
      this.handleRemoveToken(socket, id, payload, state),
    list_providers: (socket, id, _payload, state) =>
      this.handleListProviders(socket, id, state),
    list_buckets: (socket, id, payload, state) =>
      this.handleListBuckets(socket, id, payload, state),
    get_bucket_stats: (socket, id, payload, state) =>
      this.handleGetBucketStats(socket, id, payload, state),
    get_api_key: (socket, id, payload, state) =>
      this.handleGetApiKey(socket, id, payload, state),
    list_api_keys: (socket, id, _payload, state) =>
      this.handleListApiKeys(socket, id, state),
    has_api_key: (socket, id, payload, state) =>
      this.handleHasApiKey(socket, id, payload, state),
    cancel: (_socket, id, payload, state) => {
      handleCancel(
        state.writer,
        id,
        payload,
        state.id,
        state.pending,
        (level, connId, op, details) =>
          this.auditLog(level, connId, op, details),
      );
    },
    oauth_initiate: (socket, id, payload, state) =>
      this.sandboxGuardedOauth(
        socket,
        id,
        payload,
        state,
        'oauth_initiate',
        'Sandbox connections cannot initiate OAuth',
        (s, i, p, st) => this.oauthHandler.handleInitiate(s, i, p, st),
      ),
    oauth_exchange: (socket, id, payload, state) =>
      this.sandboxGuardedOauth(
        socket,
        id,
        payload,
        state,
        'oauth_exchange',
        'Sandbox connections cannot exchange OAuth tokens',
        (s, i, p, st) => this.oauthHandler.handleExchange(s, i, p, st),
      ),
    oauth_poll: (socket, id, payload, state) =>
      this.sandboxGuardedOauth(
        socket,
        id,
        payload,
        state,
        'oauth_poll',
        'Sandbox connections cannot poll OAuth tokens',
        (s, i, p, st) => this.oauthHandler.handlePoll(s, i, p, st),
      ),
    oauth_cancel: (socket, id, payload, state) =>
      this.sandboxGuardedOauth(
        socket,
        id,
        payload,
        state,
        'oauth_cancel',
        'Sandbox connections cannot cancel OAuth sessions',
        (s, i, p, st) => this.oauthHandler.handleCancel(s, i, p, st),
      ),
    refresh_token: (socket, id, payload, state) =>
      this.sandboxGuardedOauth(
        socket,
        id,
        payload,
        state,
        'refresh_token',
        'Sandbox connections cannot refresh tokens',
        (s, i, p, st) => this.oauthHandler.handleRefreshToken(s, i, p, st),
      ),
  };

  /**
   * Dispatches a single request frame concurrently. Enforces duplicate-id
   * and concurrency-cap checks, registers the op for abort-on-close, and
   * passes an AbortSignal to the handler. When a handler completes after
   * being aborted (by cancel or socket close), settles the original request
   * id with CANCELLED so the client's pending map does not leak.
   *
   * @plan PLAN-20260731-GHBROKER.P03, PLAN-20260731-GHBROKER.P05
   * @requirement REQ-005, REQ-007
   * @pseudocode 001-concurrent-dispatch.md lines 23-38, 002-frame-and-cancel.md lines 60-65
   */
  private async dispatchRequest(
    socket: net.Socket,
    frame: Record<string, unknown>,
    state: ConnectionState,
  ): Promise<void> {
    if (socket.destroyed || !socket.writable) return;
    const id =
      typeof frame.id === 'string' ? frame.id : String(frame.id ?? 'unknown');
    const op = typeof frame.op === 'string' ? frame.op : '';
    try {
      if (Boolean(frame.id) === false || op === '') {
        this.sendError(
          socket,
          id,
          'INVALID_REQUEST',
          'Missing request id or op',
        );
        return;
      }
      // `cancel` is exempt from the concurrency cap. It is the operation
      // that RELIEVES saturation, so rejecting it at the cap would make a
      // fully-loaded connection impossible to unwind — exactly when
      // cancelling matters. It starts no host-side work of its own.
      if (op !== 'cancel') {
        const guard = state.pending.checkGuards(id);
        if (guard) {
          this.sendError(socket, id, guard.code, guard.message);
          return;
        }
      }
      const handler = resolveRegisteredHandler(
        this.handlers,
        this.handlerNames,
        op,
      );
      if (!handler) {
        this.sendError(
          socket,
          id,
          'INVALID_REQUEST',
          `Unknown operation: ${op}`,
        );
        return;
      }
      const controller = state.pending.register(id, op);
      const payload = this.asRecord(frame.payload);
      try {
        await handler(socket, id, payload, state, controller.signal);
      } finally {
        // If the handler was aborted (by cancel), settle the original
        // request id with CANCELLED so the client's pending map does
        // not leak. sendError is a no-op on a dead socket.
        if (controller.signal.aborted) {
          this.sendError(socket, id, 'CANCELLED', 'Operation cancelled');
        }
        state.pending.release(id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.auditLog('ERROR', state.id, op || 'unknown', {
        status: 'error',
        id,
      });
      try {
        this.sendError(socket, id, 'INTERNAL_ERROR', message);
      } catch {
        socket.destroy();
      }
    }
  }

  /**
   * Returns true if the connection is a sandbox connection and sends a
   * FORBIDDEN error response with an audit-log entry. Centralizes the
   * sandbox restriction check so logging stays consistent across handlers.
   */
  // Sandbox restriction design:
  // - list_* and get_bucket_stats return empty/zeroed data (ok: true) to avoid
  //   breaking client code that iterates the result. This prevents enumeration
  //   while maintaining API compatibility.
  // - save_token and remove_token return FORBIDDEN (ok: false) since mutations
  //   from sandbox connections are never valid and the caller should know.
  // - get_token and get_api_key return FORBIDDEN for not-found to avoid leaking
  //   provider/key existence via error messages.
  //   Accepted risk: a successful get_token (ok: true) still reveals that a
  //   provider exists. This is accepted because the provider namespace is
  //   small and publicly known (e.g., 'anthropic', 'openai', 'google'), and
  //   blocking get_token entirely would prevent the sandbox from functioning.
  private rejectIfSandbox(
    socket: net.Socket,
    id: string,
    state: ConnectionState,
    operation: string,
    reason: string,
  ): boolean {
    if (!state.isSandboxConnection) return false;
    this.auditLog('WARN', state.id, operation, { status: 'blocked_sandbox' });
    this.sendError(socket, id, 'FORBIDDEN', reason);
    return true;
  }

  /** Returns true (and sends an empty response) if the connection is from
   *  a sandbox. Centralises the enumeration-restriction pattern so all
   *  list-style handlers log and respond consistently. */
  private emptyIfSandbox(
    socket: net.Socket,
    id: string,
    state: ConnectionState,
    operation: string,
    data: Record<string, unknown>,
  ): boolean {
    if (!state.isSandboxConnection) return false;
    this.auditLog('WARN', state.id, operation, { status: 'blocked_sandbox' });
    this.sendOk(socket, id, data);
    return true;
  }

  /** Guards an OAuth handler with a sandbox rejection check. */
  private sandboxGuardedOauth(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
    state: ConnectionState,
    operation: string,
    reason: string,
    delegate: (
      s: net.Socket,
      i: string,
      p: Record<string, unknown>,
      st: ConnectionState,
    ) => Promise<void> | void,
  ): Promise<void> | void {
    if (this.rejectIfSandbox(socket, id, state, operation, reason))
      return undefined;
    return delegate(socket, id, payload, state);
  }

  // Intentionally allowed for sandbox connections: the sandbox process needs
  // to retrieve tokens for specific providers to make API calls. This is the
  // core purpose of the credential proxy. Enumeration (list_*) is blocked
  // to prevent discovery, and mutation (save_token/remove_token) is blocked
  // to prevent tampering. For sandbox connections, NOT_FOUND responses use a
  // generic FORBIDDEN message to avoid revealing whether a provider exists.
  private async handleGetToken(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
    state: ConnectionState,
  ): Promise<void> {
    const provider = payload.provider as string | undefined;
    if (!provider) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
      return;
    }
    const bucket = payload.bucket as string | undefined;

    const token = await this.options.tokenStore.getToken(provider, bucket);
    if (token === null) {
      if (state.isSandboxConnection) {
        this.auditLog('INFO', state.id, 'get_token', {
          status: 'blocked_sandbox',
        });
        this.sendError(socket, id, 'FORBIDDEN', 'Access denied');
      } else {
        this.auditLog('INFO', state.id, 'get_token', {
          provider,
          bucket: bucket ?? 'default',
          status: 'not_found',
        });
        this.sendError(
          socket,
          id,
          'NOT_FOUND',
          `No token found for provider: ${provider}`,
        );
      }
      return;
    }
    this.auditLog('INFO', state.id, 'get_token', {
      provider,
      bucket: bucket ?? 'default',
      status: 'ok',
    });
    const sanitized = sanitizeTokenForProxy(token);
    this.sendOk(socket, id, sanitized as unknown as Record<string, unknown>);
  }

  private async handleSaveToken(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
    state: ConnectionState,
  ): Promise<void> {
    if (
      this.rejectIfSandbox(
        socket,
        id,
        state,
        'save_token',
        'Sandbox connections cannot modify tokens',
      )
    )
      return;
    const provider = payload.provider as string | undefined;
    const tokenData = payload.token as Record<string, unknown> | undefined;
    const bucket = payload.bucket as string | undefined;
    if (!provider || !tokenData) {
      this.sendError(
        socket,
        id,
        'INVALID_REQUEST',
        'Missing provider or token',
      );
      return;
    }

    // Strip refresh_token from incoming token and preserve existing host-side
    // refresh_token when sandbox payload omits it.
    const { refresh_token: _stripped, ...safeToken } = tokenData;
    const existingToken = await this.options.tokenStore.getToken(
      provider,
      bucket,
    );
    const mergedToken = mergeRefreshedToken(
      (existingToken ?? {}) as OAuthToken,
      safeToken as OAuthToken,
    );

    await this.options.tokenStore.saveToken(provider, mergedToken, bucket);
    this.auditLog('INFO', state.id, 'save_token', {
      provider,
      bucket: bucket ?? 'default',
      status: 'ok',
    });
    this.sendOk(socket, id, {});
  }

  private async handleRemoveToken(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
    state: ConnectionState,
  ): Promise<void> {
    if (
      this.rejectIfSandbox(
        socket,
        id,
        state,
        'remove_token',
        'Sandbox connections cannot remove tokens',
      )
    )
      return;
    const provider = payload.provider as string | undefined;
    if (!provider) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
      return;
    }
    const bucket = payload.bucket as string | undefined;

    await this.options.tokenStore.removeToken(provider, bucket);
    this.auditLog('INFO', state.id, 'remove_token', {
      provider,
      bucket: bucket ?? 'default',
      status: 'ok',
    });
    this.sendOk(socket, id, {});
  }

  private async handleListProviders(
    socket: net.Socket,
    id: string,
    state: ConnectionState,
  ): Promise<void> {
    if (
      this.emptyIfSandbox(socket, id, state, 'list_providers', {
        providers: [],
      })
    )
      return;
    const providers = await this.options.tokenStore.listProviders();
    this.auditLog('INFO', state.id, 'list_providers', {
      status: 'ok',
      count: providers.length,
    });
    this.sendOk(socket, id, { providers });
  }

  private async handleListBuckets(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
    state: ConnectionState,
  ): Promise<void> {
    if (this.emptyIfSandbox(socket, id, state, 'list_buckets', { buckets: [] }))
      return;

    const provider = payload.provider as string | undefined;
    if (!provider) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
      return;
    }

    const buckets = await this.options.tokenStore.listBuckets(provider);
    this.auditLog('INFO', state.id, 'list_buckets', {
      provider,
      status: 'ok',
      count: buckets.length,
    });
    this.sendOk(socket, id, { buckets });
  }

  // Intentionally allowed for sandbox connections: the sandbox process needs
  // API keys by known name to configure provider clients. For sandbox
  // connections, NOT_FOUND uses a generic FORBIDDEN message to avoid
  // revealing whether a key name exists (prevents brute-force enumeration).
  private async handleGetApiKey(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
    state: ConnectionState,
  ): Promise<void> {
    const name = payload.name as string | undefined;
    if (!name) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing name');
      return;
    }

    const key = await this.options.providerKeyStorage.getKey(name);
    if (key === null) {
      if (state.isSandboxConnection) {
        this.auditLog('INFO', state.id, 'get_api_key', {
          status: 'blocked_sandbox',
        });
        this.sendError(socket, id, 'FORBIDDEN', 'Access denied');
      } else {
        this.auditLog('INFO', state.id, 'get_api_key', {
          name,
          status: 'not_found',
        });
        this.sendError(
          socket,
          id,
          'NOT_FOUND',
          `No API key found for: ${name}`,
        );
      }
      return;
    }
    this.auditLog('INFO', state.id, 'get_api_key', { name, status: 'ok' });
    this.sendOk(socket, id, { key });
  }

  private async handleListApiKeys(
    socket: net.Socket,
    id: string,
    state: ConnectionState,
  ): Promise<void> {
    if (this.emptyIfSandbox(socket, id, state, 'list_api_keys', { keys: [] }))
      return;
    const keys = await this.options.providerKeyStorage.listKeys();
    this.auditLog('INFO', state.id, 'list_api_keys', {
      status: 'ok',
      count: keys.length,
    });
    this.sendOk(socket, id, { keys });
  }

  // Blocked for sandbox connections: returning exists: true/false enables
  // brute-force enumeration of which API keys are configured. The sandbox
  // can call get_api_key instead, which returns a generic FORBIDDEN for
  // unknown keys (not distinguishing found from not found).
  private async handleHasApiKey(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
    state: ConnectionState,
  ): Promise<void> {
    if (
      this.rejectIfSandbox(
        socket,
        id,
        state,
        'has_api_key',
        'Sandbox connections cannot check key existence',
      )
    )
      return;
    const name = payload.name as string | undefined;
    if (!name) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing name');
      return;
    }

    const exists = await this.options.providerKeyStorage.hasKey(name);
    this.auditLog('INFO', state.id, 'has_api_key', { name, exists });
    this.sendOk(socket, id, { exists });
  }

  private async handleGetBucketStats(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
    state: ConnectionState,
  ): Promise<void> {
    const requestedBucket = (payload.bucket as string | undefined) ?? 'default';
    if (
      this.emptyIfSandbox(socket, id, state, 'get_bucket_stats', {
        bucket: requestedBucket,
        requestCount: 0,
        percentage: 0,
      })
    )
      return;

    const provider = payload.provider as string | undefined;
    const bucket = payload.bucket as string | undefined;
    if (!provider) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
      return;
    }
    const stats = await this.options.tokenStore.getBucketStats(
      provider,
      bucket ?? 'default',
    );
    if (stats === null) {
      this.auditLog('INFO', state.id, 'get_bucket_stats', {
        provider,
        bucket: bucket ?? 'default',
        status: 'not_found',
      });
      this.sendError(
        socket,
        id,
        'NOT_FOUND',
        `No stats found for ${provider}/${bucket ?? 'default'}`,
      );
      return;
    }
    this.auditLog('INFO', state.id, 'get_bucket_stats', {
      provider,
      bucket: bucket ?? 'default',
      status: 'ok',
    });
    this.sendOk(socket, id, stats as unknown as Record<string, unknown>);
  }

  /**
   * Sends a frame via socket.end() for graceful close, then schedules a
   * force-destroy timer to prevent slowloris-style resource exhaustion from
   * clients that never read the error frame. The timer is cleared on
   * graceful close to avoid dangling references.
   */
  private endAndDestroyAfter(socket: net.Socket, frame: Buffer): void {
    // `writableEnded` as well as `destroyed`: a socket ended by a handshake
    // rejection stays open until its destroy timer fires, and calling `end()`
    // on it again raises ERR_STREAM_WRITE_AFTER_END, which would surface as a
    // spurious `socket_error` audit record during shutdown.
    if (socket.destroyed || socket.writableEnded) return;
    // `pause()` before `end()`: end half-closes the write side only, so an
    // in-flight frame would otherwise still be decoded and dispatched on a
    // connection this call has already decided to close.
    socket.pause().end(frame);
    const timer = setTimeout(
      () => socket.destroy(),
      HANDSHAKE_DESTROY_TIMEOUT_MS,
    ).unref();
    socket.once('close', () => clearTimeout(timer));
  }

  /** @plan PLAN-20260731-GHBROKER.P05 @requirement REQ-006 */
  private sendOk = (
    s: net.Socket,
    id: string,
    data: Record<string, unknown>,
  ): void => this.connectionStates.get(s)?.writer.sendOk(id, data);

  /** @plan PLAN-20260731-GHBROKER.P05 @requirement REQ-006 */
  private sendError = (
    s: net.Socket,
    id: string,
    code: string,
    error: string,
  ): void => this.connectionStates.get(s)?.writer.sendError(id, code, error);
}
