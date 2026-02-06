/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchCodexUsage,
  formatCodexRateLimitWindow,
  formatCodexUsage,
} from './codexUsageInfo.js';

describe('codexUsageInfo', () => {
  describe('fetchCodexUsage', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      global.fetch = fetchMock;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return null for empty access token', async () => {
      const result = await fetchCodexUsage('', 'account123');
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return null for empty account ID', async () => {
      const result = await fetchCodexUsage('token123', '');
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should fetch usage info with valid credentials', async () => {
      const mockResponse = {
        plan_type: 'pro',
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: 15,
            limit_window_seconds: 18000,
            reset_after_seconds: 3600,
            reset_at: 1738789560,
          },
          secondary_window: {
            used_percent: 52,
            limit_window_seconds: 604800,
            reset_after_seconds: 432000,
            reset_at: 1739199960,
          },
        },
        credits: {
          has_credits: true,
          unlimited: false,
          balance: '80',
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchCodexUsage('token123', 'account123');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://chatgpt.com/backend-api/wham/usage',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer token123',
            'ChatGPT-Account-Id': 'account123',
            Accept: 'application/json',
          },
          signal: expect.any(AbortSignal),
        },
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle HTTP errors gracefully', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response);

      const result = await fetchCodexUsage('token123', 'account123');
      expect(result).toBeNull();
    });

    it('should handle network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchCodexUsage('token123', 'account123');
      expect(result).toBeNull();
    });

    it('should handle response with null rate_limit', async () => {
      const mockResponse = {
        plan_type: 'free',
        rate_limit: null,
        credits: {
          has_credits: false,
          unlimited: false,
          balance: null,
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchCodexUsage('token123', 'account123');
      expect(result).toEqual(mockResponse);
    });

    it('should handle response with null credits', async () => {
      const mockResponse = {
        plan_type: 'plus',
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: 5,
            limit_window_seconds: 18000,
            reset_after_seconds: 10000,
            reset_at: 1738800000,
          },
          secondary_window: null,
        },
        credits: null,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchCodexUsage('token123', 'account123');
      expect(result).toEqual(mockResponse);
    });

    it('should handle response with unlimited credits', async () => {
      const mockResponse = {
        plan_type: 'enterprise',
        rate_limit: null,
        credits: {
          has_credits: true,
          unlimited: true,
          balance: null,
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchCodexUsage('token123', 'account123');
      expect(result).toEqual(mockResponse);
    });

    it('should handle response with only primary window', async () => {
      const mockResponse = {
        plan_type: 'team',
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: 25,
            limit_window_seconds: 18000,
            reset_after_seconds: 5000,
            reset_at: 1738795000,
          },
          secondary_window: null,
        },
        credits: null,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchCodexUsage('token123', 'account123');
      expect(result).toEqual(mockResponse);
    });

    it('should accept unknown plan types', async () => {
      const mockResponse = {
        plan_type: 'premium_plus',
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: 10,
            limit_window_seconds: 18000,
            reset_after_seconds: 7200,
            reset_at: 1738797200,
          },
          secondary_window: null,
        },
        credits: {
          has_credits: true,
          unlimited: false,
          balance: '100',
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchCodexUsage('token123', 'account123');
      expect(result).toEqual(mockResponse);
      expect(result?.plan_type).toBe('premium_plus');
    });

    it('should accept overage used_percent values above 100', async () => {
      const mockResponse = {
        plan_type: 'pro',
        rate_limit: {
          allowed: true,
          limit_reached: true,
          primary_window: {
            used_percent: 123,
            limit_window_seconds: 18000,
            reset_after_seconds: 1800,
            reset_at: 1738790000,
          },
          secondary_window: null,
        },
        credits: {
          has_credits: true,
          unlimited: false,
          balance: '1',
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchCodexUsage('token123', 'account123');

      expect(result).toEqual(mockResponse);
      expect(result?.rate_limit?.primary_window?.used_percent).toBe(123);
    });

    it('should use ChatGPT wham usage endpoint when base URL includes /backend-api', async () => {
      const mockResponse = {
        plan_type: 'pro',
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: 20,
            limit_window_seconds: 18000,
            reset_after_seconds: 1800,
            reset_at: 1738790000,
          },
          secondary_window: {
            used_percent: 40,
            limit_window_seconds: 604800,
            reset_after_seconds: 86400,
            reset_at: 1738874600,
          },
        },
        credits: {
          has_credits: true,
          unlimited: false,
          balance: '42',
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchCodexUsage(
        'token123',
        'account123',
        'https://chatgpt.com/backend-api/codex',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://chatgpt.com/backend-api/wham/usage',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer token123',
            'ChatGPT-Account-Id': 'account123',
            Accept: 'application/json',
          },
          signal: expect.any(AbortSignal),
        },
      );
      expect(result).toEqual(mockResponse);
    });

    it('should include fetch timeout signal in request options', async () => {
      const mockResponse = {
        plan_type: 'pro',
        rate_limit: null,
        credits: null,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchCodexUsage('token123', 'account123');

      const secondArg = fetchMock.mock.calls[0]?.[1] as {
        signal?: unknown;
      };
      expect(secondArg).toBeDefined();
      expect(secondArg.signal).toBeDefined();
      expect(secondArg.signal).toBeInstanceOf(AbortSignal);
    });

    it('should fall back to default Codex usage endpoint when custom base URL endpoint fails', async () => {
      const mockResponse = {
        plan_type: 'pro',
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: 10,
            limit_window_seconds: 18000,
            reset_after_seconds: 1200,
            reset_at: 1738789000,
          },
          secondary_window: null,
        },
        credits: {
          has_credits: true,
          unlimited: false,
          balance: '12',
        },
      };

      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const result = await fetchCodexUsage(
        'token123',
        'account123',
        'https://chatgpt.com/backend-api/codex',
      );

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://chatgpt.com/backend-api/wham/usage',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer token123',
            'ChatGPT-Account-Id': 'account123',
            Accept: 'application/json',
          },
          signal: expect.any(AbortSignal),
        },
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://api.openai.com/api/codex/usage',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer token123',
            'ChatGPT-Account-Id': 'account123',
            Accept: 'application/json',
          },
          signal: expect.any(AbortSignal),
        },
      );
      expect(result).toEqual(mockResponse);
    });

    it('should derive backend-api root when base URL includes /backend-api/codex segment', async () => {
      const mockResponse = {
        plan_type: 'pro',
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: 20,
            limit_window_seconds: 18000,
            reset_after_seconds: 1800,
            reset_at: 1738790000,
          },
          secondary_window: null,
        },
        credits: {
          has_credits: true,
          unlimited: false,
          balance: '42',
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchCodexUsage(
        'token123',
        'account123',
        'https://chatgpt.com/backend-api/codex',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://chatgpt.com/backend-api/wham/usage',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer token123',
            'ChatGPT-Account-Id': 'account123',
            Accept: 'application/json',
          },
          signal: expect.any(AbortSignal),
        },
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('formatCodexRateLimitWindow', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-02-05T10:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should format window with hours until reset', () => {
      const window = {
        used_percent: 15,
        limit_window_seconds: 18000,
        reset_after_seconds: 16200,
        reset_at: Math.floor(new Date('2025-02-05T14:30:00Z').getTime() / 1000),
      };

      const result = formatCodexRateLimitWindow(window, '5-hour limit');
      expect(result).toContain('15% used');
      expect(result).toContain('4h 30m');
      expect(result).toContain('5-hour limit');
    });

    it('should format window with minutes until reset', () => {
      const window = {
        used_percent: 52,
        limit_window_seconds: 604800,
        reset_after_seconds: 2700,
        reset_at: Math.floor(new Date('2025-02-05T10:45:00Z').getTime() / 1000),
      };

      const result = formatCodexRateLimitWindow(window, 'Weekly limit');
      expect(result).toContain('52% used');
      expect(result).toContain('in 45m');
    });

    it('should format window with soon when reset is very close', () => {
      const window = {
        used_percent: 99,
        limit_window_seconds: 18000,
        reset_after_seconds: 30,
        reset_at: Math.floor(new Date('2025-02-05T10:00:30Z').getTime() / 1000),
      };

      const result = formatCodexRateLimitWindow(window, '5-hour limit');
      expect(result).toContain('99% used');
      expect(result).toContain('soon');
    });

    it('should return null for null window', () => {
      const result = formatCodexRateLimitWindow(null, '5-hour limit');
      expect(result).toBeNull();
    });
  });

  describe('formatCodexUsage', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-02-05T10:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should format all available data', () => {
      const usage = {
        plan_type: 'pro' as const,
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: 15,
            limit_window_seconds: 18000,
            reset_after_seconds: 3600,
            reset_at: Math.floor(
              new Date('2025-02-05T14:00:00Z').getTime() / 1000,
            ),
          },
          secondary_window: {
            used_percent: 52,
            limit_window_seconds: 604800,
            reset_after_seconds: 432000,
            reset_at: Math.floor(
              new Date('2025-02-10T10:00:00Z').getTime() / 1000,
            ),
          },
        },
        credits: {
          has_credits: true,
          unlimited: false,
          balance: '80',
        },
      };

      const result = formatCodexUsage(usage);
      expect(result).toHaveLength(3);
      expect(result[0]).toContain('5-hour limit');
      expect(result[0]).toContain('15%');
      expect(result[1]).toContain('Weekly limit');
      expect(result[1]).toContain('52%');
      expect(result[2]).toContain('Credits: 80');
    });

    it('should skip null rate_limit windows', () => {
      const usage = {
        plan_type: 'free' as const,
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: null,
          secondary_window: null,
        },
        credits: null,
      };

      const result = formatCodexUsage(usage);
      expect(result).toHaveLength(0);
    });

    it('should format unlimited credits', () => {
      const usage = {
        plan_type: 'enterprise' as const,
        rate_limit: null,
        credits: {
          has_credits: true,
          unlimited: true,
          balance: null,
        },
      };

      const result = formatCodexUsage(usage);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('  Credits: Unlimited');
    });

    it('should show Credits: None when has_credits is false', () => {
      const usage = {
        plan_type: 'go' as const,
        rate_limit: null,
        credits: {
          has_credits: false,
          unlimited: false,
          balance: '150',
        },
      };

      const result = formatCodexUsage(usage);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('  Credits: None');
    });

    it('should format credit balance', () => {
      const usage = {
        plan_type: 'plus' as const,
        rate_limit: null,
        credits: {
          has_credits: true,
          unlimited: false,
          balance: '150',
        },
      };

      const result = formatCodexUsage(usage);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('  Credits: 150');
    });

    it('should handle empty usage with no data', () => {
      const usage = {
        plan_type: 'unknown' as const,
        rate_limit: null,
        credits: null,
      };

      const result = formatCodexUsage(usage);
      expect(result).toHaveLength(0);
    });

    it('should format only primary window when secondary is null', () => {
      const usage = {
        plan_type: 'team' as const,
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: 30,
            limit_window_seconds: 18000,
            reset_after_seconds: 7200,
            reset_at: Math.floor(
              new Date('2025-02-05T12:00:00Z').getTime() / 1000,
            ),
          },
          secondary_window: null,
        },
        credits: null,
      };

      const result = formatCodexUsage(usage);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('5-hour limit');
      expect(result[0]).toContain('30%');
    });

    it('should show Credits: None when balance is null and has_credits is false', () => {
      const usage = {
        plan_type: 'go' as const,
        rate_limit: null,
        credits: {
          has_credits: false,
          unlimited: false,
          balance: null,
        },
      };

      const result = formatCodexUsage(usage);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('  Credits: None');
    });
  });
});
