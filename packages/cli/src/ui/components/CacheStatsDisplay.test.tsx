/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CacheStatistics } from '@vybestack/llxprt-code-core';
import { CacheStatsDisplay } from './CacheStatsDisplay.js';
import * as RuntimeContext from '../contexts/RuntimeContext.js';

// Mock the RuntimeContext to provide controlled data for testing
vi.mock('../contexts/RuntimeContext.js', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeContext>();
  return {
    ...actual,
    useRuntimeApi: vi.fn(),
  };
});

const useRuntimeApiMock = vi.mocked(RuntimeContext.useRuntimeApi);

const renderWithMockedCacheStats = (cacheStats: CacheStatistics | null) => {
  const mockProviderManager = cacheStats
    ? {
        getCacheStatistics: vi.fn().mockReturnValue(cacheStats),
      }
    : null;

  useRuntimeApiMock.mockReturnValue({
    getCliProviderManager: vi.fn().mockReturnValue(mockProviderManager),
  } as unknown as ReturnType<typeof RuntimeContext.useRuntimeApi>);

  return render(<CacheStatsDisplay />);
};

describe('<CacheStatsDisplay />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render error message when provider manager is not available', () => {
    useRuntimeApiMock.mockReturnValue({
      getCliProviderManager: vi.fn().mockReturnValue(null),
    } as unknown as ReturnType<typeof RuntimeContext.useRuntimeApi>);

    const { lastFrame } = render(<CacheStatsDisplay />);

    expect(lastFrame()).toContain('Provider manager not available');
  });

  it('should render "no cache data" message when there are no cache reads or writes', () => {
    const { lastFrame } = renderWithMockedCacheStats({
      totalCacheReads: 0,
      totalCacheWrites: null as null, // No cache writes reported
      requestsWithCacheHits: 0,
      requestsWithCacheWrites: 0,
      hitRate: 0,
    } as CacheStatistics);

    const output = lastFrame();
    expect(output).toContain('No cache data available');
    expect(output).not.toMatch(/Anthropic only/i);
    expect(output).toContain('OpenAI');
    expect(output).toContain('Groq');
    expect(output).toContain('Deepseek');
    expect(output).toContain('Fireworks');
    expect(output).toContain('OpenRouter');
    expect(output).toContain('Qwen');
  });

  it('should display cache statistics when cache data is available', () => {
    const { lastFrame } = renderWithMockedCacheStats({
      totalCacheReads: 2000,
      totalCacheWrites: 500,
      requestsWithCacheHits: 3,
      requestsWithCacheWrites: 5,
      hitRate: 20.0,
    });

    const output = lastFrame();

    // Check for updated title
    expect(output).toContain('Cache Stats');
    expect(output).not.toContain('For Nerds');

    // Check for metric labels
    expect(output).toContain('Total Cache Reads');
    expect(output).toContain('Total Cache Writes');
    expect(output).toContain('Cache Hit Rate');
    expect(output).toContain('Requests with Cache Hits');

    // Verify removed metrics are not present
    expect(output).not.toContain('Token Savings');
    expect(output).not.toContain('Estimated Cost Savings');

    // Check for values (using regex to match any locale format)
    expect(output).toMatch(/2[,\s]?000/); // Cache reads
    expect(output).toMatch(/500/); // Cache writes
    expect(output).toMatch(/20\.0%/); // Hit rate
  });

  it('should handle multiple cache hits correctly', () => {
    const { lastFrame } = renderWithMockedCacheStats({
      totalCacheReads: 15000,
      totalCacheWrites: 3000,
      requestsWithCacheHits: 12,
      requestsWithCacheWrites: 15,
      hitRate: 45.5,
    });

    const output = lastFrame();
    expect(output).toContain('Total Cache Reads');
    expect(output).toMatch(/15[,\s]?000/); // Cache reads
    expect(output).toMatch(/45\.5%/); // Hit rate
    expect(output).not.toContain('Token Savings');
    expect(output).not.toContain('Estimated Cost Savings');
  });

  it('should display hit rate with proper formatting', () => {
    const { lastFrame } = renderWithMockedCacheStats({
      totalCacheReads: 5000,
      totalCacheWrites: 1000,
      requestsWithCacheHits: 8,
      requestsWithCacheWrites: 10,
      hitRate: 33.3,
    });

    const output = lastFrame();
    expect(output).toMatch(/33\.3%/);
  });

  it('should not display cost savings', () => {
    const { lastFrame } = renderWithMockedCacheStats({
      totalCacheReads: 10000,
      totalCacheWrites: 2000,
      requestsWithCacheHits: 5,
      requestsWithCacheWrites: 8,
      hitRate: 50.0,
    });

    const output = lastFrame();
    expect(output).not.toContain('Token Savings');
    expect(output).not.toContain('Estimated Cost Savings');
    expect(output).not.toMatch(/\$/);
  });

  it('should hide cache writes row when provider does not report it (null)', () => {
    const { lastFrame } = renderWithMockedCacheStats({
      totalCacheReads: 5000,
      totalCacheWrites: null as null, // Provider doesn't report cache writes (e.g., OpenAI/vLLM)
      requestsWithCacheHits: 3,
      requestsWithCacheWrites: 0,
      hitRate: 25.0,
    } as CacheStatistics);

    const output = lastFrame();
    // Should show cache reads
    expect(output).toContain('Total Cache Reads');
    expect(output).toMatch(/5[,\s]?000/);
    // Should NOT show cache writes when null
    expect(output).not.toContain('Total Cache Writes');
    // Should still show other stats
    expect(output).toContain('Cache Hit Rate');
    expect(output).toMatch(/25\.0%/);
  });

  it('should show cache writes row when provider reports it as zero', () => {
    const { lastFrame } = renderWithMockedCacheStats({
      totalCacheReads: 5000,
      totalCacheWrites: 0, // Provider explicitly reported 0 cache writes
      requestsWithCacheHits: 3,
      requestsWithCacheWrites: 0,
      hitRate: 25.0,
    });

    const output = lastFrame();
    // Should show cache writes when explicitly 0
    expect(output).toContain('Total Cache Writes');
  });
});
