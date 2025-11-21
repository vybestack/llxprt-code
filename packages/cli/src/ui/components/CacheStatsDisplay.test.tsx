/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheStatsDisplay } from './CacheStatsDisplay.js';
import * as RuntimeContext from '../contexts/RuntimeContext.js';
import type { CacheStatistics } from './CacheStatsDisplay.js';

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
      totalCacheWrites: 0,
      requestsWithCacheHits: 0,
      requestsWithCacheWrites: 0,
      hitRate: 0,
    });

    expect(lastFrame()).toContain('No cache data available');
    expect(lastFrame()).toContain('Anthropic');
    expect(lastFrame()).toContain('prompt caching');
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
    expect(output).toContain('Token Savings');
    expect(output).toContain('Estimated Cost Savings');
    expect(output).toContain('Requests with Cache Hits');

    // Check for values (using regex to match any locale format)
    expect(output).toMatch(/2[,\s]?000/); // Cache reads
    expect(output).toMatch(/500/); // Cache writes
    expect(output).toMatch(/20\.0%/); // Hit rate
    expect(output).toMatch(/1[,\s]?800/); // Token savings (90% of 2000)
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
    expect(output).toMatch(/13[,\s]?500/); // Token savings (90% of 15000)
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

  it('should calculate cost savings correctly', () => {
    const { lastFrame } = renderWithMockedCacheStats({
      totalCacheReads: 10000,
      totalCacheWrites: 2000,
      requestsWithCacheHits: 5,
      requestsWithCacheWrites: 8,
      hitRate: 50.0,
    });

    const output = lastFrame();
    // Token savings: 10000 * 0.9 = 9000
    // Cost savings: (9000 / 1000) * 0.003 * 0.9 = $0.0243
    expect(output).toMatch(/\$0\.024[0-9]/);
  });
});
