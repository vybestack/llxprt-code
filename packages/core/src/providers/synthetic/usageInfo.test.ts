/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchSyntheticUsage, formatSyntheticUsage } from './usageInfo.js';

describe('syntheticUsageInfo', () => {
  describe('fetchSyntheticUsage', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return null for empty API key', async () => {
      const result = await fetchSyntheticUsage('');
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return null for invalid API key', async () => {
      const result = await fetchSyntheticUsage(undefined as unknown as string);
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should fetch usage info with Bearer auth', async () => {
      const mockResponse = {
        subscription: {
          limit: 1350,
          requests: 372.7,
          renewsAt: '2026-02-11T22:26:48.423Z',
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchSyntheticUsage('test-key-123');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.synthetic.new/v2/quotas',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer test-key-123',
            Accept: 'application/json',
          },
          signal: expect.any(AbortSignal),
        },
      );
      expect(result).toEqual(mockResponse);
    });

    it('should parse full response with all fields', async () => {
      const mockResponse = {
        subscription: {
          limit: 1350,
          requests: 372.7,
          renewsAt: '2026-02-11T22:26:48.423Z',
        },
        search: {
          hourly: {
            limit: 250,
            requests: 0,
            renewsAt: '2026-02-11T22:03:02.423Z',
          },
        },
        toolCallDiscounts: {
          limit: 16200,
          requests: 4384,
          renewsAt: '2026-02-12T06:57:48.437Z',
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchSyntheticUsage('test-key-123');
      expect(result).toEqual(mockResponse);
    });

    it('should handle HTTP errors gracefully', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response);

      const result = await fetchSyntheticUsage('test-key-123');
      expect(result).toBeNull();
    });

    it('should handle network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchSyntheticUsage('test-key-123');
      expect(result).toBeNull();
    });

    it('should handle invalid JSON response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => 'not-valid-json',
      } as unknown as Response);

      const result = await fetchSyntheticUsage('test-key-123');
      expect(result).toBeNull();
    });

    it('should accept unknown fields via passthrough', async () => {
      const mockResponse = {
        subscription: {
          limit: 100,
          requests: 50,
          renewsAt: '2026-02-11T22:26:48.423Z',
        },
        someNewField: { data: 'extra' },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchSyntheticUsage('test-key-123');
      expect(result).toBeDefined();
      expect((result as Record<string, unknown>)['someNewField']).toEqual({
        data: 'extra',
      });
    });

    it('should include AbortSignal timeout', async () => {
      const mockResponse = {
        subscription: {
          limit: 100,
          requests: 0,
          renewsAt: '2026-02-11T22:26:48.423Z',
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchSyntheticUsage('test-key-123');

      const secondArg = fetchMock.mock.calls[0]?.[1] as {
        signal?: unknown;
      };
      expect(secondArg).toBeDefined();
      expect(secondArg.signal).toBeDefined();
      expect(secondArg.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('formatSyntheticUsage', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-11T18:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should format subscription with remaining and reset time', () => {
      const usage = {
        subscription: {
          limit: 1350,
          requests: 372.7,
          renewsAt: '2026-02-11T22:26:48.423Z',
        },
      };

      const result = formatSyntheticUsage(usage);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('Subscription');
      expect(result[0]).toContain('372.7/1350');
      expect(result[0]).toMatch(/977\.3 remaining/);
      expect(result[0]).toContain('remaining');
      expect(result[0]).toContain('4h 26m');
    });

    it('should format tool call discounts', () => {
      const usage = {
        toolCallDiscounts: {
          limit: 16200,
          requests: 4384,
          renewsAt: '2026-02-12T06:57:48.437Z',
        },
      };

      const result = formatSyntheticUsage(usage);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('Tool calls');
      expect(result[0]).toContain('4384/16200');
      expect(result[0]).toContain('11816 remaining');
    });

    it('should format search hourly', () => {
      const usage = {
        search: {
          hourly: {
            limit: 250,
            requests: 100,
            renewsAt: '2026-02-11T18:30:00.000Z',
          },
        },
      };

      const result = formatSyntheticUsage(usage);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('Search (hourly)');
      expect(result[0]).toContain('100/250');
      expect(result[0]).toContain('in 30m');
    });

    it('should format all fields together', () => {
      const usage = {
        subscription: {
          limit: 1350,
          requests: 372.7,
          renewsAt: '2026-02-11T22:26:48.423Z',
        },
        search: {
          hourly: {
            limit: 250,
            requests: 0,
            renewsAt: '2026-02-11T22:03:02.423Z',
          },
        },
        toolCallDiscounts: {
          limit: 16200,
          requests: 4384,
          renewsAt: '2026-02-12T06:57:48.437Z',
        },
      };

      const result = formatSyntheticUsage(usage);
      expect(result).toHaveLength(3);
      expect(result[0]).toContain('Subscription');
      expect(result[1]).toContain('Tool calls');
      expect(result[2]).toContain('Search (hourly)');
    });

    it('should handle missing optional fields', () => {
      const usage = {};

      const result = formatSyntheticUsage(usage);
      expect(result).toHaveLength(0);
    });

    it('should handle null subscription', () => {
      const usage = {
        subscription: null,
      };

      const result = formatSyntheticUsage(usage);
      expect(result).toHaveLength(0);
    });

    it('should show "soon" when reset is very close', () => {
      const usage = {
        subscription: {
          limit: 100,
          requests: 99,
          renewsAt: '2026-02-11T18:00:10.000Z',
        },
      };

      const result = formatSyntheticUsage(usage);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('soon');
    });

    it('should handle null search hourly', () => {
      const usage = {
        search: {
          hourly: null,
        },
      };

      const result = formatSyntheticUsage(usage);
      expect(result).toHaveLength(0);
    });
  });
});
