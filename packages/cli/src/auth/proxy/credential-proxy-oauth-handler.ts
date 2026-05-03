/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as crypto from 'node:crypto';
import type * as net from 'node:net';
import type { OAuthToken, TokenStore } from '@vybestack/llxprt-code-core';
import {
  encodeFrame,
  sanitizeTokenForProxy,
} from '@vybestack/llxprt-code-core';
import { RefreshCoordinator } from './refresh-coordinator.js';

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

export interface CredentialProxyOAuthOptions {
  tokenStore: TokenStore;
  flowFactories?: Map<string, () => OAuthFlowInterface>;
  oauthSessionTimeoutMs?: number;
  refreshCoordinator?: RefreshCoordinator;
}

type OAuthFlowType = 'pkce_redirect' | 'device_code' | 'browser_redirect';

interface InitiationResult {
  device_code: string;
  user_code?: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

interface OAuthSession {
  provider: string;
  bucket?: string;
  complete: boolean;
  token?: OAuthToken;
  createdAt: number;
  used: boolean;
  flowType: OAuthFlowType;
  flowInstance: OAuthFlowInterface;
  pkceState?: string;
  deviceCode?: string;
  pollInterval?: number;
}

const SESSION_TIMEOUT_MS = 10 * 60 * 1000;

function detectFlowType(
  provider: string,
  flowInstance: OAuthFlowInterface,
): OAuthFlowType {
  switch (provider.toLowerCase()) {
    case 'anthropic':
    case 'gemini':
      return 'pkce_redirect';
    case 'qwen':
      return 'device_code';
    case 'codex':
      return 'browser_redirect';
    default:
      if (typeof flowInstance.pollForToken === 'function') {
        return 'device_code';
      }
      return 'pkce_redirect';
  }
}

function createOAuthSession(
  provider: string,
  bucket: string | undefined,
  flowType: OAuthFlowType,
  flowInstance: OAuthFlowInterface,
  initiationResult: InitiationResult,
): OAuthSession {
  return {
    provider,
    bucket,
    complete: false,
    createdAt: Date.now(),
    used: false,
    flowType,
    flowInstance,
    pkceState:
      flowType === 'pkce_redirect' ? initiationResult.device_code : undefined,
    deviceCode:
      flowType === 'device_code' ? initiationResult.device_code : undefined,
    pollInterval:
      flowType === 'device_code' ? (initiationResult.interval ?? 5) : undefined,
  };
}

function buildInitiationResponse(
  flowType: OAuthFlowType,
  sessionId: string,
  initiationResult: InitiationResult,
): Record<string, unknown> {
  const response: Record<string, unknown> = {
    flow_type: flowType,
    session_id: sessionId,
    pollIntervalMs: (initiationResult.interval ?? 5) * 1000,
  };

  if (flowType === 'device_code') {
    response.auth_url = initiationResult.verification_uri;
    response.verification_uri = initiationResult.verification_uri;
    response.user_code = initiationResult.user_code;
    response.verification_uri_complete =
      initiationResult.verification_uri_complete;
    return response;
  }

  response.auth_url =
    initiationResult.verification_uri_complete ??
    initiationResult.verification_uri;
  return response;
}

function getSessionTimeoutMs(options: CredentialProxyOAuthOptions): number {
  return options.oauthSessionTimeoutMs ?? SESSION_TIMEOUT_MS;
}

export class CredentialProxyOAuthHandler {
  private readonly refreshCoordinator: RefreshCoordinator;
  private readonly oauthSessions = new Map<string, OAuthSession>();

  constructor(private readonly options: CredentialProxyOAuthOptions) {
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
        cooldownMs: 30 * 1000,
      });
  }

  async handleInitiate(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const provider = payload.provider as string | undefined;
    const bucket = payload.bucket as string | undefined;
    const redirectUri = payload.redirect_uri as string | undefined;

    if (!provider) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
      return;
    }

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
      const flowInstance = flowFactory();
      const flowType = detectFlowType(provider, flowInstance);
      const initiationResult =
        await flowInstance.initiateDeviceFlow(redirectUri);
      const sessionId = crypto.randomBytes(16).toString('hex');
      this.oauthSessions.set(
        sessionId,
        createOAuthSession(
          provider,
          bucket,
          flowType,
          flowInstance,
          initiationResult,
        ),
      );
      this.sendOk(
        socket,
        id,
        buildInitiationResponse(flowType, sessionId, initiationResult),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(socket, id, 'FLOW_INITIATION_FAILED', message);
    }
  }

  async handleExchange(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const sessionId = payload.session_id as string | undefined;
    const code = payload.code as string | undefined;
    if (!sessionId || !code) {
      this.sendError(
        socket,
        id,
        'INVALID_REQUEST',
        sessionId ? 'Missing code' : 'Missing session_id',
      );
      return;
    }

    const session = this.getActiveSession(
      socket,
      id,
      sessionId,
      'OAuth session already used',
    );
    if (!session) {
      return;
    }

    session.used = true;
    try {
      const token = await this.exchangeCode(session, code);
      await this.options.tokenStore.saveToken(
        session.provider,
        token,
        session.bucket,
      );
      this.sendOk(
        socket,
        id,
        sanitizeTokenForProxy(token) as unknown as Record<string, unknown>,
      );
      this.oauthSessions.delete(sessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(socket, id, 'EXCHANGE_FAILED', message);
    }
  }

  async handlePoll(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const sessionId = payload.session_id as string | undefined;
    if (!sessionId) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing session_id');
      return;
    }

    const session = this.getPollableSession(socket, id, sessionId);
    if (!session) {
      return;
    }

    try {
      await this.completePoll(socket, id, sessionId, session);
    } catch (error: unknown) {
      this.handlePollError(socket, id, sessionId, session, error);
    }
  }

  handleCancel(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): void {
    const sessionId = payload.session_id as string | undefined;
    if (!sessionId) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing session_id');
      return;
    }

    this.oauthSessions.delete(sessionId);
    this.sendOk(socket, id, {});
  }

  async handleRefreshToken(
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
    if (!this.options.flowFactories?.get(provider)) {
      this.sendError(
        socket,
        id,
        'PROVIDER_NOT_FOUND',
        `No OAuth provider configured for: ${provider}`,
      );
      return;
    }

    const existingToken = await this.options.tokenStore.getToken(
      provider,
      bucket,
    );
    if (!this.canRefresh(socket, id, provider, existingToken)) {
      return;
    }

    const refreshResult = await this.refreshCoordinator.refresh(
      provider,
      bucket,
    );
    this.sendRefreshResult(socket, id, refreshResult);
  }

  private getActiveSession(
    socket: net.Socket,
    id: string,
    sessionId: string,
    usedMessage: string,
  ): OAuthSession | undefined {
    const session = this.oauthSessions.get(sessionId);
    if (!session) {
      this.sendError(
        socket,
        id,
        'SESSION_NOT_FOUND',
        'OAuth session not found',
      );
      return undefined;
    }
    if (session.used) {
      this.sendError(socket, id, 'SESSION_ALREADY_USED', usedMessage);
      return undefined;
    }
    if (Date.now() - session.createdAt > getSessionTimeoutMs(this.options)) {
      this.oauthSessions.delete(sessionId);
      this.sendError(socket, id, 'SESSION_EXPIRED', 'OAuth session expired');
      return undefined;
    }
    return session;
  }

  private getPollableSession(
    socket: net.Socket,
    id: string,
    sessionId: string,
  ): OAuthSession | undefined {
    const session = this.getActiveSession(
      socket,
      id,
      sessionId,
      'OAuth session already completed',
    );
    if (!session) {
      return undefined;
    }
    if (!session.deviceCode) {
      this.sendError(
        socket,
        id,
        'INTERNAL_ERROR',
        'Session missing device_code',
      );
      return undefined;
    }
    if (typeof session.flowInstance.pollForToken !== 'function') {
      this.sendError(
        socket,
        id,
        'INTERNAL_ERROR',
        'Flow instance does not support polling',
      );
      return undefined;
    }
    return session;
  }

  private async exchangeCode(
    session: OAuthSession,
    code: string,
  ): Promise<OAuthToken> {
    const exchangeCodeForToken = session.flowInstance.exchangeCodeForToken;
    if (typeof exchangeCodeForToken !== 'function') {
      throw new Error('Session missing flow instance');
    }
    return exchangeCodeForToken.call(
      session.flowInstance,
      code,
      session.pkceState,
    );
  }

  private async completePoll(
    socket: net.Socket,
    id: string,
    sessionId: string,
    session: OAuthSession,
  ): Promise<void> {
    const pollForToken = session.flowInstance.pollForToken;
    if (
      typeof pollForToken !== 'function' ||
      session.deviceCode === undefined
    ) {
      this.sendError(
        socket,
        id,
        'INTERNAL_ERROR',
        'Session missing device_code',
      );
      return;
    }
    const token = await pollForToken.call(
      session.flowInstance,
      session.deviceCode,
    );
    session.used = true;
    await this.options.tokenStore.saveToken(
      session.provider,
      token,
      session.bucket,
    );
    this.sendOk(socket, id, {
      status: 'complete',
      token: sanitizeTokenForProxy(token),
    });
    this.oauthSessions.delete(sessionId);
  }

  private handlePollError(
    socket: net.Socket,
    id: string,
    sessionId: string,
    session: OAuthSession,
    error: unknown,
  ): void {
    const err = error as Error & { code?: string; newInterval?: number };
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string code should fall back to message
    const errorCode = err.code || err.message;

    if (errorCode === 'authorization_pending') {
      this.sendOk(socket, id, { status: 'pending' });
    } else if (errorCode === 'slow_down') {
      const currentInterval = session.pollInterval ?? 5;
      const newInterval = err.newInterval ?? currentInterval + 5;
      session.pollInterval = newInterval;
      this.sendOk(socket, id, { status: 'pending', interval: newInterval });
    } else if (errorCode === 'expired_token') {
      this.oauthSessions.delete(sessionId);
      this.sendError(socket, id, 'SESSION_EXPIRED', 'Device code expired');
    } else if (errorCode === 'access_denied') {
      this.oauthSessions.delete(sessionId);
      this.sendError(socket, id, 'ACCESS_DENIED', 'User denied authorization');
    } else {
      this.sendError(socket, id, 'POLL_FAILED', err.message || 'Poll failed');
    }
  }

  private canRefresh(
    socket: net.Socket,
    id: string,
    provider: string,
    existingToken: OAuthToken | null,
  ): existingToken is OAuthToken {
    if (!existingToken) {
      this.sendError(
        socket,
        id,
        'NOT_FOUND',
        `No token found for provider: ${provider}`,
      );
      return false;
    }
    if (!existingToken.refresh_token) {
      this.sendError(
        socket,
        id,
        'REFRESH_NOT_AVAILABLE',
        `Token for ${provider} does not have a refresh_token`,
      );
      return false;
    }
    return true;
  }

  private sendRefreshResult(
    socket: net.Socket,
    id: string,
    refreshResult: Awaited<ReturnType<RefreshCoordinator['refresh']>>,
  ): void {
    switch (refreshResult.status) {
      case 'ok':
        this.sendOk(
          socket,
          id,
          refreshResult.token as unknown as Record<string, unknown>,
        );
        break;
      case 'rate_limited':
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
        this.sendError(
          socket,
          id,
          'REAUTH_REQUIRED',
          refreshResult.error ?? 'Authentication error during refresh',
        );
        break;
      case 'error':
        this.sendError(
          socket,
          id,
          'REFRESH_FAILED',
          refreshResult.error ?? 'Token refresh failed',
        );
        break;
      default:
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
    socket.write(encodeFrame({ id, ok: true, data }));
  }

  private sendError(
    socket: net.Socket,
    id: string,
    code: string,
    error: string,
  ): void {
    socket.write(encodeFrame({ id, ok: false, code, error }));
  }
}
