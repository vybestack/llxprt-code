/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchAnthropicUsage, formatUsagePeriod } from './usageInfo.js';

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
          utilization: 15.2,
          resets_at: '2025-11-07T00:00:00Z',
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

    it('should handle invalid response data', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ invalid: 'data' }),
      } as Response);

      const result = await fetchAnthropicUsage('sk-ant-oat01-test-token');
      expect(result).toBeNull();
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

    it('should handle response with only seven_day data', async () => {
      const mockResponse = {
        seven_day: {
          utilization: 75.5,
          resets_at: '2025-11-10T00:00:00Z',
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

    it('should format utilization with one decimal place', () => {
      const period = {
        utilization: 15.234,
        resets_at: '2025-11-05T00:00:00Z',
      };

      const result = formatUsagePeriod(period, 'Usage');
      expect(result).toContain('15.2% used');
    });
  });
});
