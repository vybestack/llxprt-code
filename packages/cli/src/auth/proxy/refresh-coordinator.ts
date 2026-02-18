/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Coordinates token refresh operations for the credential proxy server.
 * Provides rate limiting, concurrent deduplication, and retry logic.
 *
 * @plan PLAN-20250214-CREDPROXY.P18
 * @requirement R5, R6
 * @pseudocode analysis/pseudocode/006-refresh-coordinator.md
 */

import type { TokenStore, OAuthToken } from '@vybestack/llxprt-code-core';
import {
  mergeRefreshedToken,
  sanitizeTokenForProxy,
} from '@vybestack/llxprt-code-core';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_RETRIES = 2;
const RETRY_DELAYS = [1_000, 3_000];
const AUTH_ERROR_PATTERNS = [
  '401',
  'invalid_grant',
  'invalid_client',
  'unauthorized',
];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RefreshResult {
  status: 'ok' | 'rate_limited' | 'auth_error' | 'error';
  token?: OAuthToken;
  retryAfter?: number;
  error?: string;
}

export interface RefreshCoordinatorOptions {
  tokenStore: TokenStore;
  refreshFn: (
    provider: string,
    currentToken: OAuthToken,
  ) => Promise<OAuthToken>;
  cooldownMs?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  if (AUTH_ERROR_PATTERNS.some((p) => msg.includes(p))) return true;
  const anyErr = error as unknown as Record<string, unknown>;
  if (anyErr.status === 401) return true;
  if (
    typeof anyErr.code === 'string' &&
    AUTH_ERROR_PATTERNS.some((p) => anyErr.code === p)
  )
    return true;
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Coordinator ─────────────────────────────────────────────────────────────

export class RefreshCoordinator {
  private readonly options: RefreshCoordinatorOptions;
  private readonly cooldownMs: number;
  private readonly lastRefreshMap: Map<string, number> = new Map();
  private readonly inflightMap: Map<string, Promise<RefreshResult>> = new Map();

  constructor(options: RefreshCoordinatorOptions) {
    this.options = options;
    this.cooldownMs = options.cooldownMs ?? 30_000;
  }

  async refresh(provider: string, bucket?: string): Promise<RefreshResult> {
    const key = bucket ? `${provider}:${bucket}` : provider;

    const inflight = this.inflightMap.get(key);
    if (inflight) return inflight;

    const lastRefresh = this.lastRefreshMap.get(key);
    if (lastRefresh !== undefined) {
      const elapsed = Date.now() - lastRefresh;
      if (elapsed < this.cooldownMs) {
        const remainingMs = this.cooldownMs - elapsed;
        return {
          status: 'rate_limited',
          retryAfter: Math.ceil(remainingMs / 1_000),
        };
      }
    }

    const promise = this.executeRefresh(provider, bucket, key);
    this.inflightMap.set(key, promise);

    try {
      return await promise;
    } finally {
      this.inflightMap.delete(key);
    }
  }

  reset(): void {
    this.lastRefreshMap.clear();
    this.inflightMap.clear();
  }

  private async executeRefresh(
    provider: string,
    bucket: string | undefined,
    key: string,
  ): Promise<RefreshResult> {
    const { tokenStore, refreshFn } = this.options;

    const currentToken = await tokenStore.getToken(provider, bucket);
    if (!currentToken) {
      return { status: 'error', error: 'Token not found' };
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const newToken = await refreshFn(provider, currentToken);
        const merged = mergeRefreshedToken(currentToken, newToken);
        await tokenStore.saveToken(provider, merged, bucket);
        this.lastRefreshMap.set(key, Date.now());
        const sanitized = sanitizeTokenForProxy(merged) as OAuthToken;
        return { status: 'ok', token: sanitized };
      } catch (err: unknown) {
        if (isAuthError(err)) {
          return {
            status: 'auth_error',
            error: err instanceof Error ? err.message : String(err),
          };
        }

        if (attempt < MAX_RETRIES) {
          await delay(RETRY_DELAYS[attempt]);
        } else {
          return {
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    }

    return { status: 'error', error: 'Refresh failed' };
  }
}
