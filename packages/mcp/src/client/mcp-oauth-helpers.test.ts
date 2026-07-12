/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { MCPOAuthProvider } from '../auth/oauth-provider.js';
import { OAuthUtils } from '../auth/oauth-utils.js';
import {
  detectDeprecatedSSEEndpoint,
  handleAutomaticOAuth,
} from './mcp-oauth-helpers.js';

describe('detectDeprecatedSSEEndpoint', () => {
  it('should detect "SSE is no longer supported" message', () => {
    const result = detectDeprecatedSSEEndpoint(
      'SSE is no longer supported. use https://mcp.webflow.com/mcp',
    );
    expect(result).toBe('https://mcp.webflow.com/mcp');
  });

  it('should detect case-insensitively', () => {
    const result = detectDeprecatedSSEEndpoint(
      'sse is no longer supported. use http://example.com/mcp',
    );
    expect(result).toBe('http://example.com/mcp');
  });

  it('should return empty string when no URL is embedded', () => {
    const result = detectDeprecatedSSEEndpoint(
      'SSE is no longer supported. Please switch to the /mcp endpoint.',
    );
    expect(result).toBe('');
  });

  it('should return null when the deprecation signal is absent', () => {
    const result = detectDeprecatedSSEEndpoint('Connection refused');
    expect(result).toBeNull();
  });

  it('should return null for generic 401 errors', () => {
    const result = detectDeprecatedSSEEndpoint('401 Unauthorized');
    expect(result).toBeNull();
  });

  it('should extract the first URL when multiple are present', () => {
    const result = detectDeprecatedSSEEndpoint(
      'SSE is no longer supported. use https://mcp.example.com/mcp not https://mcp.example.com/sse',
    );
    expect(result).toBe('https://mcp.example.com/mcp');
  });

  it('should detect variant "SSE endpoint is no longer supported"', () => {
    const result = detectDeprecatedSSEEndpoint(
      'SSE endpoint is no longer supported. Use https://mcp.example.com/mcp',
    );
    expect(result).toBe('https://mcp.example.com/mcp');
  });

  it('should detect variant "The SSE transport has been deprecated"', () => {
    const result = detectDeprecatedSSEEndpoint(
      'The SSE transport has been deprecated. Please use https://mcp.example.com/mcp',
    );
    expect(result).toBe('https://mcp.example.com/mcp');
  });

  it('should detect variant "SSE transport is no longer supported"', () => {
    const result = detectDeprecatedSSEEndpoint(
      'SSE transport is no longer supported. Switch to https://mcp.example.com/mcp',
    );
    expect(result).toBe('https://mcp.example.com/mcp');
  });

  it('should detect variant "SSE is deprecated"', () => {
    const result = detectDeprecatedSSEEndpoint(
      'SSE is deprecated. Use https://mcp.example.com/mcp',
    );
    expect(result).toBe('https://mcp.example.com/mcp');
  });

  it('should detect uppercase URL scheme (HTTPS://)', () => {
    const result = detectDeprecatedSSEEndpoint(
      'SSE is no longer supported. Use HTTPS://mcp.example.com/mcp',
    );
    expect(result).toBe('HTTPS://mcp.example.com/mcp');
  });

  it('should return empty string when "http" appears but is not a URL (no ://)', () => {
    const result = detectDeprecatedSSEEndpoint(
      'SSE is no longer supported. HTTP protocol error occurred.',
    );
    expect(result).toBe('');
  });

  it('should reject schemes that merely start with http', () => {
    const result = detectDeprecatedSSEEndpoint(
      'SSE is no longer supported. Use httpx://mcp.example.com/mcp',
    );
    expect(result).toBe('');
  });

  it('should ignore URLs that appear before the deprecation signal', () => {
    const result = detectDeprecatedSSEEndpoint(
      'Error: see https://docs.example.com/help for details. SSE is no longer supported. Use https://mcp.example.com/mcp',
    );
    expect(result).toBe('https://mcp.example.com/mcp');
  });

  it('should prefer an MCP replacement endpoint over a documentation URL after the signal', () => {
    const result = detectDeprecatedSSEEndpoint(
      'SSE is deprecated. See https://docs.example.com/migration then use https://mcp.example.com/mcp',
    );
    expect(result).toBe('https://mcp.example.com/mcp');
  });

  it('should preserve trailing comma in URL query string', () => {
    const result = detectDeprecatedSSEEndpoint(
      'SSE is no longer supported. Use https://mcp.example.com/mcp?scopes=a,b,',
    );
    expect(result).toBe('https://mcp.example.com/mcp?scopes=a,b,');
  });

  it('should trim trailing comma that is sentence punctuation (no query string)', () => {
    const result = detectDeprecatedSSEEndpoint(
      'SSE is no longer supported. Use https://mcp.example.com/mcp, then reconnect.',
    );
    expect(result).toBe('https://mcp.example.com/mcp');
  });
});

describe('handleAutomaticOAuth', () => {
  const oauthConfig = {
    authorizationUrl: 'https://auth.example.com/authorize',
    tokenUrl: 'https://auth.example.com/token',
    scopes: ['read'],
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shares one browser authentication flow across concurrent requests for the same server', async () => {
    vi.spyOn(OAuthUtils, 'discoverOAuthConfig').mockResolvedValue(oauthConfig);

    let finishAuthentication: (() => void) | undefined;
    const authentication = new Promise<void>((resolve) => {
      finishAuthentication = resolve;
    });
    const authenticate = vi
      .spyOn(MCPOAuthProvider, 'authenticate')
      .mockReturnValue(authentication);

    const first = handleAutomaticOAuth(
      'webflow',
      { url: 'https://mcp.webflow.com/mcp', type: 'streamable-http' },
      '',
    );
    const second = handleAutomaticOAuth(
      'webflow',
      { url: 'https://mcp.webflow.com/mcp', type: 'streamable-http' },
      '',
    );

    await vi.waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
    finishAuthentication?.();
    await expect(Promise.all([first, second])).resolves.toStrictEqual([
      true,
      true,
    ]);
  });

  it('clears the guard after a failed authentication so the server can retry', async () => {
    vi.spyOn(OAuthUtils, 'discoverOAuthConfig').mockResolvedValue(oauthConfig);
    const authenticate = vi
      .spyOn(MCPOAuthProvider, 'authenticate')
      .mockRejectedValueOnce(new Error('authorization rejected'))
      .mockResolvedValueOnce(undefined);

    await expect(
      handleAutomaticOAuth(
        'webflow',
        { url: 'https://mcp.webflow.com/mcp' },
        '',
      ),
    ).resolves.toBe(false);
    await expect(
      handleAutomaticOAuth(
        'webflow',
        { url: 'https://mcp.webflow.com/mcp' },
        '',
      ),
    ).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it('keeps server and URL tuple identities distinct even when they contain null characters', async () => {
    vi.spyOn(OAuthUtils, 'discoverOAuthConfig').mockResolvedValue(oauthConfig);

    let finishAuthentications: (() => void) | undefined;
    const authentications = new Promise<void>((resolve) => {
      finishAuthentications = resolve;
    });
    const authenticate = vi
      .spyOn(MCPOAuthProvider, 'authenticate')
      .mockReturnValue(authentications);

    const first = handleAutomaticOAuth(
      'a\0b',
      { url: 'https://c.example.com' },
      '',
    );
    const second = handleAutomaticOAuth(
      'a',
      { url: 'b\0https://c.example.com' },
      'resource_metadata="https://auth.example.com/resource"',
    );

    await vi.waitFor(() => expect(authenticate).toHaveBeenCalledTimes(2));
    finishAuthentications?.();
    await expect(Promise.all([first, second])).resolves.toStrictEqual([
      true,
      true,
    ]);
  });
});
