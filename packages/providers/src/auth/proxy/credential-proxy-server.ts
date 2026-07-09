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
  sanitizeTokenForProxy,
  mergeRefreshedToken,
} from '@vybestack/llxprt-code-auth';
// ProviderKeyStorage now lives in the storage package
import type { ProviderKeyStorage } from '@vybestack/llxprt-code-storage';
import {
  CredentialProxyOAuthHandler,
  type OAuthFlowInterface,
} from './credential-proxy-oauth-handler.js';
import type { RefreshCoordinator } from './refresh-coordinator.js';

export type { OAuthFlowInterface } from './credential-proxy-oauth-handler.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = 1;

const isWindows = process.platform === 'win32';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface CredentialProxyServerOptions {
  tokenStore: TokenStore;
  providerKeyStorage: ProviderKeyStorage;
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
}

// ─── Per-Connection State ────────────────────────────────────────────────────

export interface ConnectionState {
  /** Unique incrementing ID assigned at connect time for audit-log correlation. */
  id: number;
  /**
   * True when the connection presented a valid capability token. Sandbox
   * connections have enumeration operations restricted (empty arrays returned)
   * to prevent credential discovery.
   */
  isSandboxConnection: boolean;
}

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

  constructor(options: CredentialProxyServerOptions) {
    this.options = options;
    this.oauthHandler = new CredentialProxyOAuthHandler(options);
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
    // First destroy all active connections so server.close() can complete
    for (const socket of this.connections) {
      socket.destroy();
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
    };
    this.connectionStates.set(socket, state);
    this.auditLog('INFO', connectionId, 'connect');

    const decoder = new FrameDecoder({
      onPartialFrameTimeout: () => {
        socket.destroy();
      },
    });
    let handshakeCompleted = false;

    socket.on('data', (chunk: Buffer) => {
      let frames: Array<Record<string, unknown>>;
      try {
        frames = decoder.feed(chunk);
      } catch {
        socket.destroy();
        return;
      }

      for (const frame of frames) {
        if (!handshakeCompleted) {
          const ok = this.handleHandshake(socket, frame, state);
          if (ok) {
            handshakeCompleted = true;
          }
          continue;
        }
        void this.dispatchRequest(socket, frame, state);
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
      this.connectionStates.delete(socket);
      this.auditLog('INFO', connectionId, 'disconnect');
    });

    socket.on('error', () => {
      this.connections.delete(socket);
      this.connectionStates.delete(socket);
      this.auditLog('WARN', connectionId, 'socket_error');
    });
  }

  private isVersionCompatible(frame: Record<string, unknown>): boolean {
    const v = frame.v as number | undefined;
    if (v === PROTOCOL_VERSION) return true;
    const payload = frame.payload as Record<string, unknown> | undefined;
    if (!payload) return false;
    const min = payload.minVersion as number | undefined;
    const max = payload.maxVersion as number | undefined;
    if (min !== undefined && max !== undefined) {
      return PROTOCOL_VERSION >= min && PROTOCOL_VERSION <= max;
    }
    return false;
  }

  private handleHandshake(
    socket: net.Socket,
    frame: Record<string, unknown>,
    state: ConnectionState,
  ): boolean {
    const compatible = this.isVersionCompatible(frame);

    if (!compatible) {
      this.auditLog('WARN', state.id, 'handshake_rejected', {
        reason: 'version_mismatch',
      });
      socket.write(
        encodeFrame({
          v: PROTOCOL_VERSION,
          op: 'handshake',
          ok: false,
          code: 'UNKNOWN_VERSION',
          error: 'Unsupported protocol version',
        }),
      );
      socket.destroy();
      return false;
    }

    // Validate capability token if the server is configured with one
    if (this.options.capabilityToken) {
      const payload = this.asRecord(frame.payload);
      const presentedToken = payload.capabilityToken;
      if (
        typeof presentedToken !== 'string' ||
        !this.validateCapabilityToken(presentedToken)
      ) {
        this.auditLog('ERROR', state.id, 'handshake_unauthorized', {
          reason: 'invalid_capability_token',
        });
        socket.write(
          encodeFrame({
            v: PROTOCOL_VERSION,
            op: 'handshake',
            ok: false,
            code: 'UNAUTHORIZED',
            error: 'Invalid or missing capability token',
          }),
        );
        socket.destroy();
        return false;
      }
      state.isSandboxConnection = true;
    }

    this.auditLog('INFO', state.id, 'handshake_ok', {
      sandbox: state.isSandboxConnection,
    });
    socket.write(
      encodeFrame({
        v: PROTOCOL_VERSION,
        op: 'handshake',
        ok: true,
        data: { version: PROTOCOL_VERSION },
      }),
    );
    return true;
  }

  /**
   * Constant-time comparison of the presented capability token against the
   * expected value. Both values are SHA-256 hashed first so the comparison
   * buffers are always the same length, eliminating timing side-channels that
   * could leak the token length.
   */
  private validateCapabilityToken(presentedToken: string): boolean {
    const expected = this.options.capabilityToken;
    if (!expected) return true;
    const presentedHash = crypto
      .createHash('sha256')
      .update(presentedToken)
      .digest();
    const expectedHash = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(presentedHash, expectedHash);
  }

  /**
   * Emits a structured JSON log line to stderr for security audit purposes.
   * Never includes actual secrets — only operation names and non-sensitive
   * identifiers. Wrapped in try/catch so a full or closed stderr buffer
   * never crashes the proxy.
   */
  private auditLog(
    level: 'INFO' | 'WARN' | 'ERROR',
    connectionId: number,
    operation: string,
    details?: Record<string, unknown>,
  ): void {
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      component: 'credential-proxy',
      conn: connectionId,
      op: operation,
    };
    if (details) {
      Object.assign(entry, details);
    }
    try {
      process.stderr.write(JSON.stringify(entry) + '\n');
    } catch {
      // stderr may be closed or full — audit logging must never crash the proxy
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private hasStringValue(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
  }

  private readonly requestHandlers: Partial<
    Record<
      string,
      (
        socket: net.Socket,
        id: string,
        payload: Record<string, unknown>,
        state: ConnectionState,
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
    oauth_initiate: (socket, id, payload, state) =>
      this.oauthHandler.handleInitiate(socket, id, payload, state),
    oauth_exchange: (socket, id, payload, state) =>
      this.oauthHandler.handleExchange(socket, id, payload, state),
    oauth_poll: (socket, id, payload, state) =>
      this.oauthHandler.handlePoll(socket, id, payload, state),
    oauth_cancel: (socket, id, payload, state) =>
      this.oauthHandler.handleCancel(socket, id, payload, state),
    refresh_token: (socket, id, payload, state) =>
      this.oauthHandler.handleRefreshToken(socket, id, payload, state),
  };

  private async dispatchRequest(
    socket: net.Socket,
    frame: Record<string, unknown>,
    state: ConnectionState,
  ): Promise<void> {
    const id =
      typeof frame.id === 'string' ? frame.id : String(frame.id ?? 'unknown');
    const op = frame.op;
    const payload = this.asRecord(frame.payload);

    if (Boolean(frame.id) === false || !this.hasStringValue(op)) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing request id or op');
      return;
    }

    const handler = this.requestHandlers[op];
    if (!handler) {
      this.sendError(socket, id, 'INVALID_REQUEST', `Unknown operation: ${op}`);
      return;
    }

    try {
      await handler(socket, id, payload, state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.auditLog('ERROR', state.id, op, { status: 'error', id });
      this.sendError(socket, id, 'INTERNAL_ERROR', message);
    }
  }

  /**
   * Returns true if the connection is a sandbox connection and sends a
   * FORBIDDEN error response with an audit-log entry. Centralizes the
   * sandbox restriction check so logging stays consistent across handlers.
   */
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
    if (this.rejectIfSandbox(socket, id, state, 'save_token', 'Sandbox connections cannot modify tokens')) return;
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
    this.sendOk(socket, id, {});
  }

  private async handleRemoveToken(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
    state: ConnectionState,
  ): Promise<void> {
    if (this.rejectIfSandbox(socket, id, state, 'remove_token', 'Sandbox connections cannot remove tokens')) return;
    const provider = payload.provider as string | undefined;
    if (!provider) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
      return;
    }
    const bucket = payload.bucket as string | undefined;

    await this.options.tokenStore.removeToken(provider, bucket);
    this.sendOk(socket, id, {});
  }

  private async handleListProviders(
    socket: net.Socket,
    id: string,
    state: ConnectionState,
  ): Promise<void> {
    if (state.isSandboxConnection) {
      this.auditLog('WARN', state.id, 'list_providers', {
        status: 'blocked_sandbox',
      });
      this.sendOk(socket, id, { providers: [] });
      return;
    }
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
    const provider = payload.provider as string | undefined;
    if (!provider) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
      return;
    }

    if (state.isSandboxConnection) {
      this.auditLog('WARN', state.id, 'list_buckets', {
        provider,
        status: 'blocked_sandbox',
      });
      this.sendOk(socket, id, { buckets: [] });
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
      this.auditLog('INFO', state.id, 'get_api_key', {
        name,
        status: 'not_found',
      });
      this.sendError(socket, id, 'NOT_FOUND', `No API key found for: ${name}`);
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
    if (state.isSandboxConnection) {
      this.auditLog('WARN', state.id, 'list_api_keys', {
        status: 'blocked_sandbox',
      });
      this.sendOk(socket, id, { keys: [] });
      return;
    }
    const keys = await this.options.providerKeyStorage.listKeys();
    this.auditLog('INFO', state.id, 'list_api_keys', {
      status: 'ok',
      count: keys.length,
    });
    this.sendOk(socket, id, { keys });
  }

  private async handleHasApiKey(
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
    const provider = payload.provider as string | undefined;
    const bucket = payload.bucket as string | undefined;
    if (!provider) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
      return;
    }
    if (state.isSandboxConnection) {
      this.auditLog('WARN', state.id, 'get_bucket_stats', {
        status: 'blocked_sandbox',
      });
      this.sendOk(socket, id, {
        bucket: bucket ?? 'default',
        requestCount: 0,
        percentage: 0,
      });
      return;
    }
    const stats = await this.options.tokenStore.getBucketStats(
      provider,
      bucket ?? 'default',
    );
    if (stats === null) {
      this.sendError(
        socket,
        id,
        'NOT_FOUND',
        `No stats found for ${provider}/${bucket ?? 'default'}`,
      );
      return;
    }
    this.sendOk(socket, id, stats as unknown as Record<string, unknown>);
  }

  private sendOk(
    socket: net.Socket,
    id: string,
    data: Record<string, unknown>,
  ): void {
    const response = { id, ok: true, data };
    socket.write(encodeFrame(response));
  }

  private sendError(
    socket: net.Socket,
    id: string,
    code: string,
    error: string,
  ): void {
    const response = { id, ok: false, code, error };
    socket.write(encodeFrame(response));
  }
}
