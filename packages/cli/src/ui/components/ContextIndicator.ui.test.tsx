/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest';
import { Footer } from './Footer.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { ProviderManager, IProvider } from '@vybestack/llxprt-code-core';

// Mock the hooks
vi.mock('../hooks/useResponsive.js', () => ({
  useResponsive: vi.fn(() => ({ breakpoint: 'NARROW' })),
}));

// Mock the provider manager
vi.mock('../../providers/providerManagerInstance.js', () => ({
  getProviderManager: vi.fn(),
}));

describe('ContextIndicator UI', () => {
  let mockProviderManager: ProviderManager;

  beforeEach(() => {
    // Create a real ProviderManager instance and mock its methods
    mockProviderManager = new ProviderManager();

    // Mock the methods we need
    vi.spyOn(mockProviderManager, 'hasActiveProvider').mockReturnValue(true);
    vi.spyOn(mockProviderManager, 'getActiveProvider').mockReturnValue({
      name: 'openai',
    } as unknown as IProvider);

    (
      vi.mocked(getProviderManager) as MockedFunction<typeof getProviderManager>
    ).mockReturnValue(mockProviderManager);
  });

  it('should display context percentage without remote tokens', () => {
    const { lastFrame } = render(
      <Footer
        model="gpt-4o"
        targetDir="/test/dir"
        debugMode={false}
        debugMessage=""
        errorCount={0}
        showErrorDetails={false}
        historyTokenCount={1000}
        nightly={false}
      />,
    );

    // Should show context in new format: Ctx: 1.0k/128k
    expect(lastFrame()).toContain('Ctx: 1.0k/128k');
  });

  it('should display context percentage when using OpenAI', () => {
    const { lastFrame } = render(
      <Footer
        model="gpt-4o"
        targetDir="/test/dir"
        debugMode={false}
        debugMessage=""
        errorCount={0}
        showErrorDetails={false}
        historyTokenCount={1000}
        nightly={false}
      />,
    );

    // Should show context in new format: Ctx: 1.0k/128k
    expect(lastFrame()).toContain('Ctx: 1.0k/128k');
  });

  it('should handle high token usage', () => {
    const { lastFrame } = render(
      <Footer
        model="gpt-4o"
        targetDir="/test/dir"
        debugMode={false}
        debugMessage=""
        errorCount={0}
        showErrorDetails={false}
        historyTokenCount={120000}
        nightly={false}
      />,
    );

    // Should show context with high usage: Ctx: 120.0k/128k
    expect(lastFrame()).toContain('Ctx: 120.0k/128k');
  });

  it('should fallback to local calculation', () => {
    const { lastFrame } = render(
      <Footer
        model="gpt-4o"
        targetDir="/test/dir"
        debugMode={false}
        debugMessage=""
        errorCount={0}
        showErrorDetails={false}
        historyTokenCount={1000}
        nightly={false}
      />,
    );

    // Should show local calculation in new format
    expect(lastFrame()).toContain('Ctx: 1.0k/128k');
  });

  it('should handle non-OpenAI providers', () => {
    // Mock a non-OpenAI provider
    vi.mocked(mockProviderManager.getActiveProvider).mockReturnValue({
      name: 'anthropic',
    } as unknown as IProvider);

    const { lastFrame } = render(
      <Footer
        model="claude-3-opus"
        targetDir="/test/dir"
        debugMode={false}
        debugMessage=""
        errorCount={0}
        showErrorDetails={false}
        historyTokenCount={1000}
        nightly={false}
      />,
    );

    // Should use local calculation for non-OpenAI providers in new format
    expect(lastFrame()).toContain('Ctx: 1.0k/1049k');
  });

  it('should handle missing conversation context', () => {
    const { lastFrame } = render(
      <Footer
        model="gpt-4o"
        targetDir="/test/dir"
        debugMode={false}
        debugMessage=""
        errorCount={0}
        showErrorDetails={false}
        historyTokenCount={1000}
        nightly={false}
        // No conversationId or parentId
      />,
    );

    // Should display context normally
    expect(lastFrame()).toContain('Ctx: 1.0k/128k');
  });
});
