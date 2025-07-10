import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest';
import { Footer } from './Footer.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { OpenAIProvider } from '../../providers/openai/OpenAIProvider.js';
import { ProviderManager } from '../../providers/ProviderManager.js';
import { IProvider } from '../../providers/IProvider.js';

// Mock the provider manager
vi.mock('../../providers/providerManagerInstance.js', () => ({
  getProviderManager: vi.fn(),
}));

describe('ContextIndicator UI', () => {
  let mockProvider: {
    estimateContextUsage: MockedFunction<
      typeof OpenAIProvider.prototype.estimateContextUsage
    >;
  };
  let mockProviderManager: ProviderManager;

  beforeEach(() => {
    // Create mock OpenAI provider
    mockProvider = {
      estimateContextUsage: vi.fn(),
    };

    // Make it an instance of OpenAIProvider for instanceof check
    Object.setPrototypeOf(mockProvider, OpenAIProvider.prototype);

    // Create a real ProviderManager instance and mock its methods
    mockProviderManager = new ProviderManager();

    // Mock the methods we need
    vi.spyOn(mockProviderManager, 'hasActiveProvider').mockReturnValue(true);
    vi.spyOn(mockProviderManager, 'getActiveProvider').mockReturnValue(
      mockProvider as unknown as IProvider,
    );

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
        corgiMode={false}
        errorCount={0}
        showErrorDetails={false}
        promptTokenCount={1000}
      />,
    );

    // Should show context percentage
    // 1500 tokens out of 128000 = ~98.8% left
    expect(lastFrame()).toContain('99% context left');
  });

  it('should display remote token indicator when using OpenAI with context', () => {
    // Mock the context estimation
    mockProvider.estimateContextUsage.mockReturnValue({
      totalTokens: 52000,
      remoteTokens: 50000,
      promptTokens: 2000,
      maxTokens: 128000,
      contextUsedPercent: 40.625,
      tokensRemaining: 76000,
    });

    const { lastFrame } = render(
      <Footer
        model="gpt-4o"
        targetDir="/test/dir"
        debugMode={false}
        debugMessage=""
        corgiMode={false}
        errorCount={0}
        showErrorDetails={false}
        promptTokenCount={1000}
      />,
    );

    // Should show remote-aware percentage and remote token count
    expect(lastFrame()).toContain('59% context left [50k remote]');
  });

  it('should handle high remote token usage', () => {
    // Mock near-limit context usage
    mockProvider.estimateContextUsage.mockReturnValue({
      totalTokens: 120000,
      remoteTokens: 115000,
      promptTokens: 5000,
      maxTokens: 128000,
      contextUsedPercent: 93.75,
      tokensRemaining: 8000,
    });

    const { lastFrame } = render(
      <Footer
        model="gpt-4o"
        targetDir="/test/dir"
        debugMode={false}
        debugMessage=""
        corgiMode={false}
        errorCount={0}
        showErrorDetails={false}
        promptTokenCount={1000}
      />,
    );

    // Should show low percentage remaining with high remote usage
    expect(lastFrame()).toContain('6% context left [115k remote]');
  });

  it('should fallback to local calculation on error', () => {
    // Make estimateContextUsage throw an error
    mockProvider.estimateContextUsage.mockImplementation(() => {
      throw new Error('API error');
    });

    const { lastFrame } = render(
      <Footer
        model="gpt-4o"
        targetDir="/test/dir"
        debugMode={false}
        debugMessage=""
        corgiMode={false}
        errorCount={0}
        showErrorDetails={false}
        promptTokenCount={1000}
      />,
    );

    // Should fallback to local calculation
    expect(lastFrame()).toContain('99% context left');
    expect(lastFrame()).not.toContain('remote');
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
        corgiMode={false}
        errorCount={0}
        showErrorDetails={false}
        promptTokenCount={1000}
      />,
    );

    // Should use local calculation for non-OpenAI providers
    expect(lastFrame()).toContain('context left');
    expect(lastFrame()).not.toContain('remote');
  });

  it('should handle missing conversation context', () => {
    const { lastFrame } = render(
      <Footer
        model="gpt-4o"
        targetDir="/test/dir"
        debugMode={false}
        debugMessage=""
        corgiMode={false}
        errorCount={0}
        showErrorDetails={false}
        promptTokenCount={1000}
        // No conversationId or parentId
      />,
    );

    // Should not attempt to get remote context
    expect(mockProvider.estimateContextUsage).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('99% context left');
    expect(lastFrame()).not.toContain('remote');
  });
});
