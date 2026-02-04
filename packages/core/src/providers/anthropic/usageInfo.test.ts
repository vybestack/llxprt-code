/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchAnthropicUsage,
  formatUsagePeriod,
  formatAllUsagePeriods,
} from './usageInfo.js';

describe('usageInfo', () => {
  describe('fetchAnthropicUsage', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      global.fetch = fetchMock;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return null for non-OAuth token', async () => {
      const result = await fetchAnthropicUsage('sk-ant-api123-not-oat');
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return null for invalid token', async () => {
      const result = await fetchAnthropicUsage('');
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should fetch usage info with valid OAuth token', async () => {
      const mockResponse = {
        five_hour: {
          utilization: 6.5,
          resets_at: '2025-11-04T04:00:00Z',
        },
        seven_day: {
          utilization: 35.0,
          resets_at: '2025-11-06T00:00:00Z',
        },
        seven_day_oauth_apps: null,
        seven_day_opus: {
          utilization: 0.0,
          resets_at: null,
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchAnthropicUsage('sk-ant-oat01-test-token');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.anthropic.com/api/oauth/usage',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer sk-ant-oat01-test-token',
            Accept: 'application/json',
            'anthropic-beta': 'oauth-2025-04-20',
          },
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

      const result = await fetchAnthropicUsage('sk-ant-oat01-test-token');
      expect(result).toBeNull();
    });

    it('should handle unknown fields using passthrough', async () => {
      const mockResponse = {
        five_hour: {
          utilization: 6.5,
          resets_at: '2025-11-04T04:00:00Z',
        },
        some_new_quota_type: {
          utilization: 25.0,
          resets_at: '2025-11-05T00:00:00Z',
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchAnthropicUsage('sk-ant-oat01-test-token');
      expect(result).toEqual(mockResponse);
      // Unknown fields should be preserved thanks to passthrough()
      expect(
        (result as Record<string, unknown>)['some_new_quota_type'],
      ).toBeDefined();
    });

    it('should handle network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchAnthropicUsage('sk-ant-oat01-test-token');
      expect(result).toBeNull();
    });

    it('should handle response with only five_hour data', async () => {
      const mockResponse = {
        five_hour: {
          utilization: 50.0,
          resets_at: '2025-11-04T12:00:00Z',
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchAnthropicUsage('sk-ant-oat01-test-token');
      expect(result).toEqual(mockResponse);
    });

    it('should handle response with null resets_at', async () => {
      const mockResponse = {
        seven_day_opus: {
          utilization: 0.0,
          resets_at: null,
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchAnthropicUsage('sk-ant-oat01-test-token');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('formatUsagePeriod', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-11-04T10:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should format usage period with hours until reset', () => {
      const period = {
        utilization: 6.5,
        resets_at: '2025-11-04T14:30:00Z',
      };

      const result = formatUsagePeriod(period, 'Usage');
      expect(result).toContain('6.5% used');
      expect(result).toContain('4h 30m');
      expect(result).toContain('Usage');
    });

    it('should format usage period with minutes until reset', () => {
      const period = {
        utilization: 50.0,
        resets_at: '2025-11-04T10:45:00Z',
      };

      const result = formatUsagePeriod(period, 'Usage');
      expect(result).toContain('50.0% used');
      expect(result).toContain('in 45m');
    });

    it('should format usage period with soon when reset is very close', () => {
      const period = {
        utilization: 99.9,
        resets_at: '2025-11-04T10:00:30Z',
      };

      const result = formatUsagePeriod(period, 'Usage');
      expect(result).toContain('99.9% used');
      expect(result).toContain('soon');
    });

    it('should return null for null period', () => {
      const result = formatUsagePeriod(null, 'Usage');
      expect(result).toBeNull();
    });

    it('should handle null resets_at', () => {
      const period = {
        utilization: 0.0,
        resets_at: null,
      };

      const result = formatUsagePeriod(period, 'Usage');
      expect(result).toContain('0.0% used');
      expect(result).toContain('N/A');
    });

    it('should format utilization with one decimal place', () => {
      const period = {
        utilization: 15.234,
        resets_at: '2025-11-05T00:00:00Z',
      };

      const result = formatUsagePeriod(period, 'Usage');
      expect(result).toContain('15.2% used');
    });
  });

  describe('formatAllUsagePeriods', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-11-04T10:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should format all available usage periods', () => {
      const usage = {
        five_hour: {
          utilization: 6.5,
          resets_at: '2025-11-04T14:30:00Z',
        },
        seven_day: {
          utilization: 35.0,
          resets_at: '2025-11-06T00:00:00Z',
        },
        seven_day_oauth_apps: null,
        seven_day_opus: {
          utilization: 0.0,
          resets_at: null,
        },
      };

      const result = formatAllUsagePeriods(usage);
      expect(result).toHaveLength(3);
      expect(result[0]).toContain('5-hour window');
      expect(result[0]).toContain('6.5%');
      expect(result[1]).toContain('7-day window');
      expect(result[1]).toContain('35.0%');
      expect(result[2]).toContain('7-day Opus');
      expect(result[2]).toContain('0.0%');
    });

    it('should skip null periods', () => {
      const usage = {
        five_hour: null,
        seven_day: null,
        seven_day_oauth_apps: null,
        seven_day_opus: null,
      };

      const result = formatAllUsagePeriods(usage);
      expect(result).toHaveLength(0);
    });

    it('should handle empty usage object', () => {
      const result = formatAllUsagePeriods({});
      expect(result).toHaveLength(0);
    });

    it('should format unknown quota types with generated labels', () => {
      const usage = {
        five_hour: {
          utilization: 10.0,
          resets_at: '2025-11-04T14:00:00Z',
        },
        seven_day_sonnet: {
          utilization: 20.0,
          resets_at: '2025-11-08T00:00:00Z',
        },
        some_new_quota_type: {
          utilization: 30.0,
          resets_at: '2025-11-10T00:00:00Z',
        },
      };

      const result = formatAllUsagePeriods(usage);
      expect(result).toHaveLength(3);
      // Known labels
      expect(result.some((line) => line.includes('5-hour window'))).toBe(true);
      expect(result.some((line) => line.includes('7-day Sonnet'))).toBe(true);
      // Unknown label should be auto-generated
      expect(result.some((line) => line.includes('Some New Quota Type'))).toBe(
        true,
      );
    });
  });
});
