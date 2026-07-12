/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import {
  detectApiKeyProvider,
  detectApiKeyProviderFromName,
  fetchApiKeyQuota,
} from './apiKeyQuotaResolver.js';

const dependencies = {
  fetchZaiUsage: vi.fn(),
  formatZaiUsage: vi.fn(),
  fetchSyntheticUsage: vi.fn(),
  formatSyntheticUsage: vi.fn(),
  fetchChutesUsage: vi.fn(),
  formatChutesUsage: vi.fn(),
  fetchKimiUsage: vi.fn(),
  formatKimiUsage: vi.fn(),
  fetchKimiCodeUsage: vi.fn(),
  formatKimiCodeUsage: vi.fn(),
};

describe('apiKeyQuotaResolver', () => {
  describe('detectApiKeyProviderFromName', () => {
    it.each([
      // Valid provider names (various casings)
      ['kimi', 'kimi'],
      ['KIMI', 'kimi'],
      ['Kimi', 'kimi'],
      ['synthetic', 'synthetic'],
      ['SYNTHETIC', 'synthetic'],
      ['Synthetic', 'synthetic'],
      ['chutes', 'chutes'],
      ['CHUTES', 'chutes'],
      ['Chutes', 'chutes'],
      ['chutes-ai', 'chutes'],
      ['CHUTES-AI', 'chutes'],
      ['Chutes-Ai', 'chutes'],
      ['zai', 'zai'],
      ['ZAI', 'zai'],
      ['Zai', 'zai'],
      // Invalid inputs
      ['openai', null],
      ['unknown', null],
      ['', null],
      ['   ', null],
      [undefined, null],
      [null as unknown as string, null],
      [42 as unknown as string, null],
    ])('detectApiKeyProviderFromName("%s") returns %s', (input, expected) => {
      expect(detectApiKeyProviderFromName(input)).toBe(expected);
    });
  });

  describe('detectApiKeyProvider', () => {
    it('should detect Z.ai from api.z.ai base URL', () => {
      expect(detectApiKeyProvider('https://api.z.ai/v1')).toBe('zai');
    });

    it('should detect Z.ai case-insensitively', () => {
      expect(detectApiKeyProvider('https://API.Z.AI/v1')).toBe('zai');
    });

    it('should detect Z.ai from bare z.ai domain', () => {
      expect(detectApiKeyProvider('https://z.ai/v1')).toBe('zai');
    });

    it('should not detect Z.ai from unrelated domains containing z.ai', () => {
      expect(detectApiKeyProvider('https://notz.ai/v1')).toBeNull();
    });

    it('should detect Synthetic from synthetic.new base URL', () => {
      expect(detectApiKeyProvider('https://api.synthetic.new/v1')).toBe(
        'synthetic',
      );
    });

    it('should detect Chutes from chutes.ai base URL', () => {
      expect(detectApiKeyProvider('https://api.chutes.ai/v1')).toBe('chutes');
    });

    it('should detect Kimi from kimi.com base URL', () => {
      expect(detectApiKeyProvider('https://api.kimi.com/v1')).toBe('kimi');
    });

    it('should detect Kimi from moonshot.ai base URL', () => {
      expect(detectApiKeyProvider('https://api.moonshot.ai/v1')).toBe('kimi');
    });

    it('should detect Kimi from moonshot.cn base URL', () => {
      expect(detectApiKeyProvider('https://api.moonshot.cn/v1')).toBe('kimi');
    });

    it('should return null for unknown providers', () => {
      expect(detectApiKeyProvider('https://api.openai.com/v1')).toBeNull();
    });

    it('should return null for undefined base URL', () => {
      expect(detectApiKeyProvider(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(detectApiKeyProvider('')).toBeNull();
    });

    it('should return null for non-string input', () => {
      expect(detectApiKeyProvider(42 as unknown as string)).toBeNull();
    });

    it('should return null for invalid URL format', () => {
      expect(detectApiKeyProvider('not-a-url')).toBeNull();
    });
  });

  describe('fetchApiKeyQuota', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('should return null for empty API key', async () => {
      const result = await fetchApiKeyQuota('zai', '', undefined, dependencies);
      expect(result).toBeNull();
    });

    it('should return null for invalid API key', async () => {
      const result = await fetchApiKeyQuota(
        'zai',
        undefined as unknown as string,
        undefined,
        dependencies,
      );
      expect(result).toBeNull();
    });

    it('should fetch and format Z.ai quota', async () => {
      const mockUsage = { data: { limits: [], level: 'max' } };
      const mockLines = ['  Plan: Max'];
      dependencies.fetchZaiUsage.mockResolvedValue(
        mockUsage as ReturnType<
          typeof dependencies.fetchZaiUsage
        > extends Promise<infer T>
          ? T
          : never,
      );
      dependencies.formatZaiUsage.mockReturnValue(mockLines);

      const result = await fetchApiKeyQuota(
        'zai',
        'test-key',
        'https://api.z.ai/v1',
        dependencies,
      );

      expect(dependencies.fetchZaiUsage).toHaveBeenCalledWith(
        'test-key',
        'https://api.z.ai/v1',
      );
      expect(result).toStrictEqual({ provider: 'Z.ai', lines: mockLines });
    });

    it('should fetch and format Synthetic quota', async () => {
      const mockUsage = {
        subscription: { limit: 100, requests: 50, renewsAt: '2026-01-01' },
      };
      const mockLines = ['  Subscription: 50/100'];
      dependencies.fetchSyntheticUsage.mockResolvedValue(
        mockUsage as ReturnType<
          typeof dependencies.fetchSyntheticUsage
        > extends Promise<infer T>
          ? T
          : never,
      );
      dependencies.formatSyntheticUsage.mockReturnValue(mockLines);

      const result = await fetchApiKeyQuota(
        'synthetic',
        'test-key',
        undefined,
        dependencies,
      );

      expect(dependencies.fetchSyntheticUsage).toHaveBeenCalledWith('test-key');
      expect(result).toStrictEqual({ provider: 'Synthetic', lines: mockLines });
    });

    it('should fetch and format Chutes quota', async () => {
      const mockUsage = {
        quotas: [],
        balance: 10.0,
        username: 'test',
      };
      const mockLines = ['  Balance: $10.00'];
      dependencies.fetchChutesUsage.mockResolvedValue(
        mockUsage as ReturnType<
          typeof dependencies.fetchChutesUsage
        > extends Promise<infer T>
          ? T
          : never,
      );
      dependencies.formatChutesUsage.mockReturnValue(mockLines);

      const result = await fetchApiKeyQuota(
        'chutes',
        'test-key',
        undefined,
        dependencies,
      );

      expect(dependencies.fetchChutesUsage).toHaveBeenCalledWith('test-key');
      expect(result).toStrictEqual({ provider: 'Chutes', lines: mockLines });
    });

    it('should fetch and format Kimi quota for standard keys', async () => {
      const mockUsage = { available_balance: 42.5 };
      const mockLines = ['  Available balance: $42.50'];
      dependencies.fetchKimiUsage.mockResolvedValue(
        mockUsage as ReturnType<
          typeof dependencies.fetchKimiUsage
        > extends Promise<infer T>
          ? T
          : never,
      );
      dependencies.formatKimiUsage.mockReturnValue(mockLines);

      const result = await fetchApiKeyQuota(
        'kimi',
        'sk-standard-key',
        'https://api.moonshot.ai/v1',
        dependencies,
      );

      expect(dependencies.fetchKimiUsage).toHaveBeenCalledWith(
        'sk-standard-key',
        'https://api.moonshot.ai/v1',
      );
      expect(result).toStrictEqual({ provider: 'Kimi', lines: mockLines });
    });

    it('should fetch and format Kimi Code quota for sk-kimi- keys', async () => {
      const mockUsage = {
        usage: { limit: '100', remaining: '85' },
      };
      const mockLines = ['  Weekly quota: 15/100 used (85 remaining)'];
      dependencies.fetchKimiCodeUsage.mockResolvedValue(
        mockUsage as ReturnType<
          typeof dependencies.fetchKimiCodeUsage
        > extends Promise<infer T>
          ? T
          : never,
      );
      dependencies.formatKimiCodeUsage.mockReturnValue(mockLines);

      const result = await fetchApiKeyQuota(
        'kimi',
        'sk-kimi-subscription-key',
        'https://api.kimi.com/coding/v1',
        dependencies,
      );

      expect(dependencies.fetchKimiCodeUsage).toHaveBeenCalledWith(
        'sk-kimi-subscription-key',
        'https://api.kimi.com/coding/v1',
      );
      expect(result).toStrictEqual({ provider: 'Kimi Code', lines: mockLines });
    });

    it('should return null when Kimi Code fetch returns null', async () => {
      dependencies.fetchKimiCodeUsage.mockResolvedValue(null);

      const result = await fetchApiKeyQuota(
        'kimi',
        'sk-kimi-subscription-key',
        undefined,
        dependencies,
      );
      expect(result).toBeNull();
    });

    it('should return null when fetch returns null', async () => {
      dependencies.fetchZaiUsage.mockResolvedValue(null);

      const result = await fetchApiKeyQuota(
        'zai',
        'test-key',
        undefined,
        dependencies,
      );
      expect(result).toBeNull();
    });

    it('should return null for unknown provider', async () => {
      const result = await fetchApiKeyQuota(
        'unknown',
        'test-key',
        undefined,
        dependencies,
      );
      expect(result).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      dependencies.fetchZaiUsage.mockRejectedValue(new Error('test error'));

      const result = await fetchApiKeyQuota(
        'zai',
        'test-key',
        undefined,
        dependencies,
      );
      expect(result).toBeNull();
    });
  });
});
