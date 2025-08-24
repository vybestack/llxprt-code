/**
 * Simple OAuth integration test to debug the issue
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../providers/openai/OpenAIProvider.js';
import { OAuthManager } from '../auth/precedence.js';
import { TEST_PROVIDER_CONFIG } from '../providers/test-utils/providerTestConfig.js';
import { isQwenEndpoint } from '../config/endpoints.js';

// Skip OAuth tests in CI as they require browser interaction
const skipInCI = process.env.CI === 'true';

describe.skipIf(skipInCI)('Simple OAuth Integration Test', () => {
  let mockOAuthManager: OAuthManager;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };

    // Clear environment variables
    delete process.env.OPENAI_API_KEY;

    mockOAuthManager = {
      getToken: vi.fn(),
      isAuthenticated: vi.fn(),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should verify endpoint validation first', () => {
    const qwenEndpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const openaiEndpoint = 'https://api.openai.com/v1';

    const isQwenResult = isQwenEndpoint(qwenEndpoint);
    const isOpenAIResult = isQwenEndpoint(openaiEndpoint);

    // These should pass if endpoint validation is working
    expect(isQwenResult).toBe(true);
    expect(isOpenAIResult).toBe(false);
  });

  it('should test OAuth manager setup', async () => {
    vi.mocked(mockOAuthManager.getToken).mockResolvedValue('test-token');

    const qwenEndpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

    // Create provider with explicit parameters
    const _provider = new OpenAIProvider(
      '', // No API key
      qwenEndpoint, // Qwen endpoint
      TEST_PROVIDER_CONFIG,
      mockOAuthManager, // OAuth manager
    );

    // Call the getToken method to see if it's working
    const token = await mockOAuthManager.getToken('qwen');
    expect(token).toBe('test-token');
  });

  it('should test provider with API key precedence', async () => {
    const apiKey = 'test-api-key';
    vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token');

    const provider = new OpenAIProvider(
      apiKey, // API key present - should take precedence
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      TEST_PROVIDER_CONFIG,
      mockOAuthManager,
    );

    const isAuth = await provider.isAuthenticated();
    expect(isAuth).toBe(true);

    // OAuth should not be called when API key exists
    expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
  });

  it('should test provider with environment variable', async () => {
    process.env.OPENAI_API_KEY = 'env-api-key';
    vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token');

    const provider = new OpenAIProvider(
      '', // No CLI key
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      TEST_PROVIDER_CONFIG,
      mockOAuthManager,
    );

    const isAuth = await provider.isAuthenticated();
    expect(isAuth).toBe(true);

    // OAuth should not be called when env var exists
    expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
  });

  it('should debug OAuth configuration step by step', async () => {
    // Ensure no other auth methods are available
    delete process.env.OPENAI_API_KEY;

    vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token');

    const provider = new OpenAIProvider(
      '', // No CLI key
      'https://dashscope.aliyuncs.com/compatible-mode/v1', // Qwen endpoint
      TEST_PROVIDER_CONFIG,
      mockOAuthManager, // OAuth manager provided
    );

    // Step 1: Check OAuth availability methods
    const hasNonOAuth = await provider.hasNonOAuthAuthentication();
    const isOAuthOnly = await provider.isOAuthOnlyAvailable();

    // These should be false and true respectively if OAuth is the only method
    expect(hasNonOAuth).toBe(false); // No other auth methods
    expect(isOAuthOnly).toBe(true); // OAuth is only method available

    // Step 2: Try authentication - this should work if OAuth is properly configured
    const isAuth = await provider.isAuthenticated();

    // Step 3: If auth fails, let's see what happened
    if (!isAuth) {
      const callCount = vi.mocked(mockOAuthManager.getToken).mock.calls.length;
      throw new Error(
        `OAuth authentication failed. getToken called ${callCount} times. Expected: 1`,
      );
    }

    expect(isAuth).toBe(true);
    expect(mockOAuthManager.getToken).toHaveBeenCalledWith('qwen');
  });
});
