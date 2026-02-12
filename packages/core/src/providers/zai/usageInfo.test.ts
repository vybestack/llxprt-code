/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchZaiUsage, formatZaiUsage } from './usageInfo.js';

describe('usageInfo', () => {
  describe('fetchZaiUsage', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return null for empty API key', async () => {
      const result = await fetchZaiUsage('');
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return null for non-string API key', async () => {
      const result = await fetchZaiUsage(undefined as unknown as string);
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should fetch usage info with correct headers and NO Bearer prefix', async () => {
      const mockResponse = {
        code: 200,
        msg: 'Operation successful',
        data: {
          limits: [
            {
              type: 'TOKENS_LIMIT',
              unit: 3,
              number: 5,
              percentage: 42,
              nextResetTime: 1770850349270,
            },
          ],
          level: 'max',
        },
        success: true,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchZaiUsage('zai-test-key-123');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.z.ai/api/monitor/usage/quota/limit',
        {
          method: 'GET',
          headers: {
            Authorization: 'zai-test-key-123',
            'Accept-Language': 'en-US,en',
            'Content-Type': 'application/json',
          },
          signal: expect.any(AbortSignal),
        },
      );
      expect(result).toEqual(mockResponse);
    });

    it('should NOT include Bearer prefix in Authorization header', async () => {
      const mockResponse = {
        code: 200,
        msg: 'Operation successful',
        data: {
          limits: [],
          level: 'free',
        },
        success: true,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchZaiUsage('my-api-key');

      const callArgs = fetchMock.mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];
      const headers = callArgs[1].headers;
      expect(headers.Authorization).toBe('my-api-key');
      expect(headers.Authorization).not.toContain('Bearer');
    });

    it('should parse full response with all limit types', async () => {
      const mockResponse = {
        code: 200,
        msg: 'Operation successful',
        data: {
          limits: [
            {
              type: 'TIME_LIMIT',
              unit: 5,
              number: 1,
              usage: 4000,
              currentValue: 1500,
              remaining: 2500,
              percentage: 37,
              nextResetTime: 1771522071984,
              usageDetails: [
                { modelCode: 'search-prime', usage: 500 },
                { modelCode: 'web-reader', usage: 1000 },
                { modelCode: 'zread', usage: 0 },
              ],
            },
            {
              type: 'TOKENS_LIMIT',
              unit: 3,
              number: 5,
              percentage: 1,
              nextResetTime: 1770850349270,
            },
          ],
          level: 'max',
        },
        success: true,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchZaiUsage('test-key');
      expect(result).toEqual(mockResponse);
      expect(result?.data.limits).toHaveLength(2);
      expect(result?.data.level).toBe('max');
    });

    it('should handle HTTP errors gracefully', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response);

      const result = await fetchZaiUsage('bad-key');
      expect(result).toBeNull();
    });

    it('should handle network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchZaiUsage('test-key');
      expect(result).toBeNull();
    });

    it('should handle invalid JSON response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      } as unknown as Response);

      const result = await fetchZaiUsage('test-key');
      expect(result).toBeNull();
    });

    it('should handle response with unknown fields via passthrough', async () => {
      const mockResponse = {
        code: 200,
        msg: 'Operation successful',
        data: {
          limits: [],
          level: 'max',
          someNewField: 'value',
        },
        success: true,
        extraField: 42,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchZaiUsage('test-key');
      expect(result).toEqual(mockResponse);
    });

    it('should use custom base URL when provided', async () => {
      const mockResponse = {
        code: 200,
        msg: 'Operation successful',
        data: {
          limits: [],
          level: 'free',
        },
        success: true,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchZaiUsage('test-key', 'https://custom.z.ai/v1');

      const callArgs = fetchMock.mock.calls[0] as [string, unknown];
      expect(callArgs[0]).toBe(
        'https://custom.z.ai/api/monitor/usage/quota/limit',
      );
    });

    it('should include fetch timeout signal in request options', async () => {
      const mockResponse = {
        code: 200,
        msg: 'Operation successful',
        data: {
          limits: [],
          level: 'free',
        },
        success: true,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchZaiUsage('test-key');

      const secondArg = fetchMock.mock.calls[0]?.[1] as {
        signal?: unknown;
      };
      expect(secondArg).toBeDefined();
      expect(secondArg.signal).toBeDefined();
      expect(secondArg.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('formatZaiUsage', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-10T10:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should show plan level', () => {
      const usage = {
        code: 200,
        msg: 'Operation successful',
        data: {
          limits: [],
          level: 'max',
        },
        success: true,
      };

      const result = formatZaiUsage(usage);
      expect(result.some((line) => line.includes('Plan: Max'))).toBe(true);
    });

    it('should format TOKENS_LIMIT with percentage and reset time', () => {
      const resetTime = new Date('2026-02-10T14:30:00Z').getTime();
      const usage = {
        code: 200,
        msg: 'Operation successful',
        data: {
          limits: [
            {
              type: 'TOKENS_LIMIT',
              unit: 3,
              number: 5,
              percentage: 42,
              nextResetTime: resetTime,
            },
          ],
          level: 'pro',
        },
        success: true,
      };

      const result = formatZaiUsage(usage);
      expect(result.some((line) => line.includes('5-hour token usage'))).toBe(
        true,
      );
      expect(result.some((line) => line.includes('42% used'))).toBe(true);
      expect(result.some((line) => line.includes('4h 30m'))).toBe(true);
    });

    it('should format TIME_LIMIT with usage and remaining', () => {
      const resetTime = new Date('2026-03-10T10:00:00Z').getTime();
      const usage = {
        code: 200,
        msg: 'Operation successful',
        data: {
          limits: [
            {
              type: 'TIME_LIMIT',
              unit: 5,
              number: 1,
              usage: 4000,
              currentValue: 1500,
              remaining: 2500,
              percentage: 37,
              nextResetTime: resetTime,
              usageDetails: [
                { modelCode: 'search-prime', usage: 500 },
                { modelCode: 'web-reader', usage: 1000 },
                { modelCode: 'zread', usage: 0 },
              ],
            },
          ],
          level: 'max',
        },
        success: true,
      };

      const result = formatZaiUsage(usage);
      expect(result.some((line) => line.includes('MCP usage (monthly)'))).toBe(
        true,
      );
      expect(result.some((line) => line.includes('1500/4000'))).toBe(true);
      expect(result.some((line) => line.includes('2500 remaining'))).toBe(true);
    });

    it('should show tool breakdown for TIME_LIMIT with usage details', () => {
      const resetTime = new Date('2026-03-10T10:00:00Z').getTime();
      const usage = {
        code: 200,
        msg: 'Operation successful',
        data: {
          limits: [
            {
              type: 'TIME_LIMIT',
              unit: 5,
              number: 1,
              usage: 4000,
              currentValue: 1500,
              remaining: 2500,
              percentage: 37,
              nextResetTime: resetTime,
              usageDetails: [
                { modelCode: 'search-prime', usage: 500 },
                { modelCode: 'web-reader', usage: 1000 },
                { modelCode: 'zread', usage: 0 },
              ],
            },
          ],
          level: 'max',
        },
        success: true,
      };

      const result = formatZaiUsage(usage);
      expect(
        result.some(
          (line) => line.includes('search-prime') && line.includes('500'),
        ),
      ).toBe(true);
      expect(
        result.some(
          (line) => line.includes('web-reader') && line.includes('1000'),
        ),
      ).toBe(true);
    });

    it('should skip usage details with zero usage', () => {
      const resetTime = new Date('2026-03-10T10:00:00Z').getTime();
      const usage = {
        code: 200,
        msg: 'Operation successful',
        data: {
          limits: [
            {
              type: 'TIME_LIMIT',
              unit: 5,
              number: 1,
              usage: 4000,
              currentValue: 500,
              remaining: 3500,
              percentage: 12,
              nextResetTime: resetTime,
              usageDetails: [
                { modelCode: 'search-prime', usage: 500 },
                { modelCode: 'zread', usage: 0 },
              ],
            },
          ],
          level: 'max',
        },
        success: true,
      };

      const result = formatZaiUsage(usage);
      expect(result.some((line) => line.includes('zread'))).toBe(false);
    });

    it('should handle empty limits array', () => {
      const usage = {
        code: 200,
        msg: 'Operation successful',
        data: {
          limits: [],
          level: 'free',
        },
        success: true,
      };

      const result = formatZaiUsage(usage);
      // Should only have the plan line
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('Plan: Free');
    });

    it('should format reset time with hours and minutes', () => {
      const resetTime = new Date('2026-02-10T12:30:00Z').getTime();
      const usage = {
        code: 200,
        msg: 'Operation successful',
        data: {
          limits: [
            {
              type: 'TOKENS_LIMIT',
              unit: 3,
              number: 5,
              percentage: 10,
              nextResetTime: resetTime,
            },
          ],
          level: 'max',
        },
        success: true,
      };

      const result = formatZaiUsage(usage);
      expect(result.some((line) => line.includes('2h 30m'))).toBe(true);
    });

    it('should format reset time with only minutes when less than 1 hour', () => {
      const resetTime = new Date('2026-02-10T10:45:00Z').getTime();
      const usage = {
        code: 200,
        msg: 'Operation successful',
        data: {
          limits: [
            {
              type: 'TOKENS_LIMIT',
              unit: 3,
              number: 5,
              percentage: 80,
              nextResetTime: resetTime,
            },
          ],
          level: 'max',
        },
        success: true,
      };

      const result = formatZaiUsage(usage);
      expect(result.some((line) => line.includes('in 45m'))).toBe(true);
    });

    it('should format reset time as soon when very close', () => {
      const resetTime = new Date('2026-02-10T10:00:30Z').getTime();
      const usage = {
        code: 200,
        msg: 'Operation successful',
        data: {
          limits: [
            {
              type: 'TOKENS_LIMIT',
              unit: 3,
              number: 5,
              percentage: 99,
              nextResetTime: resetTime,
            },
          ],
          level: 'max',
        },
        success: true,
      };

      const result = formatZaiUsage(usage);
      expect(result.some((line) => line.includes('soon'))).toBe(true);
    });

    it('should format both TOKENS_LIMIT and TIME_LIMIT together', () => {
      const tokenResetTime = new Date('2026-02-10T14:00:00Z').getTime();
      const timeResetTime = new Date('2026-03-10T10:00:00Z').getTime();
      const usage = {
        code: 200,
        msg: 'Operation successful',
        data: {
          limits: [
            {
              type: 'TIME_LIMIT',
              unit: 5,
              number: 1,
              usage: 4000,
              currentValue: 0,
              remaining: 4000,
              percentage: 0,
              nextResetTime: timeResetTime,
              usageDetails: [],
            },
            {
              type: 'TOKENS_LIMIT',
              unit: 3,
              number: 5,
              percentage: 25,
              nextResetTime: tokenResetTime,
            },
          ],
          level: 'max',
        },
        success: true,
      };

      const result = formatZaiUsage(usage);
      expect(result.some((line) => line.includes('Plan: Max'))).toBe(true);
      expect(result.some((line) => line.includes('5-hour token usage'))).toBe(
        true,
      );
      expect(result.some((line) => line.includes('MCP usage (monthly)'))).toBe(
        true,
      );
    });

    it('should capitalize plan level', () => {
      const usage = {
        code: 200,
        msg: 'Operation successful',
        data: {
          limits: [],
          level: 'pro',
        },
        success: true,
      };

      const result = formatZaiUsage(usage);
      expect(result[0]).toContain('Plan: Pro');
    });
  });
});
