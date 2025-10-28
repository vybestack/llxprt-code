import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import { startLocalOAuthCallback } from './local-oauth-callback.js';

describe('startLocalOAuthCallback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures authorization code from localhost redirect', async () => {
    const server = await startLocalOAuthCallback({
      state: 'state-123',
      portRange: [8765, 8765],
      timeoutMs: 500,
    });

    const callbackPromise = server.waitForCallback();
    const url = new URL(server.redirectUri);

    await new Promise<void>((resolve, reject) => {
      const request = http.request(
        {
          method: 'GET',
          hostname: url.hostname,
          port: Number(url.port),
          path: `${url.pathname}?code=auth-code-456&state=state-123`,
        },
        (response) => {
          response.resume();
          response.on('end', resolve);
        },
      );
      request.on('error', reject);
      request.end();
    });

    const result = await callbackPromise;

    await server.shutdown();

    expect(result).toEqual({
      code: 'auth-code-456',
      state: 'state-123',
    });
  });

  it('rejects when callback does not arrive within timeout', async () => {
    vi.useFakeTimers();

    const server = await startLocalOAuthCallback({
      state: 'timeout-state',
      portRange: [8770, 8770],
      timeoutMs: 100,
    });

    const callbackPromise = server.waitForCallback();

    const rejection = expect(callbackPromise).rejects.toThrowError(
      'OAuth callback timed out',
    );

    await vi.advanceTimersByTimeAsync(150);

    await rejection;

    await server.shutdown();
  });
});
