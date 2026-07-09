/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectDeprecatedSSEEndpoint } from './mcp-oauth-helpers.js';

describe('detectDeprecatedSSEEndpoint', () => {
  beforeEach(() => {
    // No mocks needed — detectDeprecatedSSEEndpoint is a pure string function
  });

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
});
