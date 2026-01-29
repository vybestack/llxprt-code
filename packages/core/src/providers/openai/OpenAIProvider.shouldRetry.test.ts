/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';

const mockSettingsService = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  setProviderSetting: vi.fn(),
  getProviderSettings: vi.fn().mockReturnValue({}),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getAllGlobalSettings: vi.fn().mockReturnValue({}),
}));

vi.mock('../../settings/settingsServiceInstance.js', () => ({
  getSettingsService: () => mockSettingsService,
}));

describe('OpenAIProvider.shouldRetryResponse', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsService.getSettings.mockResolvedValue({});
    provider = new OpenAIProvider('test-key');
  });

  describe('should retry on all 5xx errors', () => {
    it('should retry on 502 Bad Gateway', () => {
      const error = { status: 502 };
      const result = provider.shouldRetryResponse(error);
      expect(result).toBe(true);
    });

    it('should retry on 500 Internal Server Error', () => {
      const error = { status: 500 };
      const result = provider.shouldRetryResponse(error);
      expect(result).toBe(true);
    });

    it('should retry on 501 Not Implemented', () => {
      const error = { status: 501 };
      const result = provider.shouldRetryResponse(error);
      expect(result).toBe(true);
    });

    it('should retry on 503 Service Unavailable', () => {
      const error = { status: 503 };
      const result = provider.shouldRetryResponse(error);
      expect(result).toBe(true);
    });

    it('should retry on 504 Gateway Timeout', () => {
      const error = { status: 504 };
      const result = provider.shouldRetryResponse(error);
      expect(result).toBe(true);
    });

    it('should retry on 599 (edge of 5xx range)', () => {
      const error = { status: 599 };
      const result = provider.shouldRetryResponse(error);
      expect(result).toBe(true);
    });
  });

  describe('should retry on 429 rate limit', () => {
    it('should retry on 429 Too Many Requests', () => {
      const error = { status: 429 };
      const result = provider.shouldRetryResponse(error);
      expect(result).toBe(true);
    });
  });

  describe('should not retry on 4xx errors (except 429)', () => {
    it('should not retry on 400 Bad Request', () => {
      const error = { status: 400 };
      const result = provider.shouldRetryResponse(error);
      expect(result).toBe(false);
    });

    it('should not retry on 401 Unauthorized', () => {
      const error = { status: 401 };
      const result = provider.shouldRetryResponse(error);
      expect(result).toBe(false);
    });

    it('should not retry on 404 Not Found', () => {
      const error = { status: 404 };
      const result = provider.shouldRetryResponse(error);
      expect(result).toBe(false);
    });

    it('should not retry on 403 Forbidden', () => {
      const error = { status: 403 };
      const result = provider.shouldRetryResponse(error);
      expect(result).toBe(false);
    });
  });

  describe('should not retry on other status codes', () => {
    it('should not retry on 200 OK', () => {
      const error = { status: 200 };
      const result = provider.shouldRetryResponse(error);
      expect(result).toBe(false);
    });

    it('should not retry on 301 Moved Permanently', () => {
      const error = { status: 301 };
      const result = provider.shouldRetryResponse(error);
      expect(result).toBe(false);
    });

    it('should not retry on 600 (outside 5xx range)', () => {
      const error = { status: 600 };
      const result = provider.shouldRetryResponse(error);
      expect(result).toBe(false);
    });
  });
});
