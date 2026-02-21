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
import { RefreshCoordinator } from './refresh-coordinator.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = 1;

// ─── Options ─────────────────────────────────────────────────────────────────

/**
 * Interface for OAuth flow instances that can be used with the credential proxy.
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P03
 */
export interface OAuthFlowInterface {
  initiateDeviceFlow(redirectUri?: string): Promise<{
    device_code: string;
    user_code?: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval?: number;
  }>;
  exchangeCodeForToken?(code: string, state?: string): Promise<OAuthToken>;
  pollForToken?(deviceCode: string): Promise<OAuthToken>;
  refreshToken?(refreshToken: string): Promise<OAuthToken>;
}

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
  private readonly refreshCoordinator: RefreshCoordinator;

  constructor(options: CredentialProxyServerOptions) {
    this.options = options;
    // Initialize RefreshCoordinator - uses flowFactories to get provider instances for refresh
    this.refreshCoordinator =
      options.refreshCoordinator ??
      new RefreshCoordinator({
        tokenStore: options.tokenStore,
        refreshFn: async (provider, currentToken) => {
          const flowFactory = options.flowFactories?.get(provider);
          if (!flowFactory) {
            throw new Error(`No OAuth provider configured for: ${provider}`);
          }
          const flowInstance = flowFactory();
          if (!flowInstance.refreshToken) {
            throw new Error(
              `Provider ${provider} does not support token refresh`,
            );
          }
          if (!currentToken.refresh_token) {
            throw new Error(
              `Token for ${provider} does not have a refresh_token`,
            );
          }
          return flowInstance.refreshToken(currentToken.refresh_token);
        },
        cooldownMs: 30 * 1000, // 30 second cooldown per provider:bucket
      });
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
    const id =
      typeof frame.id === 'string' ? frame.id : String(frame.id ?? 'unknown');
    const op = typeof frame.op === 'string' ? frame.op : undefined;
    const payload = (frame.payload as Record<string, unknown>) ?? {};

    if (!frame.id || !op) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing request id or op');
      return;
    }

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

  /**
   * OAuth session storage for managing active OAuth flows.
   * Sessions store the flow instance for later exchange/poll operations.
   * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P03
   */
  private readonly oauthSessions = new Map<
    string,
    {
      provider: string;
      bucket?: string;
      complete: boolean;
      token?: OAuthToken;
      createdAt: number;
      used: boolean;
      /** The type of OAuth flow for this session */
      flowType: 'pkce_redirect' | 'device_code' | 'browser_redirect';
      /** The flow instance for later exchange/poll operations */
      flowInstance: OAuthFlowInterface;
      /** PKCE state for pkce_redirect flows (NOT returned to client) */
      pkceState?: string;
      /** Device code for device_code flows - needed for polling */
      deviceCode?: string;
      /** Current poll interval (can increase on slow_down responses) */
      pollInterval?: number;
    }
  >();

  /**
   * Handles OAuth initiation - creates real flow instance and session.
   *
   * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P03
   */
  private async handleOAuthInitiate(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const provider = payload.provider as string | undefined;
    const bucket = payload.bucket as string | undefined;
    const redirectUri = payload.redirect_uri as string | undefined;

    // Validate provider
    if (!provider) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
      return;
    }

    // Get flow factory for this provider
    const flowFactory = this.options.flowFactories?.get(provider);
    if (!flowFactory) {
      this.sendError(
        socket,
        id,
        'PROVIDER_NOT_CONFIGURED',
        `No OAuth flow factory configured for provider: ${provider}`,
      );
      return;
    }

    try {
      // Create flow instance
      const flowInstance = flowFactory();

      // Detect flow type based on provider and flow capabilities
      const flowType = this.detectFlowType(provider, flowInstance);

      // Initiate the flow - this calls the REAL provider
      const initiationResult =
        await flowInstance.initiateDeviceFlow(redirectUri);

      // Generate unique session ID (128-bit, 32 hex chars)
      const sessionId = crypto.randomBytes(16).toString('hex');

      // Store session with flow instance for later exchange
      this.oauthSessions.set(sessionId, {
        provider,
        bucket,
        complete: false,
        createdAt: Date.now(),
        used: false,
        flowType,
        flowInstance,
        // Store PKCE state for pkce_redirect flows (NOT returned to client)
        pkceState:
          flowType === 'pkce_redirect'
            ? initiationResult.device_code
            : undefined,
        // Store device_code for device_code flows - needed for polling
        deviceCode:
          flowType === 'device_code' ? initiationResult.device_code : undefined,
        // Store poll interval for device_code flows (may increase on slow_down)
        pollInterval:
          flowType === 'device_code'
            ? (initiationResult.interval ?? 5)
            : undefined,
      });

      // Build response based on flow type
      const response: Record<string, unknown> = {
        flow_type: flowType,
        session_id: sessionId,
        pollIntervalMs: (initiationResult.interval ?? 5) * 1000,
      };

      // Add flow-type-specific data
      if (flowType === 'pkce_redirect' || flowType === 'browser_redirect') {
        // For redirect flows, return the complete auth URL
        response.auth_url =
          initiationResult.verification_uri_complete ??
          initiationResult.verification_uri;
      } else if (flowType === 'device_code') {
        // For device code flows, return verification URI and user code
        response.auth_url = initiationResult.verification_uri;
        response.verification_uri = initiationResult.verification_uri;
        response.user_code = initiationResult.user_code;
        response.verification_uri_complete =
          initiationResult.verification_uri_complete;
      }

      // SECURITY: Do NOT return PKCE verifier, device_code internals, or flow instance
      // These stay server-side for the exchange step

      this.sendOk(socket, id, response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(socket, id, 'FLOW_INITIATION_FAILED', message);
    }
  }

  /**
   * Detects the OAuth flow type for a given provider.
   *
   * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P03
   */
  private detectFlowType(
    provider: string,
    flowInstance: OAuthFlowInterface,
  ): 'pkce_redirect' | 'device_code' | 'browser_redirect' {
    // Provider-specific flow type detection
    switch (provider.toLowerCase()) {
      case 'anthropic':
        // Anthropic uses PKCE redirect flow
        return 'pkce_redirect';

      case 'qwen':
        // Qwen uses device code flow
        return 'device_code';

      case 'codex':
        // Codex uses browser redirect with local callback
        return 'browser_redirect';

      case 'gemini':
        // Gemini uses PKCE redirect
        return 'pkce_redirect';

      default:
        // Check if flow instance has specific capabilities
        if (
          'pollForToken' in flowInstance &&
          typeof flowInstance.pollForToken === 'function'
        ) {
          return 'device_code';
        }
        // Default to pkce_redirect for unknown providers with exchange capability
        return 'pkce_redirect';
    }
  }

  /**
   * Session timeout in milliseconds (default 10 minutes).
   * Can be overridden via options.oauthSessionTimeoutMs.
   */
  private static readonly SESSION_TIMEOUT_MS = 10 * 60 * 1000;

  /**
   * Handles OAuth code exchange - calls real provider, stores full token.
   *
   * CRITICAL: Token is stored in backingStore WITH refresh_token.
   *           Response is sanitized (refresh_token stripped).
   *
   * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P05
   */
  private async handleOAuthExchange(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const sessionId = payload.session_id as string | undefined;
    const code = payload.code as string | undefined;

    // Validate required fields
    if (!sessionId) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing session_id');
      return;
    }
    if (!code) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing code');
      return;
    }

    // Retrieve session
    const session = this.oauthSessions.get(sessionId);
    if (!session) {
      this.sendError(
        socket,
        id,
        'SESSION_NOT_FOUND',
        'OAuth session not found',
      );
      return;
    }

    // Check if session already used
    if (session.used) {
      this.sendError(
        socket,
        id,
        'SESSION_ALREADY_USED',
        'OAuth session already used',
      );
      return;
    }

    // Check if session expired
    const sessionTimeoutMs =
      (
        this.options as CredentialProxyServerOptions & {
          oauthSessionTimeoutMs?: number;
        }
      ).oauthSessionTimeoutMs ?? CredentialProxyServer.SESSION_TIMEOUT_MS;
    if (Date.now() - session.createdAt > sessionTimeoutMs) {
      this.oauthSessions.delete(sessionId);
      this.sendError(socket, id, 'SESSION_EXPIRED', 'OAuth session expired');
      return;
    }

    // Mark session as used BEFORE attempting exchange (prevent replay)
    session.used = true;

    try {
      // Retrieve flow instance from session
      const flowInstance = session.flowInstance;
      if (
        !flowInstance ||
        typeof flowInstance.exchangeCodeForToken !== 'function'
      ) {
        this.sendError(
          socket,
          id,
          'INTERNAL_ERROR',
          'Session missing flow instance',
        );
        return;
      }

      // Call REAL provider exchange
      const token = await flowInstance.exchangeCodeForToken(
        code,
        session.pkceState,
      );

      // Store FULL token in backing store (INCLUDING refresh_token)
      await this.options.tokenStore.saveToken(
        session.provider,
        token,
        session.bucket,
      );

      // Return SANITIZED token (WITHOUT refresh_token)
      const sanitized = sanitizeTokenForProxy(token);
      this.sendOk(socket, id, sanitized as unknown as Record<string, unknown>);

      // Delete session after successful completion (consistent with handleOAuthPoll)
      this.oauthSessions.delete(sessionId);
    } catch (err) {
      // Session remains marked as used to prevent retry
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(socket, id, 'EXCHANGE_FAILED', message);
    }
  }

  /**
   * Handle OAuth poll request for device_code flows.
   *
   * Polls the provider to check if the user has completed authorization.
   * Returns pending status until complete, then stores and returns the token.
   *
   * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P04d
   */
  private async handleOAuthPoll(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const sessionId = payload.session_id as string | undefined;

    // Validate required fields
    if (!sessionId) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing session_id');
      return;
    }

    // Retrieve session
    const session = this.oauthSessions.get(sessionId);
    if (!session) {
      this.sendError(
        socket,
        id,
        'SESSION_NOT_FOUND',
        'OAuth session not found',
      );
      return;
    }

    // Check session timeout
    const sessionTimeoutMs =
      this.options.oauthSessionTimeoutMs ?? 10 * 60 * 1000;
    if (Date.now() - session.createdAt > sessionTimeoutMs) {
      this.oauthSessions.delete(sessionId);
      this.sendError(socket, id, 'SESSION_EXPIRED', 'OAuth session expired');
      return;
    }

    // Check if session already completed
    if (session.used) {
      this.sendError(
        socket,
        id,
        'SESSION_ALREADY_USED',
        'OAuth session already completed',
      );
      return;
    }

    // Verify session has flow instance and device_code (required for polling)
    if (!session.flowInstance) {
      this.sendError(
        socket,
        id,
        'INTERNAL_ERROR',
        'Session missing flow instance',
      );
      return;
    }
    if (!session.deviceCode) {
      this.sendError(
        socket,
        id,
        'INTERNAL_ERROR',
        'Session missing device_code',
      );
      return;
    }

    // Verify flow instance has pollForToken method
    if (
      !('pollForToken' in session.flowInstance) ||
      typeof session.flowInstance.pollForToken !== 'function'
    ) {
      this.sendError(
        socket,
        id,
        'INTERNAL_ERROR',
        'Flow instance does not support polling',
      );
      return;
    }

    try {
      // Poll the provider for token
      const token = await session.flowInstance.pollForToken(session.deviceCode);

      // Success! Token received from provider
      // Mark session as used BEFORE storing to prevent race conditions
      session.used = true;

      // Store FULL token (including refresh_token) in backing store
      await this.options.tokenStore.saveToken(
        session.provider,
        token,
        session.bucket,
      );

      // Return SANITIZED token (no refresh_token crosses socket boundary)
      const sanitized = sanitizeTokenForProxy(token);

      this.sendOk(socket, id, {
        status: 'complete',
        token: sanitized,
      });

      // Clean up session after successful completion
      this.oauthSessions.delete(sessionId);
    } catch (error: unknown) {
      // Handle provider-specific polling responses
      const err = error as Error & { code?: string; newInterval?: number };
      const errorCode = err.code || err.message;

      switch (errorCode) {
        case 'authorization_pending':
          // User hasn't completed authorization yet - this is normal
          this.sendOk(socket, id, {
            status: 'pending',
          });
          return;

        case 'slow_down':
          // Provider asking us to slow down polling
          // Return pending with increased interval
          {
            const currentInterval = session.pollInterval ?? 5;
            const newInterval = err.newInterval ?? currentInterval + 5;
            session.pollInterval = newInterval;
            this.sendOk(socket, id, {
              status: 'pending',
              interval: newInterval,
            });
          }
          return;

        case 'expired_token':
          // Device code expired - session is dead
          this.oauthSessions.delete(sessionId);
          this.sendError(socket, id, 'SESSION_EXPIRED', 'Device code expired');
          return;

        case 'access_denied':
          // User denied authorization
          this.oauthSessions.delete(sessionId);
          this.sendError(
            socket,
            id,
            'ACCESS_DENIED',
            'User denied authorization',
          );
          return;

        default:
          // Unexpected error
          this.sendError(
            socket,
            id,
            'POLL_FAILED',
            err.message || 'Poll failed',
          );
          return;
      }
    }
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

  /**
   * Handles token refresh - uses RefreshCoordinator for rate limiting/dedup.
   *
   * CRITICAL: Token is stored in backingStore WITH refresh_token.
   *           Response is sanitized (refresh_token stripped).
   *           RefreshCoordinator handles rate limiting (30s) and deduplication.
   *
   * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P07
   */
  private async handleRefreshToken(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const provider = payload.provider as string | undefined;
    const bucket = payload.bucket as string | undefined;

    // Validate required fields
    if (!provider) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
      return;
    }

    // Check if provider is configured in flowFactories (before checking token)
    const flowFactory = this.options.flowFactories?.get(provider);
    if (!flowFactory) {
      this.sendError(
        socket,
        id,
        'PROVIDER_NOT_FOUND',
        `No OAuth provider configured for: ${provider}`,
      );
      return;
    }

    // Get existing token to check if it exists and has refresh_token
    const existingToken = await this.options.tokenStore.getToken(
      provider,
      bucket,
    );
    if (!existingToken) {
      this.sendError(
        socket,
        id,
        'NOT_FOUND',
        `No token found for provider: ${provider}`,
      );
      return;
    }

    // Must have refresh_token to refresh
    if (!existingToken.refresh_token) {
      this.sendError(
        socket,
        id,
        'REFRESH_NOT_AVAILABLE',
        `Token for ${provider} does not have a refresh_token`,
      );
      return;
    }

    // Use RefreshCoordinator for rate limiting and deduplication
    const refreshResult = await this.refreshCoordinator.refresh(
      provider,
      bucket,
    );

    // Handle the result based on status
    switch (refreshResult.status) {
      case 'ok':
        // Success - return sanitized token (refresh_token already stripped by coordinator)
        this.sendOk(
          socket,
          id,
          refreshResult.token as unknown as Record<string, unknown>,
        );
        break;

      case 'rate_limited':
        // Rate limited - return error with retryAfter
        socket.write(
          encodeFrame({
            id,
            ok: false,
            code: 'RATE_LIMITED',
            error: 'Refresh rate limited',
            retryAfter: refreshResult.retryAfter ?? 30,
          }),
        );
        break;

      case 'auth_error':
        // Auth error (invalid_grant, etc.) - require re-authentication
        this.sendError(
          socket,
          id,
          'REAUTH_REQUIRED',
          refreshResult.error ?? 'Authentication error during refresh',
        );
        break;

      case 'error':
        // Generic error
        this.sendError(
          socket,
          id,
          'REFRESH_FAILED',
          refreshResult.error ?? 'Token refresh failed',
        );
        break;

      default:
        // Exhaustive check - should never reach here
        this.sendError(
          socket,
          id,
          'INTERNAL_ERROR',
          `Unexpected refresh result status`,
        );
    }
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
