/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250214-CREDPROXY.P28
 * @plan:PLAN-20250214-CREDPROXY.P28
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProxyOAuthAdapter } from '../proxy-oauth-adapter.js';

type RequestRecord = {
  type: string;
  payload: Record<string, unknown>;
};

type QueuedReply = {
  type: string;
  data?: Record<string, unknown>;
  error?: Error;
};

class SocketClientDouble {
  readonly requests: RequestRecord[] = [];
  private readonly queue: QueuedReply[] = [];

  enqueue(type: string, data: Record<string, unknown>): void {
    this.queue.push({ type, data });
  }

  enqueueError(type: string, error: Error): void {
    this.queue.push({ type, error });
  }

  async request(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown> }> {
    this.requests.push({ type, payload });
    const next = this.queue.shift();
    if (!next) {
      throw new Error(`No queued response for ${type}`);
    }
    if (next.type !== type) {
      throw new Error(
        `Expected queued response ${next.type} but received ${type}`,
      );
    }
    if (next.error) {
      throw next.error;
    }
    return { data: next.data ?? {} };
  }
}

describe('ProxyOAuthAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * @requirement R17.4
   * @scenario login dispatches pkce_redirect flow and returns exchange token payload
   */
  it('handles pkce_redirect login flow end-to-end', async () => {
    const socket = new SocketClientDouble();
    socket.enqueue('oauth_initiate', {
      flow_type: 'pkce_redirect',
      session_id: 'session-pkce-1',
      auth_url: 'https://example.test/auth',
    });
    socket.enqueue('oauth_exchange', {
      access_token: 'pkce-token',
      expiry: 111,
      token_type: 'Bearer',
    });

    vi.spyOn(process.stdin, 'once').mockImplementation(
      (event: string, cb: (chunk: string) => void) => {
        if (event === 'data') {
          cb('abc123\n');
        }
        return process.stdin;
      },
    );

    const adapter = new ProxyOAuthAdapter(socket as never);
    const result = await adapter.login('anthropic', 'default');

    expect(socket.requests.map((r) => r.type)).toEqual([
      'oauth_initiate',
      'oauth_exchange',
    ]);
    expect(socket.requests[1].payload).toEqual({
      session_id: 'session-pkce-1',
      code: 'abc123',
    });
    expect(result).toEqual({
      access_token: 'pkce-token',
      expiry: 111,
      token_type: 'Bearer',
    });
  });

  /**
   * @requirement R17.4
   * @scenario login dispatches device_code flow and polls until complete
   */
  it('handles device_code login flow pending then complete', async () => {
    const socket = new SocketClientDouble();
    socket.enqueue('oauth_initiate', {
      flow_type: 'device_code',
      session_id: 'session-device-1',
      verification_url: 'https://example.test/verify',
      user_code: 'ABCD-EFGH',
      pollIntervalMs: 5000,
    });
    socket.enqueue('oauth_poll', { status: 'pending' });
    socket.enqueue('oauth_poll', {
      status: 'complete',
      access_token: 'device-token',
      expiry: 222,
      token_type: 'Bearer',
    });

    const adapter = new ProxyOAuthAdapter(socket as never);
    const loginPromise = adapter.login('qwen', 'default');

    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await loginPromise;

    expect(socket.requests.map((r) => r.type)).toEqual([
      'oauth_initiate',
      'oauth_poll',
      'oauth_poll',
    ]);
    expect(result).toEqual({
      status: 'complete',
      access_token: 'device-token',
      expiry: 222,
      token_type: 'Bearer',
    });
  });

  /**
   * @requirement R17.4
   * @scenario login dispatches browser_redirect flow and polls until complete
   */
  it('handles browser_redirect login flow pending then complete', async () => {
    const socket = new SocketClientDouble();
    socket.enqueue('oauth_initiate', {
      flow_type: 'browser_redirect',
      session_id: 'session-browser-1',
      auth_url: 'https://example.test/browser-auth',
    });
    socket.enqueue('oauth_poll', { status: 'pending' });
    socket.enqueue('oauth_poll', {
      status: 'complete',
      access_token: 'browser-token',
      expiry: 333,
      token_type: 'Bearer',
    });

    const adapter = new ProxyOAuthAdapter(socket as never);
    const loginPromise = adapter.login('codex', 'default');

    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await loginPromise;

    expect(socket.requests.map((r) => r.type)).toEqual([
      'oauth_initiate',
      'oauth_poll',
      'oauth_poll',
    ]);
    expect(result).toEqual({
      status: 'complete',
      access_token: 'browser-token',
      expiry: 333,
      token_type: 'Bearer',
    });
  });

  /**
   * @requirement R17.4
   * @scenario login throws for unknown flow type
   */
  it('throws unknown flow type errors', async () => {
    const socket = new SocketClientDouble();
    socket.enqueue('oauth_initiate', {
      flow_type: 'mystery_flow',
      session_id: 'session-unknown-1',
    });
    socket.enqueue('oauth_cancel', {});

    const adapter = new ProxyOAuthAdapter(socket as never);

    await expect(adapter.login('anthropic', 'default')).rejects.toThrow(
      'Unknown flow type: mystery_flow',
    );
    expect(socket.requests.map((r) => r.type)).toEqual([
      'oauth_initiate',
      'oauth_cancel',
    ]);
  });

  /**
   * @requirement R17.4
   * @scenario login best-effort cancels session when handler fails
   */
  it('cancels session on handler error then rethrows', async () => {
    const socket = new SocketClientDouble();
    socket.enqueue('oauth_initiate', {
      flow_type: 'pkce_redirect',
      session_id: 'session-cancel-on-error',
      auth_url: 'https://example.test/auth',
    });
    socket.enqueue('oauth_cancel', {});

    vi.spyOn(process.stdin, 'once').mockImplementation(
      (event: string, cb: (chunk: string) => void) => {
        if (event === 'data') {
          cb('   \n');
        }
        return process.stdin;
      },
    );

    const adapter = new ProxyOAuthAdapter(socket as never);

    await expect(adapter.login('anthropic', 'default')).rejects.toThrow(
      'Authorization cancelled — no code provided',
    );
    expect(socket.requests.map((r) => r.type)).toEqual([
      'oauth_initiate',
      'oauth_cancel',
    ]);
    expect(socket.requests[1].payload).toEqual({
      session_id: 'session-cancel-on-error',
    });
  });

  /**
   * @requirement R17.4
   * @scenario login ignores oauth_cancel errors and rethrows original failure
   */
  it('treats cancel as best effort when cancel request fails', async () => {
    const socket = new SocketClientDouble();
    socket.enqueue('oauth_initiate', {
      flow_type: 'pkce_redirect',
      session_id: 'session-best-effort-cancel',
      auth_url: 'https://example.test/auth',
    });
    socket.enqueueError('oauth_cancel', new Error('cancel failed'));

    vi.spyOn(process.stdin, 'once').mockImplementation(
      (event: string, cb: (chunk: string) => void) => {
        if (event === 'data') {
          cb('\n');
        }
        return process.stdin;
      },
    );

    const adapter = new ProxyOAuthAdapter(socket as never);

    await expect(adapter.login('anthropic', 'default')).rejects.toThrow(
      'Authorization cancelled — no code provided',
    );
    expect(socket.requests.map((r) => r.type)).toEqual([
      'oauth_initiate',
      'oauth_cancel',
    ]);
  });

  /**
   * @requirement R17.4
   * @scenario handlePkceRedirect rejects empty authorization code
   */
  it('throws when PKCE code is empty', async () => {
    const socket = new SocketClientDouble();
    const adapter = new ProxyOAuthAdapter(socket as never);

    vi.spyOn(process.stdin, 'once').mockImplementation(
      (event: string, cb: (chunk: string) => void) => {
        if (event === 'data') {
          cb('   \n');
        }
        return process.stdin;
      },
    );

    await expect(
      adapter.handlePkceRedirect('session-pkce-empty', {
        auth_url: 'https://example.test/auth',
      }),
    ).rejects.toThrow('Authorization cancelled — no code provided');
  });

  /**
   * @requirement R17.4
   * @scenario handlePkceRedirect trims code before oauth_exchange
   */
  it('sends trimmed code during PKCE exchange', async () => {
    const socket = new SocketClientDouble();
    socket.enqueue('oauth_exchange', {
      access_token: 'trimmed-token',
      expiry: 444,
      token_type: 'Bearer',
    });

    vi.spyOn(process.stdin, 'once').mockImplementation(
      (event: string, cb: (chunk: string) => void) => {
        if (event === 'data') {
          cb('   code-with-spaces   \n');
        }
        return process.stdin;
      },
    );

    const adapter = new ProxyOAuthAdapter(socket as never);
    const result = await adapter.handlePkceRedirect('session-pkce-trim', {
      auth_url: 'https://example.test/auth',
    });

    expect(socket.requests).toEqual([
      {
        type: 'oauth_exchange',
        payload: {
          session_id: 'session-pkce-trim',
          code: 'code-with-spaces',
        },
      },
    ]);
    expect(result).toEqual({
      access_token: 'trimmed-token',
      expiry: 444,
      token_type: 'Bearer',
    });
  });

  /**
   * @requirement R18.3,R18.4
   * @scenario device-code poll handles multiple pending responses before complete
   */
  it('loops pending device polls until complete token payload', async () => {
    const socket = new SocketClientDouble();
    socket.enqueue('oauth_poll', { status: 'pending' });
    socket.enqueue('oauth_poll', { status: 'pending' });
    socket.enqueue('oauth_poll', {
      status: 'complete',
      access_token: 'multi-pending-token',
      expiry: 555,
      token_type: 'Bearer',
      scope: 'openid profile',
    });

    const adapter = new ProxyOAuthAdapter(socket as never);
    const pendingPromise = adapter.handleDeviceCode('session-device-loop', {
      verification_url: 'https://example.test/verify',
      user_code: 'ABCD-EFGH',
      pollIntervalMs: 5000,
    });

    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pendingPromise;

    expect(socket.requests.map((r) => r.type)).toEqual([
      'oauth_poll',
      'oauth_poll',
      'oauth_poll',
    ]);
    expect(result).toEqual({
      status: 'complete',
      access_token: 'multi-pending-token',
      expiry: 555,
      token_type: 'Bearer',
      scope: 'openid profile',
    });
  });

  /**
   * @requirement R18.3
   * @scenario device-code polling adopts updated pollIntervalMs from pending responses
   */
  it('updates device-code poll interval from server responses', async () => {
    const socket = new SocketClientDouble();
    socket.enqueue('oauth_poll', { status: 'pending', pollIntervalMs: 7000 });
    socket.enqueue('oauth_poll', {
      status: 'complete',
      access_token: 'interval-updated-token',
      expiry: 666,
      token_type: 'Bearer',
    });

    const adapter = new ProxyOAuthAdapter(socket as never);
    const pollPromise = adapter.handleDeviceCode('session-device-interval', {
      verification_url: 'https://example.test/verify',
      user_code: 'WXYZ-1234',
      pollIntervalMs: 5000,
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(socket.requests.length).toBe(1);

    await vi.advanceTimersByTimeAsync(7000);
    const result = await pollPromise;

    expect(socket.requests.length).toBe(2);
    expect(result).toEqual({
      status: 'complete',
      access_token: 'interval-updated-token',
      expiry: 666,
      token_type: 'Bearer',
    });
  });

  /**
   * @requirement R18.5
   * @scenario device-code polling throws Authentication failed on error status
   */
  it('throws when device-code poll reports error status', async () => {
    const socket = new SocketClientDouble();
    socket.enqueue('oauth_poll', {
      status: 'error',
      error: 'Token expired',
    });

    const adapter = new ProxyOAuthAdapter(socket as never);
    const pollPromise = adapter.handleDeviceCode('session-device-error', {
      verification_url: 'https://example.test/verify',
      user_code: 'ABCD-EFGH',
      pollIntervalMs: 5000,
    });

    await vi.advanceTimersByTimeAsync(5000);
    await expect(pollPromise).rejects.toThrow(
      'Authentication failed: Token expired',
    );
  });

  /**
   * @requirement R19.2
   * @scenario browser-redirect poll loops pending to complete using 2s default interval
   */
  it('polls browser redirect flow at default 2s until complete', async () => {
    const socket = new SocketClientDouble();
    socket.enqueue('oauth_poll', { status: 'pending' });
    socket.enqueue('oauth_poll', {
      status: 'complete',
      access_token: 'browser-complete-token',
      expiry: 777,
      token_type: 'Bearer',
    });

    const adapter = new ProxyOAuthAdapter(socket as never);
    const pollPromise = adapter.handleBrowserRedirect(
      'session-browser-default',
      {
        auth_url: 'https://example.test/browser-auth',
      },
    );

    await vi.advanceTimersByTimeAsync(2000);
    expect(socket.requests.length).toBe(1);

    await vi.advanceTimersByTimeAsync(2000);
    const result = await pollPromise;

    expect(socket.requests.length).toBe(2);
    expect(result).toEqual({
      status: 'complete',
      access_token: 'browser-complete-token',
      expiry: 777,
      token_type: 'Bearer',
    });
  });

  /**
   * @requirement R19.2
   * @scenario browser-redirect poll interval updates when server suggests interval
   */
  it('updates browser-redirect poll interval from pending responses', async () => {
    const socket = new SocketClientDouble();
    socket.enqueue('oauth_poll', { status: 'pending', pollIntervalMs: 6000 });
    socket.enqueue('oauth_poll', {
      status: 'complete',
      access_token: 'browser-interval-token',
      expiry: 888,
      token_type: 'Bearer',
    });

    const adapter = new ProxyOAuthAdapter(socket as never);
    const pollPromise = adapter.handleBrowserRedirect(
      'session-browser-interval',
      {
        auth_url: 'https://example.test/browser-auth',
      },
    );

    await vi.advanceTimersByTimeAsync(2000);
    expect(socket.requests.length).toBe(1);

    await vi.advanceTimersByTimeAsync(6000);
    const result = await pollPromise;

    expect(socket.requests.length).toBe(2);
    expect(result).toEqual({
      status: 'complete',
      access_token: 'browser-interval-token',
      expiry: 888,
      token_type: 'Bearer',
    });
  });

  /**
   * @requirement R19.2
   * @scenario browser-redirect poll throws Authentication failed on error status
   */
  it('throws when browser-redirect poll reports error status', async () => {
    const socket = new SocketClientDouble();
    socket.enqueue('oauth_poll', {
      status: 'error',
      error: 'User denied access',
    });

    const adapter = new ProxyOAuthAdapter(socket as never);
    const pollPromise = adapter.handleBrowserRedirect('session-browser-error', {
      auth_url: 'https://example.test/browser-auth',
    });

    await vi.advanceTimersByTimeAsync(2000);
    await expect(pollPromise).rejects.toThrow(
      'Authentication failed: User denied access',
    );
  });

  /**
   * @requirement R17.5
   * @scenario refresh sends refresh_token request and returns response data
   */
  it('refreshes token via refresh_token request', async () => {
    const socket = new SocketClientDouble();
    socket.enqueue('refresh_token', {
      access_token: 'refresh-success-token',
      expiry: 999,
      token_type: 'Bearer',
      scope: 'read write',
    });

    const adapter = new ProxyOAuthAdapter(socket as never);
    const result = await adapter.refresh('anthropic', 'default');

    expect(socket.requests).toEqual([
      {
        type: 'refresh_token',
        payload: {
          provider: 'anthropic',
          bucket: 'default',
        },
      },
    ]);
    expect(result).toEqual({
      access_token: 'refresh-success-token',
      expiry: 999,
      token_type: 'Bearer',
      scope: 'read write',
    });
  });

  /**
   * @requirement Cancel
   * @scenario cancel sends oauth_cancel request with exact session_id payload
   */
  it('sends oauth_cancel request with session_id', async () => {
    const socket = new SocketClientDouble();
    socket.enqueue('oauth_cancel', {});

    const adapter = new ProxyOAuthAdapter(socket as never);
    await adapter.cancel('session-cancel-direct');

    expect(socket.requests).toEqual([
      {
        type: 'oauth_cancel',
        payload: {
          session_id: 'session-cancel-direct',
        },
      },
    ]);
  });
});
