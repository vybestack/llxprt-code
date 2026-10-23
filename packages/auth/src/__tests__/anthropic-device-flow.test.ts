/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { AnthropicDeviceFlow } from '../flows/anthropic-device-flow.js';

function readRedirect(value: unknown): unknown {
  return typeof value === 'object' && value !== null && 'redirect_uri' in value
    ? value.redirect_uri
    : undefined;
}

describe('AnthropicDeviceFlow redirect selection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exchanges a manually entered code with the redirect shown in its URL', async () => {
    const requests: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      requests.push(String(init?.body));
      return new Response(
        JSON.stringify({ access_token: 'manual-access-token' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const flow = new AnthropicDeviceFlow();

    await flow.initiateDeviceFlow();
    flow.buildAuthorizationUrl('http://localhost:8765/callback');
    await flow.exchangeCodeForToken('manual-code');

    const exchange: unknown = JSON.parse(requests[0] ?? '{}');
    expect(readRedirect(exchange)).toBe(
      'https://console.anthropic.com/oauth/code/callback',
    );
  });

  it('uses the localhost redirect for a code returned by the callback URL', async () => {
    const requests: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      requests.push(String(init?.body));
      return new Response(
        JSON.stringify({ access_token: 'callback-access-token' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const flow = new AnthropicDeviceFlow();

    await flow.initiateDeviceFlow();
    flow.buildAuthorizationUrl('http://localhost:8765/callback');
    await flow.exchangeCodeForToken(
      'callback-code',
      'http://localhost:8765/callback',
    );

    const exchange: unknown = JSON.parse(requests[0] ?? '{}');
    expect(readRedirect(exchange)).toBe('http://localhost:8765/callback');
  });
});
