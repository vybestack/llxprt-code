/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Host-side credential proxy server that listens on a Unix domain socket
 * and serves token/key operations to sandboxed inner processes.
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
import type {
  TokenStore,
  ProviderKeyStorage,
  OAuthToken,
} from '@vybestack/llxprt-code-core';
import {
  FrameDecoder,
  encodeFrame,
  sanitizeTokenForProxy,
  mergeRefreshedToken,
} from '@vybestack/llxprt-code-core';
import {
  CredentialProxyOAuthHandler,
  type OAuthFlowInterface,
} from './credential-proxy-oauth-handler.js';
import type { RefreshCoordinator } from './refresh-coordinator.js';

export type { OAuthFlowInterface } from './credential-proxy-oauth-handler.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = 1;

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
}

// ─── Server ──────────────────────────────────────────────────────────────────

export class CredentialProxyServer {
  private readonly options: CredentialProxyServerOptions;
  private socketPath: string | null = null;
  private server: net.Server | null = null;
  private readonly connections: Set<net.Socket> = new Set();
  private readonly oauthHandler: CredentialProxyOAuthHandler;

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

    const dir = path.dirname(socketPath);
    fs.mkdirSync(dir, { mode: 0o700, recursive: true });

    this.server = net.createServer((socket) => this.handleConnection(socket));

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(socketPath, () => {
        this.server!.removeListener('error', reject);
        resolve();
      });
    });

    // Set socket permissions to owner read/write only (0o600)
    fs.chmodSync(socketPath, 0o600);

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
      if (socketPathToClean !== null) {
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
    const tmpdir = fs.realpathSync(os.tmpdir());
    const uid = process.getuid?.() ?? process.pid;
    // Use 128-bit cryptographic nonce, base64url encoded for compactness
    // (macOS has ~104 char limit on Unix socket paths)
    const nonce = crypto.randomBytes(16).toString('base64url');
    // Use short directory name "lc-" to fit within macOS socket path limits
    const dir = this.options.socketDir ?? path.join(tmpdir, `lc-${uid}`);
    return path.join(dir, `${process.pid}-${nonce}.sock`);
  }

  private handleConnection(socket: net.Socket): void {
    this.connections.add(socket);
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
          this.handleHandshake(socket, frame);
          if (frame.v === PROTOCOL_VERSION || this.isVersionCompatible(frame)) {
            handshakeCompleted = true;
          }
          continue;
        }
        void this.dispatchRequest(socket, frame);
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
    });

    socket.on('error', () => {
      this.connections.delete(socket);
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
  ): void {
    const compatible = this.isVersionCompatible(frame);

    if (compatible) {
      socket.write(
        encodeFrame({
          v: PROTOCOL_VERSION,
          op: 'handshake',
          ok: true,
          data: { version: PROTOCOL_VERSION },
        }),
      );
    } else {
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
      ) => Promise<void> | void
    >
  > = {
    get_token: (socket, id, payload) =>
      this.handleGetToken(socket, id, payload),
    save_token: (socket, id, payload) =>
      this.handleSaveToken(socket, id, payload),
    remove_token: (socket, id, payload) =>
      this.handleRemoveToken(socket, id, payload),
    list_providers: (socket, id) => this.handleListProviders(socket, id),
    list_buckets: (socket, id, payload) =>
      this.handleListBuckets(socket, id, payload),
    get_bucket_stats: (socket, id, payload) =>
      this.handleGetBucketStats(socket, id, payload),
    get_api_key: (socket, id, payload) =>
      this.handleGetApiKey(socket, id, payload),
    list_api_keys: (socket, id) => this.handleListApiKeys(socket, id),
    has_api_key: (socket, id, payload) =>
      this.handleHasApiKey(socket, id, payload),
    oauth_initiate: (socket, id, payload) =>
      this.oauthHandler.handleInitiate(socket, id, payload),
    oauth_exchange: (socket, id, payload) =>
      this.oauthHandler.handleExchange(socket, id, payload),
    oauth_poll: (socket, id, payload) =>
      this.oauthHandler.handlePoll(socket, id, payload),
    oauth_cancel: (socket, id, payload) =>
      this.oauthHandler.handleCancel(socket, id, payload),
    refresh_token: (socket, id, payload) =>
      this.oauthHandler.handleRefreshToken(socket, id, payload),
  };

  private async dispatchRequest(
    socket: net.Socket,
    frame: Record<string, unknown>,
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
      await handler(socket, id, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(socket, id, 'INTERNAL_ERROR', message);
    }
  }

  private async handleGetToken(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const provider = payload.provider as string | undefined;
    if (!provider) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
      return;
    }
    const bucket = payload.bucket as string | undefined;

    const token = await this.options.tokenStore.getToken(provider, bucket);
    if (token === null) {
      this.sendError(
        socket,
        id,
        'NOT_FOUND',
        `No token found for provider: ${provider}`,
      );
      return;
    }
    const sanitized = sanitizeTokenForProxy(token);
    this.sendOk(socket, id, sanitized as unknown as Record<string, unknown>);
  }

  private async handleSaveToken(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
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
  ): Promise<void> {
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
  ): Promise<void> {
    const providers = await this.options.tokenStore.listProviders();
    this.sendOk(socket, id, { providers });
  }

  private async handleListBuckets(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const provider = payload.provider as string | undefined;
    if (!provider) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
      return;
    }

    const buckets = await this.options.tokenStore.listBuckets(provider);
    this.sendOk(socket, id, { buckets });
  }

  private async handleGetApiKey(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const name = payload.name as string | undefined;
    if (!name) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing name');
      return;
    }

    const key = await this.options.providerKeyStorage.getKey(name);
    if (key === null) {
      this.sendError(socket, id, 'NOT_FOUND', `No API key found for: ${name}`);
      return;
    }
    this.sendOk(socket, id, { key });
  }

  private async handleListApiKeys(
    socket: net.Socket,
    id: string,
  ): Promise<void> {
    const keys = await this.options.providerKeyStorage.listKeys();
    this.sendOk(socket, id, { keys });
  }

  private async handleHasApiKey(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const name = payload.name as string | undefined;
    if (!name) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing name');
      return;
    }

    const exists = await this.options.providerKeyStorage.hasKey(name);
    this.sendOk(socket, id, { exists });
  }

  private async handleGetBucketStats(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
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
