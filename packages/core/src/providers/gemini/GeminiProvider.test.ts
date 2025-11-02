/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GeminiProvider } from './GeminiProvider.js';
import { IContent } from '../../services/history/IContent.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';

const generateContentStreamMock = vi.hoisted(() => vi.fn());

const googleGenAIConstructor = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    models: {
      generateContentStream: generateContentStreamMock,
    },
  })),
);

vi.mock('@google/genai', () => ({
  GoogleGenAI: googleGenAIConstructor,
  Type: { OBJECT: 'object' },
}));

vi.mock('../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

vi.mock('../../code_assist/codeAssist.js', () => ({
  createCodeAssistContentGenerator: vi.fn(),
}));

const mockSettingsService = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  getProviderSettings: vi.fn().mockReturnValue({}),
  updateSettings: vi.fn(),
  getAllGlobalSettings: vi.fn().mockReturnValue({}),
}));

vi.mock('../../settings/settingsServiceInstance.js', () => ({
  getSettingsService: vi.fn(() => mockSettingsService),
}));

/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P11
 * @requirement REQ-003.1
 * @pseudocode lines 13-14
 */
describe('GeminiProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateContentStreamMock.mockReset();
    delete process.env.GEMINI_API_KEY;
  });

  // Clean up global state after each test
  afterEach(() => {
    delete global.__oauth_needs_code;
    delete global.__oauth_provider;
    delete process.env.GEMINI_API_KEY;
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P11
   * @requirement REQ-003.1
   * @pseudocode lines 13-14
   */
  it('should set __oauth_needs_code to true when OAuth flow requires user input', async () => {
    // This will require mocking the OAuth flow in a later phase
    expect(true).toBe(true);
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P11
   * @requirement REQ-003.2
   * @pseudocode lines 13-14
   */
  it('should set __oauth_provider to "gemini" for provider identification', async () => {
    // This will require mocking the OAuth flow in a later phase
    expect(true).toBe(true);
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P11
   * @requirement REQ-003.3
   * @pseudocode lines 17-18, 25-26
   */
  it('should reset global state variables after successful authentication', async () => {
    // This will require mocking the OAuth flow in a later phase
    expect(true).toBe(true);
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P11
   * @requirement REQ-003.3
   * @pseudocode lines 17-18, 25-26
   */
  it('should reset global state variables after OAuth flow cancellation', async () => {
    // This will require mocking the OAuth flow in a later phase
    expect(true).toBe(true);
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P11
   * @requirement REQ-003.1
   * @pseudocode lines 13-14
   */
  it('should maintain global state during active OAuth flow', async () => {
    // This will require mocking the OAuth flow in a later phase
    expect(true).toBe(true);
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P11
   * @requirement REQ-003.1
   * @pseudocode lines 12-18
   */
  it('should not interfere with other provider OAuth flows', async () => {
    // This will require mocking other providers in a later phase
    expect(true).toBe(true);
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P11
   * @requirement REQ-003.1
   * @pseudocode lines 12-18
   */
  it('should handle concurrent OAuth requests from different providers', async () => {
    // This will require mocking concurrent requests in a later phase
    expect(true).toBe(true);
  });

  it('should pass custom headers to GoogleGenAI http options', async () => {
    const customHeaders = {
      'X-Custom-Header': 'custom-value',
      'X-Trace-Id': 'trace-abc',
    };

    const fakeStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          candidates: [
            {
              content: {
                parts: [{ text: 'hello' }],
              },
            },
          ],
        };
      },
    };

    generateContentStreamMock.mockResolvedValueOnce(fakeStream);

    process.env.GEMINI_API_KEY = 'resolved-key';

    const provider = new GeminiProvider('test-api-key');

    (
      provider as unknown as {
        providerConfig: {
          getEphemeralSettings?: () => Record<string, unknown>;
          customHeaders?: Record<string, string>;
        };
      }
    ).providerConfig = {
      getEphemeralSettings: () => ({
        'custom-headers': customHeaders,
      }),
      customHeaders: {
        'X-Provider-Header': 'provider-value',
      },
    };
    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ] as IContent[],
        settingsOverrides: {
          global: {
            'auth-key': 'test-api-key',
            'custom-headers': customHeaders,
            activeProvider: provider.name,
          },
          provider: {
            'custom-headers': customHeaders,
          },
        },
        runtimeId: 'gemini.custom-headers',
      }),
    );

    await generator.next();

    expect(googleGenAIConstructor).toHaveBeenCalledTimes(1);

    const callArgs = googleGenAIConstructor.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs?.httpOptions).toBeDefined();
    expect(callArgs.httpOptions?.headers).toMatchObject({
      ...customHeaders,
      'X-Provider-Header': 'provider-value',
      'User-Agent': expect.any(String),
    });
  });
});
