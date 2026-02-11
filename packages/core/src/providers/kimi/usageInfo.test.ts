/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchKimiUsage,
  formatKimiUsage,
  formatKimiCodeKeyMessage,
} from './usageInfo.js';

describe('kimiUsageInfo', () => {
  describe('fetchKimiUsage', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      global.fetch = fetchMock;
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
      expect(result[0]).toBe('  Available balance: $42.50');
    });

    it('should format cash balance when present', () => {
      const usage = {
        available_balance: 42.5,
        cash_balance: 32.5,
        voucher_balance: 10.0,
      };

      const result = formatKimiUsage(usage);
      expect(result).toHaveLength(3);
      expect(result[0]).toBe('  Available balance: $42.50');
      expect(result[1]).toBe('  Cash balance: $32.50');
      expect(result[2]).toBe('  Voucher balance: $10.00');
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

  describe('formatKimiCodeKeyMessage', () => {
    it('should return informational lines about Kimi Code keys', () => {
      const result = formatKimiCodeKeyMessage();
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((l) => l.includes('Kimi Code subscription'))).toBe(
        true,
      );
      expect(result.some((l) => l.includes('not available'))).toBe(true);
    });
  });
});
