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
  CodexRateLimitResetCreditsResponseSchema,
} from './codexRateLimitReset.js';

describe('codexRateLimitReset', () => {
  describe('fetchCodexRateLimitResetCredits', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      fetchMock = vi.fn();
      global.fetch = fetchMock;
    });

    afterEach(() => {
      global.fetch = originalFetch;
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

    it('should fall back to the ChatGPT backend-api root when the base URL has no /backend-api segment', async () => {
      // The wham reset-credit endpoints only exist on the ChatGPT backend-api
      // surface (unlike /api/codex/usage). A base URL that does not target
      // /backend-api must therefore fall back to the ChatGPT root rather than
      // fabricate a /wham path against an unrelated origin. This matches the
      // issue contract: "fall back to https://chatgpt.com/backend-api".
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
        'https://proxy.example.com/v1',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits',
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
      expect(result?.rate_limit_reset_credits).toBeDefined();
      expect(result?.rate_limit_reset_credits.available_count).toBe(0);
      expect(result?.rate_limit_reset_credits.credits).toStrictEqual([]);
    });

    it('should return null when rate_limit_reset_credits is present but schema-invalid', async () => {
      // available_count: -1 violates the .nonnegative() constraint.
      const mockResponse = {
        rate_limit_reset_credits: {
          available_count: -1,
          credits: [],
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
      expect(result).toBeNull();
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

    it('should return null when fetch times out via DOMException TimeoutError', async () => {
      fetchMock.mockRejectedValueOnce(
        new DOMException('The operation timed out.', 'TimeoutError'),
      );

      const result = await fetchCodexRateLimitResetCredits(
        'token123',
        'account123',
      );
      expect(result).toBeNull();
    });

    it('should attempt a fetch for a whitespace-only access token (current behavior)', async () => {
      // The guard checks `!accessToken` which treats '   ' as truthy, so a
      // whitespace-only token passes validation and a fetch IS attempted.
      // This documents the actual current behavior; tightening to reject
      // whitespace would be a behavior change out of scope here.
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

      await fetchCodexRateLimitResetCredits('   ', 'account123');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('consumeCodexRateLimitResetCredit', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      fetchMock = vi.fn();
      global.fetch = fetchMock;
    });

    afterEach(() => {
      global.fetch = originalFetch;
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

    it('should handle malformed JSON', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
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

    it('should send the full request shape (body + headers) when using a custom base URL', async () => {
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
    });

    it('should strip /backend-api/codex to backend-api root for the consume endpoint', async () => {
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
        'https://chatgpt.com/backend-api/codex',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should fall back to ChatGPT backend-api root when base URL lacks /backend-api', async () => {
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
        'https://proxy.example.com/v1',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('formatCodexResetCredits', () => {
    it('should return empty array when rate_limit_reset_credits is undefined', () => {
      const data = CodexRateLimitResetCreditsResponseSchema.parse({});

      const result = formatCodexResetCredits(data);
      expect(result).toStrictEqual([]);
    });

    it('should format credits with available count and credit ids', () => {
      const data = CodexRateLimitResetCreditsResponseSchema.parse({
        rate_limit_reset_credits: {
          available_count: 2,
          credits: [{ id: 'credit-1' }, { id: 'credit-2', source: 'referral' }],
        },
      });

      const result = formatCodexResetCredits(data);
      expect(result.length).toBe(3);
      expect(result[0]).toBe('  Available reset credits: 2');
      expect(result[1]).toBe('  - credit-1');
      expect(result[2]).toBe('  - credit-2');
    });

    it('should return empty array when available_count is 0', () => {
      const data = CodexRateLimitResetCreditsResponseSchema.parse({
        rate_limit_reset_credits: {
          available_count: 0,
          credits: [],
        },
      });

      const result = formatCodexResetCredits(data);
      expect(result).toStrictEqual([]);
    });

    it('should surface available count with placeholder when credits is empty but available_count > 0', () => {
      const data = CodexRateLimitResetCreditsResponseSchema.parse({
        rate_limit_reset_credits: {
          available_count: 3,
          credits: [],
        },
      });

      const result = formatCodexResetCredits(data);
      expect(result.length).toBe(2);
      expect(result[0]).toBe('  Available reset credits: 3');
      expect(result[1]).toBe('  - (no credit details returned)');
    });

    it('should format single credit', () => {
      const data = CodexRateLimitResetCreditsResponseSchema.parse({
        rate_limit_reset_credits: {
          available_count: 1,
          credits: [{ id: 'credit-only' }],
        },
      });

      const result = formatCodexResetCredits(data);
      expect(result.length).toBe(2);
      expect(result[0]).toBe('  Available reset credits: 1');
      expect(result[1]).toBe('  - credit-only');
    });
  });
});
