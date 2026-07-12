/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { OpenAIProvider } from './OpenAIProvider.js';

describe('OpenAIProvider.shouldRetryResponse', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider('test-key');
  });

  describe('should retry on all 5xx errors', () => {
    it('should retry on 502 Bad Gateway', () => {
      expect(provider.shouldRetryResponse({ status: 502 })).toBe(true);
    });

    it('should retry on 500 Internal Server Error', () => {
      expect(provider.shouldRetryResponse({ status: 500 })).toBe(true);
    });

    it('should retry on 501 Not Implemented', () => {
      expect(provider.shouldRetryResponse({ status: 501 })).toBe(true);
    });

    it('should retry on 503 Service Unavailable', () => {
      expect(provider.shouldRetryResponse({ status: 503 })).toBe(true);
    });

    it('should retry on 504 Gateway Timeout', () => {
      expect(provider.shouldRetryResponse({ status: 504 })).toBe(true);
    });

    it('should retry on 599 (edge of 5xx range)', () => {
      expect(provider.shouldRetryResponse({ status: 599 })).toBe(true);
    });
  });

  describe('should retry on 429 rate limit', () => {
    it('should retry on 429 Too Many Requests', () => {
      expect(provider.shouldRetryResponse({ status: 429 })).toBe(true);
    });
  });

  describe('should not retry on 4xx errors (except 429)', () => {
    it('should not retry on 400 Bad Request', () => {
      expect(provider.shouldRetryResponse({ status: 400 })).toBe(false);
    });

    it('should not retry on 401 Unauthorized', () => {
      expect(provider.shouldRetryResponse({ status: 401 })).toBe(false);
    });

    it('should not retry on 404 Not Found', () => {
      expect(provider.shouldRetryResponse({ status: 404 })).toBe(false);
    });

    it('should not retry on 403 Forbidden', () => {
      expect(provider.shouldRetryResponse({ status: 403 })).toBe(false);
    });
  });

  describe('should not retry on other status codes', () => {
    it('should not retry on 200 OK', () => {
      expect(provider.shouldRetryResponse({ status: 200 })).toBe(false);
    });

    it('should not retry on 301 Moved Permanently', () => {
      expect(provider.shouldRetryResponse({ status: 301 })).toBe(false);
    });

    it('should not retry on 600 (outside 5xx range)', () => {
      expect(provider.shouldRetryResponse({ status: 600 })).toBe(false);
    });
  });
});
