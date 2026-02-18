/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ProxySocketClient } from '@vybestack/llxprt-code-core';
import { ProxyOAuthAdapter } from '../proxy-oauth-adapter.js';

describe('ProxyOAuthAdapter', () => {
  const requestMock = vi.fn();
  const socketClientStub = {
    request: requestMock,
  };

  const originalStdin = process.stdin;

  beforeEach(() => {
    requestMock.mockReset();
  });

  function createMockStdin() {
    const emitter = new EventEmitter() as NodeJS.ReadStream & EventEmitter;
    Object.defineProperty(emitter, 'removeListener', {
      value: emitter.removeListener.bind(emitter),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(emitter, 'once', {
      value: emitter.once.bind(emitter),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(emitter, 'on', {
      value: emitter.on.bind(emitter),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(emitter, 'resume', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
    return emitter;
  }

  function setMockStdin(mockStdin: NodeJS.ReadStream & EventEmitter): void {
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: mockStdin,
    });
  }

  function restoreStdin(): void {
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: originalStdin,
    });
  }

  it('supports camelCase sessionId and mode response fields', async () => {
    requestMock
      .mockResolvedValueOnce({
        data: {
          mode: 'device_code',
          sessionId: 'session-camel-123',
          pollIntervalMs: 1,
        },
      })
      .mockResolvedValueOnce({
        data: {
          status: 'complete',
          access_token: 'token',
        },
      });

    const adapter = new ProxyOAuthAdapter(
      socketClientStub as unknown as ProxySocketClient,
    );

    const result = await adapter.login('anthropic');

    expect(result).toEqual({
      status: 'complete',
      access_token: 'token',
    });
    expect(requestMock).toHaveBeenNthCalledWith(1, 'oauth_initiate', {
      provider: 'anthropic',
      bucket: undefined,
    });
    expect(requestMock).toHaveBeenNthCalledWith(2, 'oauth_poll', {
      session_id: 'session-camel-123',
    });
  });

  it('cancels using camelCase sessionId when mode is unknown', async () => {
    requestMock
      .mockResolvedValueOnce({
        data: {
          mode: 'unexpected_mode',
          sessionId: 'session-to-cancel',
        },
      })
      .mockResolvedValueOnce({ ok: true });

    const adapter = new ProxyOAuthAdapter(
      socketClientStub as unknown as ProxySocketClient,
    );

    await expect(adapter.login('anthropic')).rejects.toThrow(
      /Unknown flow type/i,
    );

    expect(requestMock).toHaveBeenNthCalledWith(2, 'oauth_cancel', {
      session_id: 'session-to-cancel',
    });
  });

  it('fails pkce flow when stdin closes before a code is provided', async () => {
    const mockStdin = createMockStdin();
    setMockStdin(mockStdin);

    requestMock
      .mockResolvedValueOnce({
        data: {
          flow_type: 'pkce_redirect',
          session_id: 'pkce-session-close',
        },
      })
      .mockResolvedValueOnce({ ok: true });

    const adapter = new ProxyOAuthAdapter(
      socketClientStub as unknown as ProxySocketClient,
    );

    const loginPromise = adapter.login('anthropic');
    // Wait for the promise chain to set up stdin listeners before emitting
    await new Promise((r) => setImmediate(r));
    mockStdin.emit('close');

    await expect(loginPromise).rejects.toThrow(
      /stdin closed without providing a code/i,
    );

    expect(requestMock).toHaveBeenNthCalledWith(2, 'oauth_cancel', {
      session_id: 'pkce-session-close',
    });

    restoreStdin();
  });

  it('fails pkce flow when stdin ends before a code is provided', async () => {
    const mockStdin = createMockStdin();
    setMockStdin(mockStdin);

    requestMock
      .mockResolvedValueOnce({
        data: {
          flow_type: 'pkce_redirect',
          session_id: 'pkce-session-end',
        },
      })
      .mockResolvedValueOnce({ ok: true });

    const adapter = new ProxyOAuthAdapter(
      socketClientStub as unknown as ProxySocketClient,
    );

    const loginPromise = adapter.login('anthropic');
    // Wait for the promise chain to set up stdin listeners before emitting
    await new Promise((r) => setImmediate(r));
    mockStdin.emit('end');

    await expect(loginPromise).rejects.toThrow(
      /stdin closed without providing a code/i,
    );

    expect(requestMock).toHaveBeenNthCalledWith(2, 'oauth_cancel', {
      session_id: 'pkce-session-end',
    });

    restoreStdin();
  });
});
