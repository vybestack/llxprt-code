/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchCodexRateLimitResetCredits,
  consumeCodexRateLimitResetCredit,
  formatCodexResetCredits,
} from './codexRateLimitReset.js';

describe('codexRateLimitReset', () => {
  describe('fetchCodexRateLimitResetCredits', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      global.fetch = fetchMock;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return null for empty access token', async () => {
      const result = await fetchCodexRateLimitResetCredits('', 'account123');
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return null for empty account ID', async () => {
      const result = await fetchCodexRateLimitResetCredits('token123', '');
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should fetch reset credits with valid credentials', async () => {
      const mockResponse = {
        rate_limit_reset_credits: {
          available_count: 2,
          credits: [{ id: 'credit-1' }, { id: 'credit-2', source: 'referral' }],
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchCodexRateLimitResetCredits(
        'token123',
        'account123',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits',
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
      expect(result).toStrictEqual(mockResponse);
    });

    it('should derive backend-api root when base URL includes /backend-api/codex', async () => {
      const mockResponse = {
        rate_limit_reset_credits: {
          available_count: 1,
          credits: [{ id: 'credit-1' }],
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchCodexRateLimitResetCredits(
        'token123',
        'account123',
        'https://chatgpt.com/backend-api/codex',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits',
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });

    it('should derive backend-api root when base URL is /backend-api', async () => {
      const mockResponse = {
        rate_limit_reset_credits: {
          available_count: 0,
          credits: [],
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchCodexRateLimitResetCredits(
        'token123',
        'account123',
        'https://custom.example.com/backend-api',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://custom.example.com/backend-api/wham/rate-limit-reset-credits',
        expect.objectContaining({
          method: 'GET',
        }),
      );
    });

    it('should handle HTTP errors gracefully', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response);

      const result = await fetchCodexRateLimitResetCredits(
        'token123',
        'account123',
      );
      expect(result).toBeNull();
    });

    it('should handle network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchCodexRateLimitResetCredits(
        'token123',
        'account123',
      );
      expect(result).toBeNull();
    });

    it('should handle malformed JSON', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      } as Response);

      const result = await fetchCodexRateLimitResetCredits(
        'token123',
        'account123',
      );
      expect(result).toBeNull();
    });

    it('should degrade to available_count 0 / empty credits when rate_limit_reset_credits is missing', async () => {
      const mockResponse = {
        unrelated_field: 'something',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchCodexRateLimitResetCredits(
        'token123',
        'account123',
      );

      expect(result).not.toBeNull();
      expect(result?.rate_limit_reset_credits.available_count).toBe(0);
      expect(result?.rate_limit_reset_credits.credits).toStrictEqual([]);
    });

    it('should include fetch timeout signal in request options', async () => {
      const mockResponse = {
        rate_limit_reset_credits: {
          available_count: 0,
          credits: [],
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await fetchCodexRateLimitResetCredits('token123', 'account123');

      const secondArg = fetchMock.mock.calls[0]?.[1] as {
        signal?: unknown;
      };
      expect(secondArg).toBeDefined();
      expect(secondArg.signal).toBeDefined();
      expect(secondArg.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('consumeCodexRateLimitResetCredit', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      global.fetch = fetchMock;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return null for empty access token', async () => {
      const result = await consumeCodexRateLimitResetCredit(
        '',
        'account123',
        'credit-1',
        'redeem-1',
      );
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return null for empty account ID', async () => {
      const result = await consumeCodexRateLimitResetCredit(
        'token123',
        '',
        'credit-1',
        'redeem-1',
      );
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return null for empty credit ID', async () => {
      const result = await consumeCodexRateLimitResetCredit(
        'token123',
        'account123',
        '',
        'redeem-1',
      );
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return null for empty redeem request ID', async () => {
      const result = await consumeCodexRateLimitResetCredit(
        'token123',
        'account123',
        'credit-1',
        '',
      );
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should consume a credit successfully with reset code', async () => {
      const mockResponse = {
        code: 'reset',
        credit: { id: 'credit-1' },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await consumeCodexRateLimitResetCredit(
        'token123',
        'account123',
        'credit-1',
        'redeem-1',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token123',
            'ChatGPT-Account-Id': 'account123',
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            credit_id: 'credit-1',
            redeem_request_id: 'redeem-1',
          }),
          signal: expect.any(AbortSignal),
        },
      );
      expect(result).toStrictEqual(mockResponse);
    });

    it('should parse already_redeemed code without credit', async () => {
      const mockResponse = {
        code: 'already_redeemed',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await consumeCodexRateLimitResetCredit(
        'token123',
        'account123',
        'credit-1',
        'redeem-1',
      );

      expect(result).toStrictEqual(mockResponse);
      expect(result?.code).toBe('already_redeemed');
    });

    it('should handle HTTP errors gracefully', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      const result = await consumeCodexRateLimitResetCredit(
        'token123',
        'account123',
        'credit-1',
        'redeem-1',
      );
      expect(result).toBeNull();
    });

    it('should handle network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await consumeCodexRateLimitResetCredit(
        'token123',
        'account123',
        'credit-1',
        'redeem-1',
      );
      expect(result).toBeNull();
    });

    it('should handle invalid code enum', async () => {
      const mockResponse = {
        code: 'unknown_code',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await consumeCodexRateLimitResetCredit(
        'token123',
        'account123',
        'credit-1',
        'redeem-1',
      );
      expect(result).toBeNull();
    });

    it('should use custom base URL when provided', async () => {
      const mockResponse = {
        code: 'reset',
        credit: { id: 'credit-1' },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await consumeCodexRateLimitResetCredit(
        'token123',
        'account123',
        'credit-1',
        'redeem-1',
        'https://custom.example.com/backend-api',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://custom.example.com/backend-api/wham/rate-limit-reset-credits/consume',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
  });

  describe('formatCodexResetCredits', () => {
    it('should format credits with available count and credit ids', () => {
      const data = {
        rate_limit_reset_credits: {
          available_count: 2,
          credits: [{ id: 'credit-1' }, { id: 'credit-2', source: 'referral' }],
        },
      };

      const result = formatCodexResetCredits(data);
      expect(result.length).toBe(3);
      expect(result[0]).toBe('  Available reset credits: 2');
      expect(result[1]).toBe('  - credit-1');
      expect(result[2]).toBe('  - credit-2');
    });

    it('should return empty array when available_count is 0', () => {
      const data = {
        rate_limit_reset_credits: {
          available_count: 0,
          credits: [],
        },
      };

      const result = formatCodexResetCredits(data);
      expect(result).toStrictEqual([]);
    });

    it('should format single credit', () => {
      const data = {
        rate_limit_reset_credits: {
          available_count: 1,
          credits: [{ id: 'credit-only' }],
        },
      };

      const result = formatCodexResetCredits(data);
      expect(result.length).toBe(2);
      expect(result[0]).toBe('  Available reset credits: 1');
      expect(result[1]).toBe('  - credit-only');
    });
  });
});
