/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProxySocketClient } from '@vybestack/llxprt-code-core';
import { ProxyOAuthAdapter } from '../proxy-oauth-adapter.js';

describe('ProxyOAuthAdapter', () => {
  const requestMock = vi.fn();
  const socketClientStub = {
    request: requestMock,
  };

  beforeEach(() => {
    requestMock.mockReset();
  });

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
});
