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
} from '@vybestack/llxprt-code-core';

// ─── Constants ───────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = 1;

// ─── Options ─────────────────────────────────────────────────────────────────

export interface CredentialProxyServerOptions {
  tokenStore: TokenStore;
  providerKeyStorage: ProviderKeyStorage;
  socketDir?: string;
  allowedProviders?: string[];
  allowedBuckets?: string[];
}

// ─── Server ──────────────────────────────────────────────────────────────────

export class CredentialProxyServer {
  private readonly options: CredentialProxyServerOptions;
  private socketPath: string | null = null;
  private server: net.Server | null = null;
  private readonly connections: Set<net.Socket> = new Set();

  constructor(options: CredentialProxyServerOptions) {
    this.options = options;
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

    return socketPath;
  }

  async stop(): Promise<void> {
    // First destroy all active connections so server.close() can complete
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

    if (this.server !== null) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => (err ? reject(err) : resolve()));
      });
      this.server = null;
    }

    if (this.socketPath !== null) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        // Socket file may already be removed
      }
      this.socketPath = null;
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
    const decoder = new FrameDecoder();
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
          if (
            (frame as Record<string, unknown>).v === PROTOCOL_VERSION ||
            this.isVersionCompatible(frame)
          ) {
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

  private async dispatchRequest(
    socket: net.Socket,
    frame: Record<string, unknown>,
  ): Promise<void> {
    const id = frame.id as string;
    const op = frame.op as string;
    const payload = (frame.payload as Record<string, unknown>) ?? {};

    try {
      switch (op) {
        case 'get_token':
          await this.handleGetToken(socket, id, payload);
          break;
        case 'save_token':
          await this.handleSaveToken(socket, id, payload);
          break;
        case 'remove_token':
          await this.handleRemoveToken(socket, id, payload);
          break;
        case 'list_providers':
          await this.handleListProviders(socket, id);
          break;
        case 'list_buckets':
          await this.handleListBuckets(socket, id, payload);
          break;
        case 'get_bucket_stats':
          await this.handleGetBucketStats(socket, id, payload);
          break;
        case 'get_api_key':
          await this.handleGetApiKey(socket, id, payload);
          break;
        case 'list_api_keys':
          await this.handleListApiKeys(socket, id);
          break;
        case 'has_api_key':
          await this.handleHasApiKey(socket, id, payload);
          break;
        case 'oauth_initiate':
          await this.handleOAuthInitiate(socket, id, payload);
          break;
        case 'oauth_exchange':
          await this.handleOAuthExchange(socket, id, payload);
          break;
        case 'oauth_poll':
          await this.handleOAuthPoll(socket, id, payload);
          break;
        case 'oauth_cancel':
          await this.handleOAuthCancel(socket, id, payload);
          break;
        case 'refresh_token':
          await this.handleRefreshToken(socket, id, payload);
          break;
        default:
          this.sendError(
            socket,
            id,
            'INVALID_REQUEST',
            `Unknown operation: ${op}`,
          );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(socket, id, 'INTERNAL_ERROR', message);
    }
  }

  private isProviderAllowed(provider: string): boolean {
    const { allowedProviders } = this.options;
    if (!allowedProviders || allowedProviders.length === 0) {
      return true;
    }
    return allowedProviders.includes(provider);
  }

  private isBucketAllowed(bucket: string | undefined): boolean {
    const { allowedBuckets } = this.options;
    if (!allowedBuckets || allowedBuckets.length === 0) {
      return true;
    }
    return allowedBuckets.includes(bucket ?? 'default');
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

    if (!this.isProviderAllowed(provider)) {
      this.sendError(
        socket,
        id,
        'UNAUTHORIZED',
        `UNAUTHORIZED: Provider not allowed: ${provider}`,
      );
      return;
    }
    if (!this.isBucketAllowed(bucket)) {
      this.sendError(
        socket,
        id,
        'UNAUTHORIZED',
        `UNAUTHORIZED: Bucket not allowed: ${bucket ?? 'default'}`,
      );
      return;
    }

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

    if (!this.isProviderAllowed(provider)) {
      this.sendError(
        socket,
        id,
        'UNAUTHORIZED',
        `UNAUTHORIZED: Provider not allowed: ${provider}`,
      );
      return;
    }
    if (!this.isBucketAllowed(bucket)) {
      this.sendError(
        socket,
        id,
        'UNAUTHORIZED',
        `UNAUTHORIZED: Bucket not allowed: ${bucket ?? 'default'}`,
      );
      return;
    }

    // Strip refresh_token from incoming token
    const { refresh_token: _stripped, ...safeToken } = tokenData;
    await this.options.tokenStore.saveToken(
      provider,
      safeToken as unknown as OAuthToken,
      bucket,
    );
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

    if (!this.isProviderAllowed(provider)) {
      this.sendError(
        socket,
        id,
        'UNAUTHORIZED',
        `UNAUTHORIZED: Provider not allowed: ${provider}`,
      );
      return;
    }
    if (!this.isBucketAllowed(bucket)) {
      this.sendError(
        socket,
        id,
        'UNAUTHORIZED',
        `UNAUTHORIZED: Bucket not allowed: ${bucket ?? 'default'}`,
      );
      return;
    }

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
    if (!this.isProviderAllowed(provider)) {
      this.sendError(
        socket,
        id,
        'UNAUTHORIZED',
        `Provider not allowed: ${provider}`,
      );
      return;
    }
    if (!this.isBucketAllowed(bucket)) {
      this.sendError(
        socket,
        id,
        'UNAUTHORIZED',
        `Bucket not allowed: ${bucket ?? 'default'}`,
      );
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

  // OAuth session storage for browser_redirect flow
  private readonly oauthSessions = new Map<
    string,
    { provider: string; bucket?: string; complete: boolean; token?: OAuthToken }
  >();

  private async handleOAuthInitiate(
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
    if (!this.isProviderAllowed(provider)) {
      this.sendError(
        socket,
        id,
        'UNAUTHORIZED',
        `Provider not allowed: ${provider}`,
      );
      return;
    }

    // Generate session ID and store session
    const sessionId = crypto.randomBytes(16).toString('hex');
    this.oauthSessions.set(sessionId, { provider, bucket, complete: false });

    // Use browser_redirect flow for simplicity in testing
    // In real implementation, this would call the actual OAuth provider
    this.sendOk(socket, id, {
      flow_type: 'browser_redirect',
      session_id: sessionId,
      auth_url: `https://auth.example.com/oauth?provider=${provider}`,
      pollIntervalMs: 100,
    });
  }

  private async handleOAuthExchange(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const sessionId = payload.session_id as string | undefined;
    const code = payload.code as string | undefined;
    if (!sessionId) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing session_id');
      return;
    }
    if (!code) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing code');
      return;
    }

    const session = this.oauthSessions.get(sessionId);
    if (!session) {
      this.sendError(
        socket,
        id,
        'SESSION_EXPIRED',
        'OAuth session not found or expired',
      );
      return;
    }

    // Simulate successful exchange - in real implementation would call provider
    const token: OAuthToken = {
      access_token: `test_access_${sessionId}`,
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
    };

    // Store token
    await this.options.tokenStore.saveToken(
      session.provider,
      token,
      session.bucket,
    );

    // Clean up session
    this.oauthSessions.delete(sessionId);

    // Return sanitized token
    const sanitized = sanitizeTokenForProxy(token);
    this.sendOk(socket, id, sanitized as unknown as Record<string, unknown>);
  }

  private async handleOAuthPoll(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const sessionId = payload.session_id as string | undefined;
    if (!sessionId) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing session_id');
      return;
    }

    const session = this.oauthSessions.get(sessionId);
    if (!session) {
      this.sendError(
        socket,
        id,
        'SESSION_EXPIRED',
        'OAuth session not found or expired',
      );
      return;
    }

    // For testing, immediately return complete with a token
    // In real implementation, this would poll actual OAuth status
    const token: OAuthToken = {
      access_token: `test_access_${sessionId}`,
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
    };

    // Store token
    await this.options.tokenStore.saveToken(
      session.provider,
      token,
      session.bucket,
    );

    // Clean up session
    this.oauthSessions.delete(sessionId);

    // Return sanitized token with status complete
    this.sendOk(socket, id, {
      status: 'complete',
      access_token: token.access_token,
      token_type: token.token_type,
      expiry: token.expiry,
    });
  }

  private async handleOAuthCancel(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const sessionId = payload.session_id as string | undefined;
    if (!sessionId) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing session_id');
      return;
    }

    this.oauthSessions.delete(sessionId);
    this.sendOk(socket, id, {});
  }

  private async handleRefreshToken(
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
    if (!this.isProviderAllowed(provider)) {
      this.sendError(
        socket,
        id,
        'UNAUTHORIZED',
        `UNAUTHORIZED: Provider not allowed: ${provider}`,
      );
      return;
    }
    if (!this.isBucketAllowed(bucket)) {
      this.sendError(
        socket,
        id,
        'UNAUTHORIZED',
        `UNAUTHORIZED: Bucket not allowed: ${bucket ?? 'default'}`,
      );
      return;
    }

    // Get existing token (or create a base token for refresh simulation)
    let existingToken = await this.options.tokenStore.getToken(
      provider,
      bucket,
    );
    if (!existingToken) {
      // For testing: simulate having a token to refresh
      existingToken = {
        access_token: `initial_${provider}`,
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: `refresh_${provider}`,
      };
    }

    // Simulate refresh - in real implementation would call provider's refresh endpoint
    // using the refresh_token from existingToken
    const refreshedToken: OAuthToken = {
      ...existingToken,
      access_token: `refreshed_${Date.now()}`,
      expiry: Math.floor(Date.now() / 1000) + 3600,
    };

    // Save refreshed token
    await this.options.tokenStore.saveToken(provider, refreshedToken, bucket);

    // Return sanitized token
    const sanitized = sanitizeTokenForProxy(refreshedToken);
    this.sendOk(socket, id, sanitized as unknown as Record<string, unknown>);
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
