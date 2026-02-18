/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';

/**
 * @plan PLAN-20250214-CREDPROXY.P26
 * @plan:PLAN-20250214-CREDPROXY.P26
 * @plan:PLAN-20250214-CREDPROXY.P24
 * @requirement R17.1-R17.3, R18.1, R19.1, R20.1-R20.9
 * @pseudocode analysis/pseudocode/008-oauth-session-manager.md
 */
export interface OAuthSession {
  sessionId: string;
  provider: string;
  bucket: string;
  flowType: 'pkce_redirect' | 'device_code' | 'browser_redirect';
  flowInstance: unknown;
  codeVerifier?: { codeVerifier: string };
  deviceCode?: string;
  pollIntervalMs?: number;
  abortController?: AbortController;
  result?: { token: unknown } | { error: string; code: string };
  createdAt: number;
  peerIdentity: unknown;
  used: boolean;
}

export class PKCESessionStore {
  private readonly sessions: Map<string, OAuthSession> = new Map();
  private readonly sessionTimeoutMs: number;
  private gcInterval: NodeJS.Timeout | null = null;

  constructor(sessionTimeoutMs: number = 600_000) {
    const envTimeoutSeconds = process.env.LLXPRT_OAUTH_SESSION_TIMEOUT_SECONDS;
    const parsedEnvTimeoutSeconds = Number.parseInt(
      envTimeoutSeconds ?? '',
      10,
    );
    this.sessionTimeoutMs =
      Number.isFinite(parsedEnvTimeoutSeconds) && parsedEnvTimeoutSeconds > 0
        ? parsedEnvTimeoutSeconds * 1000
        : sessionTimeoutMs;
  }

  startGC(): void {
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
    }
    this.gcInterval = setInterval(() => this.sweepExpired(), 60_000);
  }

  sweepExpired(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (now - session.createdAt > this.sessionTimeoutMs || session.used) {
        session.abortController?.abort();
        this.sessions.delete(sessionId);
      }
    }
  }

  createSession(
    provider: string,
    bucket: string,
    flowType: OAuthSession['flowType'],
    flowInstance: unknown,
    peerIdentity: unknown,
  ): string {
    const sessionId = crypto.randomBytes(16).toString('hex');
    this.sessions.set(sessionId, {
      sessionId,
      provider,
      bucket,
      flowType,
      flowInstance,
      createdAt: Date.now(),
      peerIdentity,
      used: false,
    });
    return sessionId;
  }

  getSession(sessionId: string, peerIdentity: unknown): OAuthSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('SESSION_NOT_FOUND');
    }

    if (session.used) {
      throw new Error('SESSION_ALREADY_USED');
    }

    if (Date.now() - session.createdAt > this.sessionTimeoutMs) {
      session.abortController?.abort();
      this.sessions.delete(sessionId);
      throw new Error('SESSION_EXPIRED');
    }

    if (
      this.isUidPeerIdentity(session.peerIdentity) &&
      this.isUidPeerIdentity(peerIdentity) &&
      session.peerIdentity.uid !== peerIdentity.uid
    ) {
      throw new Error('UNAUTHORIZED: Session peer identity mismatch');
    }

    return session;
  }

  markUsed(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.used = true;
    }
  }

  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.abortController) {
      session.abortController.abort();
    }
    this.sessions.delete(sessionId);
  }

  clearAll(): void {
    for (const session of this.sessions.values()) {
      session.abortController?.abort();
    }
    this.sessions.clear();
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = null;
    }
  }

  private isUidPeerIdentity(
    peerIdentity: unknown,
  ): peerIdentity is { type: 'uid'; uid: number } {
    return (
      typeof peerIdentity === 'object' &&
      peerIdentity !== null &&
      'type' in peerIdentity &&
      'uid' in peerIdentity &&
      (peerIdentity as { type?: unknown }).type === 'uid' &&
      typeof (peerIdentity as { uid?: unknown }).uid === 'number'
    );
  }
}
