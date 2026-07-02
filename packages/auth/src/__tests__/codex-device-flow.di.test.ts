/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260608-ISSUE1586.P10
 * @requirement REQ-TEST-001.1, REQ-TEST-001.3
 *
 * CodexDeviceFlow DI behavioral tests.
 * Tests verify flow behavior with optional IDebugLogger injection.
 * Assertions on returned URL/data, not on logger call details.
 *
 * NOTE: Several existing CodexDeviceFlow tests (codex-device-flow.test.ts,
 * codex-device-flow.spec.ts) currently fail because the no-op logger fallback
 * in the constructor creates a bare function instead of an IDebugLogger object.
 * This is documented as an expected P10 failure pending P11 DI implementation
 * of the logger default stub.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { CodexDeviceFlow } from '../flows/codex-device-flow.js';
import type { IDebugLogger } from '../interfaces/index.js';

// ─── Test doubles ────────────────────────────────────────────────────────────

function createCollectingLogger(): IDebugLogger & {
  readonly entries: Array<{ level: string; args: unknown[] }>;
} {
  const entries: Array<{ level: string; args: unknown[] }> = [];
  return {
    entries,
    debug: (...args: unknown[]) => entries.push({ level: 'debug', args }),
    error: (...args: unknown[]) => entries.push({ level: 'error', args }),
    warn: (...args: unknown[]) => entries.push({ level: 'warn', args }),
    log: (...args: unknown[]) => entries.push({ level: 'log', args }),
  };
}

function createTestIdToken(accountId: string): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    'https://api.openai.com/auth': { account_id: accountId },
    sub: 'user123',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const headerEncoded = Buffer.from(JSON.stringify(header)).toString(
    'base64url',
  );
  const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  );
  return `${headerEncoded}.${payloadEncoded}.fake-signature`;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CodexDeviceFlow DI behavioral tests', () => {
  it('constructs with injected IDebugLogger without error', () => {
    const logger = createCollectingLogger();
    const flow = new CodexDeviceFlow({ logger });
    expect(flow).toBeInstanceOf(CodexDeviceFlow);
  });

  it('constructs without logger (uses fallback) without error', () => {
    const flow = new CodexDeviceFlow();
    expect(flow).toBeInstanceOf(CodexDeviceFlow);
  });

  it('buildAuthorizationUrl returns valid URL with PKCE parameters when logger injected', () => {
    const logger = createCollectingLogger();
    const flow = new CodexDeviceFlow({ logger });
    const redirectUri = 'http://127.0.0.1:1455/callback';
    const state = 'test-state-di';

    const url = flow.buildAuthorizationUrl(redirectUri, state);

    // Assert returned URL structure (not logger calls)
    expect(url).toContain('https://auth.openai.com/oauth/authorize');
    expect(url).toContain('code_challenge=');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('state=test-state-di');
    expect(url).toContain('response_type=code');
    expect(url).toContain('client_id=');

    // Verify logger was used (behavioral, not call count)
    expect(logger.entries.length).toBeGreaterThan(0);
    const hasDebugEntry = logger.entries.some(
      (e) =>
        e.level === 'debug' && String(e.args).includes('buildAuthorizationUrl'),
    );
    expect(hasDebugEntry).toBe(true);
  });

  it('buildAuthorizationUrl includes correct scopes', () => {
    const flow = new CodexDeviceFlow({ logger: createCollectingLogger() });
    const url = flow.buildAuthorizationUrl(
      'http://127.0.0.1:1455/callback',
      'state',
    );

    const scopeMatch = url.match(/scope=([^&]+)/);
    expect(scopeMatch).not.toBeNull();
    const scopes = decodeURIComponent(scopeMatch![1]).split(' ');
    expect(scopes).toContain('openid');
    expect(scopes).toContain('profile');
    expect(scopes).toContain('email');
    expect(scopes).toContain('offline_access');
  });

  it('buildAuthorizationUrl generates unique code challenges per call', () => {
    const flow = new CodexDeviceFlow({ logger: createCollectingLogger() });

    const url1 = flow.buildAuthorizationUrl(
      'http://127.0.0.1:1455/callback',
      'state1',
    );
    const url2 = flow.buildAuthorizationUrl(
      'http://127.0.0.1:1455/callback',
      'state2',
    );

    const challenge1 = url1.match(/code_challenge=([^&]+)/)?.[1];
    const challenge2 = url2.match(/code_challenge=([^&]+)/)?.[1];

    expect(challenge1).not.toBe(challenge2);
    // SHA-256 base64url = 43 chars
    expect(decodeURIComponent(challenge1!)).toHaveLength(43);
  });

  it('exchangeCodeForToken throws when state not found', async () => {
    const flow = new CodexDeviceFlow({ logger: createCollectingLogger() });

    await expect(
      flow.exchangeCodeForToken(
        'code',
        'http://127.0.0.1:1455/callback',
        'unknown-state',
      ),
    ).rejects.toThrow('PKCE code verifier not found for state');
  });

  describe('with test HTTP server for token exchange', () => {
    let testServer: Server;
    let serverPort: number;

    beforeEach(async () => {
      testServer = createServer();
      await new Promise<void>((resolve) => {
        testServer.listen(0, () => {
          serverPort = (testServer.address() as AddressInfo).port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        testServer.close(() => resolve());
      });
    });

    it('exchangeCodeForToken returns CodexOAuthToken with account_id', async () => {
      const logger = createCollectingLogger();
      const flow = new CodexDeviceFlow({ logger });

      const mockTokenResponse = {
        access_token: 'test-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'test-refresh-token',
        id_token: createTestIdToken('account-123'),
      };

      testServer.removeAllListeners('request');
      testServer.on('request', (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockTokenResponse));
      });

      const redirectUri = 'http://127.0.0.1:1455/callback';
      const state = 'exchange-test-state';
      flow.buildAuthorizationUrl(redirectUri, state);

      const originalFetch = global.fetch;
      global.fetch = vi.fn((input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes('auth.openai.com/oauth/token')) {
          return originalFetch(`http://localhost:${serverPort}/oauth/token`, {
            method: 'POST',
          });
        }
        return originalFetch(input);
      }) as typeof fetch;

      try {
        const token = await flow.exchangeCodeForToken(
          'test-auth-code',
          redirectUri,
          state,
        );

        // Assert returned data
        expect(token.access_token).toBe('test-access-token');
        expect(token.account_id).toBe('account-123');
        expect(token.token_type).toBe('Bearer');
        expect(token.refresh_token).toBe('test-refresh-token');
        expect(token.expiry).toBeGreaterThan(Math.floor(Date.now() / 1000));
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('refreshToken returns new token via server', async () => {
      const logger = createCollectingLogger();
      const flow = new CodexDeviceFlow({ logger });

      const mockRefreshResponse = {
        access_token: 'refreshed-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
        id_token: createTestIdToken('account-456'),
      };

      testServer.removeAllListeners('request');
      testServer.on('request', (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockRefreshResponse));
      });

      const originalFetch = global.fetch;
      global.fetch = vi.fn((input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes('auth.openai.com/oauth/token')) {
          return originalFetch(`http://localhost:${serverPort}/oauth/token`, {
            method: 'POST',
          });
        }
        return originalFetch(input);
      }) as typeof fetch;

      try {
        const token = await flow.refreshToken('old-refresh-token');

        expect(token.access_token).toBe('refreshed-access-token');
        expect(token.account_id).toBe('account-456');
        expect(token.refresh_token).toBe('new-refresh-token');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  it('logger receives debug messages during buildAuthorizationUrl', () => {
    const logger = createCollectingLogger();
    const flow = new CodexDeviceFlow({ logger });

    flow.buildAuthorizationUrl('http://127.0.0.1:1455/callback', 'state');

    // Assert logger received entries (behavioral), not specific call count
    expect(logger.entries.length).toBeGreaterThan(0);
    const allDebug = logger.entries.every((e) => e.level === 'debug');
    // All entries should be debug level for buildAuthorizationUrl
    expect(allDebug).toBe(true);
  });
});
