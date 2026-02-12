/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchChutesUsage, formatChutesUsage } from './usageInfo.js';

describe('chutesUsageInfo', () => {
  describe('fetchChutesUsage', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return null for empty API key', async () => {
      const result = await fetchChutesUsage('');
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return null for invalid API key', async () => {
      const result = await fetchChutesUsage(undefined as unknown as string);
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should fetch quotas and user info in parallel with Bearer auth', async () => {
      const mockQuotas = [
        {
          chute_id: '*',
          is_default: true,
          user_id: 'user-123',
          updated_at: '2026-01-14T22:53:09.125889',
          payment_refresh_date: null,
          quota: 5000,
        },
      ];

      const mockUser = {
        username: 'testuser',
        user_id: 'user-123',
        balance: 4.5,
        logo_id: null,
        created_at: '2025-10-14T22:49:57.605806Z',
      };

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockQuotas,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockUser,
        } as Response);

      const result = await fetchChutesUsage('test-key-123');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.chutes.ai/users/me/quotas',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer test-key-123',
            Accept: 'application/json',
          },
          signal: expect.any(AbortSignal),
        },
      );
      expect(fetchMock).toHaveBeenCalledWith('https://api.chutes.ai/users/me', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-key-123',
          Accept: 'application/json',
        },
        signal: expect.any(AbortSignal),
      });

      expect(result).toEqual({
        quotas: mockQuotas,
        balance: 4.5,
        username: 'testuser',
      });
    });

    it('should return null when quotas endpoint fails', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            username: 'test',
            user_id: 'u',
            balance: 0,
          }),
        } as Response);

      const result = await fetchChutesUsage('test-key-123');
      expect(result).toBeNull();
    });

    it('should return null when user endpoint fails', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              chute_id: '*',
              is_default: true,
              user_id: 'u',
              updated_at: '2026-01-14T22:53:09Z',
              quota: 100,
            },
          ],
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        } as Response);

      const result = await fetchChutesUsage('test-key-123');
      expect(result).toBeNull();
    });

    it('should handle network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchChutesUsage('test-key-123');
      expect(result).toBeNull();
    });

    it('should handle zero balance', async () => {
      const mockQuotas = [
        {
          chute_id: '*',
          is_default: true,
          user_id: 'user-123',
          updated_at: '2026-01-14T22:53:09.125889',
          payment_refresh_date: null,
          quota: 200,
        },
      ];

      const mockUser = {
        username: 'testuser',
        user_id: 'user-123',
        balance: 0.0,
      };

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockQuotas,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockUser,
        } as Response);

      const result = await fetchChutesUsage('test-key-123');
      expect(result).toBeDefined();
      expect(result?.balance).toBe(0.0);
    });
  });

  describe('formatChutesUsage', () => {
    it('should format balance and global quota', () => {
      const usage = {
        quotas: [
          {
            chute_id: '*',
            is_default: true,
            user_id: 'user-123',
            updated_at: '2026-01-14T22:53:09.125889',
            payment_refresh_date: null,
            quota: 5000,
          },
        ],
        balance: 4.5,
        username: 'testuser',
      };

      const result = formatChutesUsage(usage);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('  Balance: $4.50');
      expect(result[1]).toContain('Quota (default)');
      expect(result[1]).toContain('5000 requests/day');
    });

    it('should format zero balance', () => {
      const usage = {
        quotas: [
          {
            chute_id: '*',
            is_default: true,
            user_id: 'user-123',
            updated_at: '2026-01-14T22:53:09.125889',
            payment_refresh_date: null,
            quota: 200,
          },
        ],
        balance: 0.0,
        username: 'testuser',
      };

      const result = formatChutesUsage(usage);
      expect(result[0]).toBe('  Balance: $0.00');
    });

    it('should format specific chute quotas', () => {
      const usage = {
        quotas: [
          {
            chute_id: 'specific-model-id',
            is_default: false,
            user_id: 'user-123',
            updated_at: '2026-01-14T22:53:09.125889',
            payment_refresh_date: null,
            quota: 1000,
          },
        ],
        balance: 10.0,
        username: 'testuser',
      };

      const result = formatChutesUsage(usage);
      expect(result).toHaveLength(2);
      expect(result[1]).toContain('Quota (specific-model-id)');
      expect(result[1]).toContain('1000 requests/day');
    });

    it('should handle empty quotas array', () => {
      const usage = {
        quotas: [],
        balance: 5.0,
        username: 'testuser',
      };

      const result = formatChutesUsage(usage);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('Balance');
    });

    it('should handle multiple quota entries', () => {
      const usage = {
        quotas: [
          {
            chute_id: '*',
            is_default: true,
            user_id: 'user-123',
            updated_at: '2026-01-14T22:53:09.125889',
            payment_refresh_date: null,
            quota: 5000,
          },
          {
            chute_id: 'premium-model',
            is_default: false,
            user_id: 'user-123',
            updated_at: '2026-01-14T22:53:09.125889',
            payment_refresh_date: null,
            quota: 100,
          },
        ],
        balance: 15.0,
        username: 'testuser',
      };

      const result = formatChutesUsage(usage);
      expect(result).toHaveLength(3);
    });
  });
});
