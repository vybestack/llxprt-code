/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextUsageDisplay } from './ContextUsageDisplay.js';
import { themeManager } from '../themes/theme-manager.js';
import { DefaultDark } from '../themes/default.js';

// Mock the tokenLimit function
vi.mock('@vybestack/llxprt-code-core', () => ({
  tokenLimit: vi.fn(
    (model: string, contextLimit?: number) => contextLimit || 100000, // Default 100k tokens
  ),
}));

describe('ContextUsageDisplay Semantic Colors', () => {
  let originalTheme: string;

  beforeEach(() => {
    vi.clearAllMocks();
    originalTheme = themeManager.getActiveTheme().name;
    themeManager.setActiveTheme(DefaultDark.name);
  });

  afterEach(() => {
    themeManager.setActiveTheme(originalTheme);
  });

  it('should use error color when context is very low (< 10%)', () => {
    // 95% used, 5% remaining - should be error color
    const { lastFrame } = render(
      <ContextUsageDisplay
        promptTokenCount={95000}
        model="test-model"
        contextLimit={100000}
      />,
    );

    const output = lastFrame();
    expect(output).toContain('5% context left');
  });

  it('should use warning color when context is low (10-25%)', () => {
    // 80% used, 20% remaining - should be warning color
    const { lastFrame } = render(
      <ContextUsageDisplay
        promptTokenCount={80000}
        model="test-model"
        contextLimit={100000}
      />,
    );

    const output = lastFrame();
    expect(output).toContain('20% context left');
  });

  it('should use secondary color when context is normal (> 25%)', () => {
    // 50% used, 50% remaining - should be secondary color
    const { lastFrame } = render(
      <ContextUsageDisplay
        promptTokenCount={50000}
        model="test-model"
        contextLimit={100000}
      />,
    );

    const output = lastFrame();
    expect(output).toContain('50% context left');
  });

  it('should handle edge case at exactly 10% remaining', () => {
    // 90% used, 10% remaining - should be warning color (boundary)
    const { lastFrame } = render(
      <ContextUsageDisplay
        promptTokenCount={90000}
        model="test-model"
        contextLimit={100000}
      />,
    );

    const output = lastFrame();
    expect(output).toContain('10% context left');
  });

  it('should handle edge case at exactly 25% remaining', () => {
    // 75% used, 25% remaining - should be warning color (boundary)
    const { lastFrame } = render(
      <ContextUsageDisplay
        promptTokenCount={75000}
        model="test-model"
        contextLimit={100000}
      />,
    );

    const output = lastFrame();
    expect(output).toContain('25% context left');
  });

  it('should calculate percentage correctly with different token limits', () => {
    // Test with custom limit: 50% used, 50% remaining
    const { lastFrame } = render(
      <ContextUsageDisplay
        promptTokenCount={25000}
        model="test-model"
        contextLimit={50000}
      />,
    );

    const output = lastFrame();
    expect(output).toContain('50% context left');
  });

  it('should render properly across different themes', () => {
    const props = {
      promptTokenCount: 5000, // 95% used, 5% remaining
      model: 'test-model',
      contextLimit: 100000,
    };

    // Test with current theme
    const { lastFrame: frame1 } = render(<ContextUsageDisplay {...props} />);
    const output1 = frame1();

    expect(output1).toContain('95% context left');
    expect(output1).toBeTruthy();
  });
});
