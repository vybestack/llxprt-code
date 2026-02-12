/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  detectApiKeyProvider,
  fetchApiKeyQuota,
} from './apiKeyQuotaResolver.js';

// Mock all the usage info modules
vi.mock('./zai/usageInfo.js', () => ({
  fetchZaiUsage: vi.fn(),
  formatZaiUsage: vi.fn(),
}));

vi.mock('./synthetic/usageInfo.js', () => ({
  fetchSyntheticUsage: vi.fn(),
  formatSyntheticUsage: vi.fn(),
}));

vi.mock('./chutes/usageInfo.js', () => ({
  fetchChutesUsage: vi.fn(),
  formatChutesUsage: vi.fn(),
}));

vi.mock('./kimi/usageInfo.js', () => ({
  fetchKimiUsage: vi.fn(),
  formatKimiUsage: vi.fn(),
  fetchKimiCodeUsage: vi.fn(),
  formatKimiCodeUsage: vi.fn(),
}));

describe('apiKeyQuotaResolver', () => {
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

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return null for empty API key', async () => {
      const result = await fetchApiKeyQuota('zai', '');
      expect(result).toBeNull();
    });

    it('should return null for invalid API key', async () => {
      const result = await fetchApiKeyQuota(
        'zai',
        undefined as unknown as string,
      );
      expect(result).toBeNull();
    });

    it('should fetch and format Z.ai quota', async () => {
      const { fetchZaiUsage, formatZaiUsage } = await import(
        './zai/usageInfo.js'
      );
      const mockUsage = { data: { limits: [], level: 'max' } };
      const mockLines = ['  Plan: Max'];
      vi.mocked(fetchZaiUsage).mockResolvedValue(
        mockUsage as ReturnType<typeof fetchZaiUsage> extends Promise<infer T>
          ? T
          : never,
      );
      vi.mocked(formatZaiUsage).mockReturnValue(mockLines);

      const result = await fetchApiKeyQuota(
        'zai',
        'test-key',
        'https://api.z.ai/v1',
      );

      expect(fetchZaiUsage).toHaveBeenCalledWith(
        'test-key',
        'https://api.z.ai/v1',
      );
      expect(result).toEqual({ provider: 'Z.ai', lines: mockLines });
    });

    it('should fetch and format Synthetic quota', async () => {
      const { fetchSyntheticUsage, formatSyntheticUsage } = await import(
        './synthetic/usageInfo.js'
      );
      const mockUsage = {
        subscription: { limit: 100, requests: 50, renewsAt: '2026-01-01' },
      };
      const mockLines = ['  Subscription: 50/100'];
      vi.mocked(fetchSyntheticUsage).mockResolvedValue(
        mockUsage as ReturnType<typeof fetchSyntheticUsage> extends Promise<
          infer T
        >
          ? T
          : never,
      );
      vi.mocked(formatSyntheticUsage).mockReturnValue(mockLines);

      const result = await fetchApiKeyQuota('synthetic', 'test-key');

      expect(fetchSyntheticUsage).toHaveBeenCalledWith('test-key');
      expect(result).toEqual({ provider: 'Synthetic', lines: mockLines });
    });

    it('should fetch and format Chutes quota', async () => {
      const { fetchChutesUsage, formatChutesUsage } = await import(
        './chutes/usageInfo.js'
      );
      const mockUsage = {
        quotas: [],
        balance: 10.0,
        username: 'test',
      };
      const mockLines = ['  Balance: $10.00'];
      vi.mocked(fetchChutesUsage).mockResolvedValue(
        mockUsage as ReturnType<typeof fetchChutesUsage> extends Promise<
          infer T
        >
          ? T
          : never,
      );
      vi.mocked(formatChutesUsage).mockReturnValue(mockLines);

      const result = await fetchApiKeyQuota('chutes', 'test-key');

      expect(fetchChutesUsage).toHaveBeenCalledWith('test-key');
      expect(result).toEqual({ provider: 'Chutes', lines: mockLines });
    });

    it('should fetch and format Kimi quota for standard keys', async () => {
      const { fetchKimiUsage, formatKimiUsage } = await import(
        './kimi/usageInfo.js'
      );
      const mockUsage = { available_balance: 42.5 };
      const mockLines = ['  Available balance: $42.50'];
      vi.mocked(fetchKimiUsage).mockResolvedValue(
        mockUsage as ReturnType<typeof fetchKimiUsage> extends Promise<infer T>
          ? T
          : never,
      );
      vi.mocked(formatKimiUsage).mockReturnValue(mockLines);

      const result = await fetchApiKeyQuota(
        'kimi',
        'sk-standard-key',
        'https://api.moonshot.ai/v1',
      );

      expect(fetchKimiUsage).toHaveBeenCalledWith(
        'sk-standard-key',
        'https://api.moonshot.ai/v1',
      );
      expect(result).toEqual({ provider: 'Kimi', lines: mockLines });
    });

    it('should fetch and format Kimi Code quota for sk-kimi- keys', async () => {
      const { fetchKimiCodeUsage, formatKimiCodeUsage } = await import(
        './kimi/usageInfo.js'
      );
      const mockUsage = {
        usage: { limit: '100', remaining: '85' },
      };
      const mockLines = ['  Weekly quota: 15/100 used (85 remaining)'];
      vi.mocked(fetchKimiCodeUsage).mockResolvedValue(
        mockUsage as ReturnType<typeof fetchKimiCodeUsage> extends Promise<
          infer T
        >
          ? T
          : never,
      );
      vi.mocked(formatKimiCodeUsage).mockReturnValue(mockLines);

      const result = await fetchApiKeyQuota(
        'kimi',
        'sk-kimi-subscription-key',
        'https://api.kimi.com/coding/v1',
      );

      expect(fetchKimiCodeUsage).toHaveBeenCalledWith(
        'sk-kimi-subscription-key',
        'https://api.kimi.com/coding/v1',
      );
      expect(result).toEqual({ provider: 'Kimi Code', lines: mockLines });
    });

    it('should return null when Kimi Code fetch returns null', async () => {
      const { fetchKimiCodeUsage } = await import('./kimi/usageInfo.js');
      vi.mocked(fetchKimiCodeUsage).mockResolvedValue(null);

      const result = await fetchApiKeyQuota('kimi', 'sk-kimi-subscription-key');
      expect(result).toBeNull();
    });

    it('should return null when fetch returns null', async () => {
      const { fetchZaiUsage } = await import('./zai/usageInfo.js');
      vi.mocked(fetchZaiUsage).mockResolvedValue(null);

      const result = await fetchApiKeyQuota('zai', 'test-key');
      expect(result).toBeNull();
    });

    it('should return null for unknown provider', async () => {
      const result = await fetchApiKeyQuota('unknown', 'test-key');
      expect(result).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      const { fetchZaiUsage } = await import('./zai/usageInfo.js');
      vi.mocked(fetchZaiUsage).mockRejectedValue(new Error('test error'));

      const result = await fetchApiKeyQuota('zai', 'test-key');
      expect(result).toBeNull();
    });
  });
});
