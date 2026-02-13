/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchKimiUsage,
  formatKimiUsage,
  fetchKimiCodeUsage,
  formatKimiCodeUsage,
} from './usageInfo.js';

describe('kimiUsageInfo', () => {
  describe('fetchKimiUsage', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return null for empty API key', async () => {
      const result = await fetchKimiUsage('');
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return null for invalid API key', async () => {
      const result = await fetchKimiUsage(undefined as unknown as string);
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return null for Kimi Code subscription keys (sk-kimi-)', async () => {
      const result = await fetchKimiUsage('sk-kimi-some-subscription-key');
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should fetch balance with Bearer auth for standard keys', async () => {
      const mockResponse = {
        available_balance: 42.5,
        voucher_balance: 10.0,
        cash_balance: 32.5,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchKimiUsage('sk-standard-api-key');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.moonshot.ai/v1/users/me/balance',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer sk-standard-api-key',
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

      const result = await fetchKimiUsage('sk-standard-api-key');
      expect(result).toBeNull();
    });

    it('should handle network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchKimiUsage('sk-standard-api-key');
      expect(result).toBeNull();
    });

    it('should use custom base URL when provided', async () => {
      const mockResponse = {
        available_balance: 10.0,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchKimiUsage('sk-standard-api-key', 'https://api.moonshot.cn/v1');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.moonshot.cn/v1/users/me/balance',
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });

    it('should use default endpoint for kimi.com base URLs', async () => {
      const mockResponse = {
        available_balance: 10.0,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchKimiUsage('sk-standard-api-key', 'https://api.kimi.com/v1');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.moonshot.ai/v1/users/me/balance',
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });

    it('should accept unknown fields via passthrough', async () => {
      const mockResponse = {
        available_balance: 42.5,
        voucher_balance: 10.0,
        cash_balance: 32.5,
        new_field: 'extra_data',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchKimiUsage('sk-standard-api-key');
      expect(result).toBeDefined();
      expect((result as Record<string, unknown>)['new_field']).toBe(
        'extra_data',
      );
    });

    it('should include AbortSignal timeout', async () => {
      const mockResponse = {
        available_balance: 10.0,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchKimiUsage('sk-standard-api-key');

      const secondArg = fetchMock.mock.calls[0]?.[1] as {
        signal?: unknown;
      };
      expect(secondArg).toBeDefined();
      expect(secondArg.signal).toBeDefined();
      expect(secondArg.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('formatKimiUsage', () => {
    it('should format available balance', () => {
      const usage = {
        available_balance: 42.5,
      };

      const result = formatKimiUsage(usage);
      expect(result[0]).toBe('  Available balance: ¥42.50');
    });

    it('should format cash balance when present', () => {
      const usage = {
        available_balance: 42.5,
        cash_balance: 32.5,
        voucher_balance: 10.0,
      };

      const result = formatKimiUsage(usage);
      expect(result).toHaveLength(3);
      expect(result[0]).toBe('  Available balance: ¥42.50');
      expect(result[1]).toBe('  Cash balance: ¥32.50');
      expect(result[2]).toBe('  Voucher balance: ¥10.00');
    });

    it('should not show zero voucher balance', () => {
      const usage = {
        available_balance: 32.5,
        cash_balance: 32.5,
        voucher_balance: 0,
      };

      const result = formatKimiUsage(usage);
      expect(result).toHaveLength(2);
      expect(result.some((l) => l.includes('Voucher'))).toBe(false);
    });

    it('should show warning when balance is depleted', () => {
      const usage = {
        available_balance: 0,
        cash_balance: -5.0,
      };

      const result = formatKimiUsage(usage);
      expect(result.some((l) => l.includes('WARNING'))).toBe(true);
      expect(result.some((l) => l.includes('Balance depleted'))).toBe(true);
    });

    it('should show warning for negative balance', () => {
      const usage = {
        available_balance: -2.5,
      };

      const result = formatKimiUsage(usage);
      expect(result.some((l) => l.includes('WARNING'))).toBe(true);
    });
  });

  describe('fetchKimiCodeUsage', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return null for empty API key', async () => {
      const result = await fetchKimiCodeUsage('');
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return null for invalid API key', async () => {
      const result = await fetchKimiCodeUsage(undefined as unknown as string);
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should fetch usage with Bearer auth for sk-kimi- keys', async () => {
      const mockResponse = {
        user: {
          userId: 'user-123',
          region: 'REGION_OVERSEA',
          membership: { level: 'LEVEL_INTERMEDIATE' },
        },
        usage: {
          limit: '100',
          remaining: '85',
          resetTime: '2026-02-12T14:22:59.985060Z',
        },
        limits: [
          {
            window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
            detail: {
              limit: '100',
              remaining: '100',
              resetTime: '2026-02-12T02:22:59.985060Z',
            },
          },
        ],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchKimiCodeUsage('sk-kimi-test-key');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.kimi.com/coding/v1/usages',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer sk-kimi-test-key',
            Accept: 'application/json',
          },
          signal: expect.any(AbortSignal),
        },
      );
      expect(result).toEqual(mockResponse);
    });

    it('should derive endpoint from baseUrl containing kimi.com', async () => {
      const mockResponse = {
        usage: { limit: '50', remaining: '50' },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchKimiCodeUsage(
        'sk-kimi-test-key',
        'https://api.kimi.com/coding/v1',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.kimi.com/coding/v1/usages',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should use default endpoint when no baseUrl provided', async () => {
      const mockResponse = {
        usage: { limit: '50', remaining: '50' },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchKimiCodeUsage('sk-kimi-test-key');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.kimi.com/coding/v1/usages',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should handle HTTP errors gracefully', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response);

      const result = await fetchKimiCodeUsage('sk-kimi-test-key');
      expect(result).toBeNull();
    });

    it('should handle network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchKimiCodeUsage('sk-kimi-test-key');
      expect(result).toBeNull();
    });

    it('should accept unknown fields via passthrough', async () => {
      const mockResponse = {
        usage: { limit: '50', remaining: '50' },
        extra_field: 'extra_data',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchKimiCodeUsage('sk-kimi-test-key');
      expect(result).toBeDefined();
      expect((result as Record<string, unknown>)['extra_field']).toBe(
        'extra_data',
      );
    });

    it('should include AbortSignal timeout', async () => {
      const mockResponse = {
        usage: { limit: '50', remaining: '50' },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchKimiCodeUsage('sk-kimi-test-key');

      const secondArg = fetchMock.mock.calls[0]?.[1] as {
        signal?: unknown;
      };
      expect(secondArg).toBeDefined();
      expect(secondArg.signal).toBeDefined();
      expect(secondArg.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('formatKimiCodeUsage', () => {
    it('should format weekly usage with used/limit and remaining', () => {
      const usage = {
        usage: { limit: '100', remaining: '85' },
      };

      const result = formatKimiCodeUsage(usage);
      expect(
        result.some(
          (l) =>
            l.includes('Weekly quota') &&
            l.includes('15/100 used') &&
            l.includes('85 remaining'),
        ),
      ).toBe(true);
    });

    it('should format membership level from LEVEL_INTERMEDIATE', () => {
      const usage = {
        user: {
          userId: 'user-123',
          membership: { level: 'LEVEL_INTERMEDIATE' },
        },
        usage: { limit: '100', remaining: '100' },
      };

      const result = formatKimiCodeUsage(usage);
      expect(result.some((l) => l.includes('Membership: Intermediate'))).toBe(
        true,
      );
    });

    it('should format membership level from LEVEL_FREE', () => {
      const usage = {
        user: {
          userId: 'user-123',
          membership: { level: 'LEVEL_FREE' },
        },
        usage: { limit: '50', remaining: '50' },
      };

      const result = formatKimiCodeUsage(usage);
      expect(result.some((l) => l.includes('Membership: Free'))).toBe(true);
    });

    it('should format 5h window limit', () => {
      const now = Date.now();
      const resetTime = new Date(now + 3 * 60 * 60 * 1000).toISOString(); // 3h from now

      const usage = {
        usage: { limit: '100', remaining: '90' },
        limits: [
          {
            window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
            detail: {
              limit: '100',
              remaining: '95',
              resetTime,
            },
          },
        ],
      };

      const result = formatKimiCodeUsage(usage);
      expect(
        result.some(
          (l) =>
            l.includes('5h limit') &&
            l.includes('5/100 used') &&
            l.includes('95 remaining'),
        ),
      ).toBe(true);
    });

    it('should show reset time for weekly usage', () => {
      const now = Date.now();
      const resetTime = new Date(now + 2 * 60 * 60 * 1000).toISOString(); // 2h from now

      const usage = {
        usage: {
          limit: '100',
          remaining: '80',
          resetTime,
        },
      };

      const result = formatKimiCodeUsage(usage);
      const weeklyLine = result.find((l) => l.includes('Weekly quota'));
      expect(weeklyLine).toBeDefined();
      expect(weeklyLine).toMatch(/resets in/);
    });

    it('should handle missing optional fields', () => {
      const usage = {};

      const result = formatKimiCodeUsage(usage);
      // Should not throw and should return an array
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle missing user field', () => {
      const usage = {
        usage: { limit: '100', remaining: '100' },
      };

      const result = formatKimiCodeUsage(usage);
      // Should not include membership line
      expect(result.some((l) => l.includes('Membership'))).toBe(false);
    });

    it('should handle missing limits array', () => {
      const usage = {
        usage: { limit: '100', remaining: '50' },
      };

      const result = formatKimiCodeUsage(usage);
      expect(
        result.some((l) => l.includes('Weekly quota') && l.includes('50/100')),
      ).toBe(true);
    });

    it('should use 2-space indent', () => {
      const usage = {
        usage: { limit: '100', remaining: '100' },
      };

      const result = formatKimiCodeUsage(usage);
      for (const line of result) {
        expect(line).toMatch(/^ {2}\S/);
      }
    });
  });
});
