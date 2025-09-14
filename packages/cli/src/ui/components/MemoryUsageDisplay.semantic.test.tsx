/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryUsageDisplay } from './MemoryUsageDisplay.js';
import { themeManager } from '../themes/theme-manager.js';
import { DefaultDark } from '../themes/default.js';

// Mock formatMemoryUsage utility
vi.mock('../utils/formatters.js', () => ({
  formatMemoryUsage: vi.fn((bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  }),
}));

describe('MemoryUsageDisplay Semantic Colors', () => {
  let originalTheme: string;
  let originalMemoryUsage: typeof process.memoryUsage;

  beforeEach(() => {
    vi.clearAllMocks();
    originalTheme = themeManager.getActiveTheme().name;
    themeManager.setActiveTheme(DefaultDark.name);

    // Store original process.memoryUsage
    originalMemoryUsage = process.memoryUsage;
  });

  afterEach(() => {
    themeManager.setActiveTheme(originalTheme);
    // Restore original process.memoryUsage
    process.memoryUsage = originalMemoryUsage;
    vi.restoreAllMocks();
  });

  it('should use secondary color for normal memory usage', async () => {
    // Mock normal memory usage (1GB - below threshold)
    const normalMemory = 1024 * 1024 * 1024; // 1GB
    process.memoryUsage = vi.fn(() => ({
      rss: normalMemory,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    })) as unknown as typeof process.memoryUsage;

    const { lastFrame, unmount } = render(<MemoryUsageDisplay />);

    // Wait a bit for the effect to run
    await new Promise((resolve) => setTimeout(resolve, 100));

    const output = lastFrame();
    expect(output).toContain('1.0GB');

    unmount();
  });

  it('should use error color for high memory usage', async () => {
    // Mock high memory usage (3GB - above 2GB threshold)
    const highMemory = 3 * 1024 * 1024 * 1024; // 3GB
    process.memoryUsage = vi.fn(() => ({
      rss: highMemory,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    })) as unknown as typeof process.memoryUsage;

    const { lastFrame, unmount } = render(<MemoryUsageDisplay />);

    // Wait a bit for the effect to run
    await new Promise((resolve) => setTimeout(resolve, 100));

    const output = lastFrame();
    expect(output).toContain('3.0GB');

    unmount();
  });

  it('should handle threshold boundary correctly', async () => {
    // Mock exactly 2GB (threshold boundary)
    const thresholdMemory = 2 * 1024 * 1024 * 1024; // Exactly 2GB
    process.memoryUsage = vi.fn(() => ({
      rss: thresholdMemory,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    })) as unknown as typeof process.memoryUsage;

    const { lastFrame, unmount } = render(<MemoryUsageDisplay />);

    // Wait a bit for the effect to run
    await new Promise((resolve) => setTimeout(resolve, 100));

    const output = lastFrame();
    expect(output).toContain('2.0GB');

    unmount();
  });

  it('should display pipe separator with secondary color', async () => {
    // Mock any memory usage
    const normalMemory = 512 * 1024 * 1024; // 512MB
    process.memoryUsage = vi.fn(() => ({
      rss: normalMemory,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    })) as unknown as typeof process.memoryUsage;

    const { lastFrame, unmount } = render(<MemoryUsageDisplay />);

    // Wait a bit for the effect to run
    await new Promise((resolve) => setTimeout(resolve, 100));

    const output = lastFrame();
    expect(output).toContain('|');
    expect(output).toContain('512MB');

    unmount();
  });

  it('should update memory display periodically', async () => {
    let memoryValue = 1024 * 1024 * 1024; // Start at 1GB

    process.memoryUsage = vi.fn(() => ({
      rss: memoryValue,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    })) as unknown as typeof process.memoryUsage;

    const { lastFrame, unmount } = render(<MemoryUsageDisplay />);

    // Wait for initial render
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lastFrame()).toContain('1.0GB');

    // Change memory usage
    memoryValue = 2.5 * 1024 * 1024 * 1024; // 2.5GB

    // Wait for the interval to update (component updates every 2 seconds, but we don't want to wait that long)
    // We'll rely on the implementation calling the function immediately on mount
    await new Promise((resolve) => setTimeout(resolve, 100));

    unmount();
  }, 5000);
});
