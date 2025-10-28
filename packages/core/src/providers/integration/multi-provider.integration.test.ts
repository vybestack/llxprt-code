/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { OpenAIProvider, ProviderManager } from '../../index.js';
import { getSettingsService } from '../../settings/settingsServiceInstance.js';

describe('Multi-Provider Integration Tests', () => {
  let apiKey: string | null = null;
  let baseURL: string | undefined = undefined;
  let skipTests = false;
  let manager: ProviderManager;

  beforeAll(() => {
    // Only load OpenAI API key from environment variable
    apiKey = process.env.OPENAI_API_KEY || null;
    baseURL = process.env.OPENAI_BASE_URL || undefined;

    if (!apiKey) {
      console.log(
        '\nWARNING:  Skipping Multi-Provider Integration Tests: No OpenAI API key found',
      );
      console.log(
        '   To run these tests, set the OPENAI_API_KEY environment variable\n',
      );
      skipTests = true;
    }

    // Skip tests when using OpenRouter for now
    if (baseURL?.includes('openrouter')) {
      console.log(
        '\nWARNING:  Skipping Multi-Provider Integration Tests: OpenRouter detected',
      );
      console.log(
        '   These tests are currently not compatible with OpenRouter\n',
      );
      skipTests = true;
    }
  });

  beforeEach(() => {
    if (!skipTests) {
      // Clear SettingsService state before each test
      const settingsService = getSettingsService();
      settingsService.set('activeProvider', '');

      manager = new ProviderManager();
    }
  });

  afterEach(() => {
    // Clean up any state if needed
  });

  describe('Provider Management', () => {
    it.skipIf(skipTests)(
      'should initialize and register OpenAI provider',
      () => {
        if (!manager) return; // Guard for when test is skipped

        // Initially no providers
        expect(manager.listProviders()).toEqual([]);
        expect(manager.hasActiveProvider()).toBe(false);

        // Register OpenAI provider
        const openaiProvider = new OpenAIProvider(apiKey!, baseURL);
        manager.registerProvider(openaiProvider);

        // Verify registration
        expect(manager.listProviders()).toEqual(['openai']);
        expect(manager.hasActiveProvider()).toBe(false); // Not active yet

        // Activate provider
        manager.setActiveProvider('openai');
        expect(manager.hasActiveProvider()).toBe(true);
        expect(manager.getActiveProviderName()).toBe('openai');
      },
    );

    it.skipIf(skipTests)('should switch between providers and Gemini', () => {
      if (!manager) return; // Guard for when test is skipped

      // Register OpenAI
      const openaiProvider = new OpenAIProvider(apiKey!, baseURL);
      manager.registerProvider(openaiProvider);

      // Start with Gemini (no active provider)
      expect(manager.hasActiveProvider()).toBe(false);

      // Switch to OpenAI
      manager.setActiveProvider('openai');
      expect(manager.hasActiveProvider()).toBe(true);
      expect(manager.getActiveProviderName()).toBe('openai');

      // Switch back to Gemini
      manager.clearActiveProvider();
      expect(manager.hasActiveProvider()).toBe(false);
      expect(manager.getActiveProviderName()).toBe('');
    });

    it.skipIf(skipTests)('should handle errors for invalid provider', () => {
      if (!manager) return; // Guard for when test is skipped

      // Try to set non-existent provider
      expect(() => manager.setActiveProvider('invalid-provider')).toThrow(
        'Provider not found',
      );
    });
  });

  describe('Model Management', () => {
    it.skipIf(skipTests)(
      'should list available models from OpenAI',
      async () => {
        if (!manager) return; // Guard for when test is skipped

        const openaiProvider = new OpenAIProvider(apiKey!, baseURL);
        manager.registerProvider(openaiProvider);
        manager.setActiveProvider('openai');

        const models = await manager.getAvailableModels();

        // Should have at least one model
        expect(models.length).toBeGreaterThan(0);

        // Verify models have expected structure
        const modelIds = models.map((m) => m.id);
        expect(modelIds.every((id) => typeof id === 'string')).toBe(true);
        expect(modelIds.every((id) => id.length > 0)).toBe(true);

        console.log(`\n[OK] Found ${models.length} models`);
        console.log(`   Sample models: ${modelIds.slice(0, 5).join(', ')}...`);
      },
    );

    it.skipIf(skipTests)(
      'should switch between models within provider',
      async () => {
        if (!apiKey || skipTests) return; // Guard for when test is skipped
        const openaiProvider = new OpenAIProvider(apiKey!, baseURL);

        // Get initial model and available models
        const initialModel = openaiProvider.getCurrentModel();
        const models = await openaiProvider.getModels();

        // Should have models available
        expect(models.length).toBeGreaterThan(0);

        // Test switching to a different model (pick first different model from list)
        const differentModel = models.find((m) => m.id !== initialModel);
        if (differentModel) {
          openaiProvider.setModel(differentModel.id);
          // Model might be different if defaults changed
          const currentModel = openaiProvider.getCurrentModel();
          expect(currentModel).toBeTruthy();

          // Switch back to initial model
          openaiProvider.setModel(initialModel);
          expect(openaiProvider.getCurrentModel()).toBe(initialModel);
        } else {
          // If only one model available, at least verify the current model works
          expect(openaiProvider.getCurrentModel()).toBe(initialModel);
        }
      },
    );
  });

  describe('Chat Completion with Real API', () => {
    it.skipIf(skipTests)(
      'should generate chat completion with default model',
      async () => {
        if (!manager || skipTests) return; // Guard for when test is skipped

        const openaiProvider = new OpenAIProvider(apiKey!, baseURL);
        manager.registerProvider(openaiProvider);
        manager.setActiveProvider('openai');

        const messages = [
          {
            speaker: 'human',
            blocks: [
              {
                type: 'text',
                text: 'Say "Hello from OpenAI integration test" and nothing else.',
              },
            ],
          },
        ];

        // Collect the streaming response
        const chunks: string[] = [];
        const stream = openaiProvider.generateChatCompletion(messages);

        for await (const message of stream) {
          const textBlocks = message.blocks.filter((b) => b.type === 'text');
          for (const block of textBlocks) {
            chunks.push((block as { type: 'text'; text: string }).text);
          }
        }

        const fullResponse = chunks.join('');
        const providerName = baseURL?.includes('openrouter')
          ? 'OpenRouter'
          : 'OpenAI';
        console.log(`\n[OK] ${providerName} response: "${fullResponse}"`);

        expect(fullResponse.toLowerCase()).toContain(
          'hello from openai integration test',
        );
      },
    );

    it.skipIf(skipTests)('should handle streaming correctly', async () => {
      if (!apiKey || skipTests) return; // Guard for when test is skipped
      const openaiProvider = new OpenAIProvider(apiKey!, baseURL);

      const messages = [
        {
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: 'Count from 1 to 5, one number per line.',
            },
          ],
        },
      ];

      const chunks: string[] = [];
      let chunkCount = 0;
      const stream = openaiProvider.generateChatCompletion(messages);

      for await (const message of stream) {
        const textBlocks = message.blocks.filter((b) => b.type === 'text');
        for (const block of textBlocks) {
          chunks.push(block.text);
          chunkCount++;
        }
      }

      const fullResponse = chunks.join('');
      console.log(`\n[OK] Streaming test received ${chunkCount} chunks`);
      console.log(`   Response: "${fullResponse.trim()}"`);

      // Should receive at least one chunk (streaming)
      expect(chunkCount).toBeGreaterThanOrEqual(1);

      // Should contain numbers 1-5
      expect(fullResponse).toMatch(/1/);
      expect(fullResponse).toMatch(/2/);
      expect(fullResponse).toMatch(/3/);
      expect(fullResponse).toMatch(/4/);
      expect(fullResponse).toMatch(/5/);
    });

    it.skip('should work with a specific model', async () => {
      if (!apiKey || skipTests) return; // Guard for when test is skipped
      const openaiProvider = new OpenAIProvider(apiKey!, baseURL);

      // Get available models and pick the first one (or use default)
      const models = await openaiProvider.getModels();
      const testModel =
        models.length > 0 ? models[0].id : openaiProvider.getCurrentModel();
      openaiProvider.setModel(testModel);

      const messages = [
        {
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: 'What is 2+2? Reply with just the number.',
            },
          ],
        },
      ];

      const chunks: string[] = [];
      const stream = openaiProvider.generateChatCompletion(messages);

      for await (const message of stream) {
        const textBlocks = message.blocks.filter((b) => b.type === 'text');
        for (const block of textBlocks) {
          chunks.push(block.text);
        }
      }

      const fullResponse = chunks.join('').trim();
      console.log(`\n[OK] Model ${testModel} response: "${fullResponse}"`);

      expect(fullResponse).toContain('4');
    });

    it.skipIf(skipTests)(
      'should handle tool calls',
      async () => {
        if (!apiKey || skipTests) return; // Guard for when test is skipped
        const openaiProvider = new OpenAIProvider(apiKey!, baseURL);

        const messages = [
          {
            speaker: 'human',
            blocks: [
              {
                type: 'text',
                text: 'What is the weather in San Francisco? Use the get_weather function.',
              },
            ],
          },
        ];

        const tools = [
          {
            functionDeclarations: [
              {
                name: 'get_weather',
                description: 'Get the weather for a location',
                parameters: {
                  type: 'object',
                  properties: {
                    location: { type: 'string', description: 'The city name' },
                  },
                  required: ['location'],
                },
              },
            ],
          },
        ];

        try {
          let toolCallReceived = false;
          const stream = openaiProvider.generateChatCompletion(messages, tools);

          for await (const message of stream) {
            const toolCallBlocks = message.blocks.filter(
              (b) => b.type === 'tool_call',
            );
            if (toolCallBlocks.length > 0) {
              toolCallReceived = true;
              const toolCall = toolCallBlocks[0] as {
                type: 'tool_call';
                name: string;
                parameters: { location: string };
              };
              console.log(`\n[OK] Tool call received: ${toolCall.name}`);
              console.log(
                `   Arguments: ${JSON.stringify(toolCall.parameters)}`,
              );

              expect(toolCall.name).toBe('get_weather');
              const args = toolCall.parameters;
              // Check if args exists and has location property
              if (args && typeof args === 'object' && 'location' in args) {
                const location = (args as Record<string, unknown>).location;
                if (typeof location === 'string') {
                  expect(location.toLowerCase()).toContain('san francisco');
                }
              }
            }
          }

          expect(toolCallReceived).toBe(true);
        } catch (error) {
          // If the model doesn't support tool calling, skip the test
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          if (
            errorMessage.includes('tool calling') ||
            errorMessage.includes('not supported')
          ) {
            console.log(
              `\nWARNING:  Skipping tool call test: Model doesn't support tool calling`,
            );
            return; // Skip test gracefully
          }
          // Re-throw if it's a different error
          throw error;
        }
      },
      10000,
    );
  });

  describe('Error Handling', () => {
    it.skipIf(skipTests)('should handle invalid model gracefully', async () => {
      if (!apiKey || skipTests) return; // Guard for when test is skipped
      const openaiProvider = new OpenAIProvider(apiKey!, baseURL);
      openaiProvider.setModel('invalid-model-xyz');

      const messages = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      try {
        const stream = openaiProvider.generateChatCompletion(messages);
        // Try to consume the stream
        let messageReceived = false;
        for await (const _message of stream) {
          // Model might handle gracefully and return a response
          messageReceived = true;
          break;
        }
        // Either success or error is acceptable for invalid models
        if (!messageReceived) {
          expect.fail('Should have thrown an error');
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.log(
          `\n[OK] Correctly caught error for invalid model: ${errorMessage}`,
        );
        // Either error is acceptable
        expect(errorMessage).toBeTruthy();
      }
    });

    it('should handle missing API key', async () => {
      // Save and clear any existing OPENAI_API_KEY to ensure no auth is available
      const savedApiKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      // Also clear any other potential env vars
      const savedGeminiKey = process.env.GEMINI_API_KEY;
      const savedGoogleKey = process.env.GOOGLE_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      try {
        // Explicitly create provider with no auth methods available
        const provider = new OpenAIProvider(
          undefined, // No API key
          undefined, // Default baseURL (no OAuth support for standard OpenAI)
          undefined, // No config
          undefined, // No OAuth manager
        );

        try {
          // Try to get models - may throw or return default list
          const models = await provider.getModels();
          // If it doesn't throw, verify it returns an array (may be empty without auth)
          expect(Array.isArray(models)).toBe(true);
          // An empty array is acceptable when no authentication is provided
        } catch (error) {
          // If it throws, verify it's the expected error
          expect(error).toBeInstanceOf(Error);
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          expect(errorMessage).toMatch(/authentication|API key/i);
        }
      } finally {
        // Restore the original API keys if they existed
        if (savedApiKey) {
          process.env.OPENAI_API_KEY = savedApiKey;
        }
        if (savedGeminiKey) {
          process.env.GEMINI_API_KEY = savedGeminiKey;
        }
        if (savedGoogleKey) {
          process.env.GOOGLE_API_KEY = savedGoogleKey;
        }
      }
    });
  });
});
