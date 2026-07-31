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
      if (address !== null && typeof address === 'object') {
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

    expect(result).toStrictEqual({
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

    expect(result).toStrictEqual({
      code: 'auth-code-456',
      state: 'state-123',
    });
  });

  it('closes the listener and rejects the callback when aborted after startup', async () => {
    const port = await findAvailablePort();
    const controller = new AbortController();
    const server = await startLocalOAuthCallback({
      state: 'abort-state',
      portRange: [port, port],
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    const callback = server.waitForCallback();

    controller.abort();

    await expect(callback).rejects.toThrow(/abort/i);
    const replacement = net.createServer();
    await new Promise<void>((resolve, reject) => {
      replacement.once('error', reject);
      replacement.listen(port, '127.0.0.1', resolve);
    });
    await new Promise<void>((resolve, reject) => {
      replacement.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('closes and preserves the abort reason when abort wins listener registration', async () => {
    const port = await findAvailablePort();
    const controller = new AbortController();
    const abortReason = new DOMException('startup cancelled', 'AbortError');
    const signal = controller.signal;
    const originalAddEventListener = signal.addEventListener.bind(signal);
    let abortRegistrationCount = 0;
    vi.spyOn(signal, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        if (type === 'abort') {
          abortRegistrationCount += 1;
          if (abortRegistrationCount === 2) {
            controller.abort(abortReason);
          }
        }
        originalAddEventListener(type, listener, options);
      },
    );

    const startup = startLocalOAuthCallback({
      state: 'abort-race-state',
      portRange: [port, port],
      timeoutMs: 5_000,
      signal,
    });

    await expect(startup).rejects.toBe(abortReason);
    const replacement = net.createServer();
    await new Promise<void>((resolve, reject) => {
      replacement.once('error', reject);
      replacement.listen(port, '127.0.0.1', resolve);
    });
    await new Promise<void>((resolve, reject) => {
      replacement.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('rejects when callback does not arrive within timeout', async () => {
    const port = await findAvailablePort();
    const server = await startLocalOAuthCallback({
      state: 'timeout-state',
      portRange: [port, port],
      timeoutMs: 100,
    });

    const callbackPromise = server.waitForCallback();

    await expect(callbackPromise).rejects.toThrow('OAuth callback timed out');

    await server.shutdown();
  });
});
