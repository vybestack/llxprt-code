import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { startLocalOAuthCallback } from './local-oauth-callback.js';

const findAvailablePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) => {
      server.close();
      reject(error);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close((closeError) => {
          if (closeError) {
            reject(closeError);
            return;
          }
          resolve(port);
        });
      } else {
        server.close();
        reject(new Error('Unable to allocate a port'));
      }
    });
  });

describe('startLocalOAuthCallback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures authorization code from localhost redirect', async () => {
    const port = await findAvailablePort();
    const server = await startLocalOAuthCallback({
      state: 'state-123',
      portRange: [port, port],
      timeoutMs: 500,
    });

    expect(server.redirectUri).toBe(`http://localhost:${port}/callback`);

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

  it('uses /auth/callback redirectUri for Codex', async () => {
    const port = await findAvailablePort();
    const server = await startLocalOAuthCallback({
      state: 'state-123',
      portRange: [port, port],
      timeoutMs: 500,
      provider: 'codex',
    });

    expect(server.redirectUri).toBe(`http://localhost:${port}/auth/callback`);

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

    const port = await findAvailablePort();
    const server = await startLocalOAuthCallback({
      state: 'timeout-state',
      portRange: [port, port],
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
