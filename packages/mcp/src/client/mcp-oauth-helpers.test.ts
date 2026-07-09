/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { detectDeprecatedSSEEndpoint } from './mcp-oauth-helpers.js';

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

  it('should ignore URLs that appear before the deprecation signal', () => {
    const result = detectDeprecatedSSEEndpoint(
      'Error: see https://docs.example.com/help for details. SSE is no longer supported. Use https://mcp.example.com/mcp',
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
