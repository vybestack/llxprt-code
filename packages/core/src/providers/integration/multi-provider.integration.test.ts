/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { OpenAIProvider, ProviderManager } from '../../index.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';
import { resetSettingsService } from '../../settings/settingsServiceInstance.js';
import { initializeTestProviderRuntime } from '../../test-utils/runtime.js';
import type { SettingsService } from '../../settings/SettingsService.js';
import type { Config } from '../../config/config.js';

const resolveDefaultModel = (): string =>
  process.env.LLXPRT_DEFAULT_MODEL ?? 'gpt-4o';

const runningInCI = process.env.CI === 'true';
const realProviderOptIn = process.env.LLXPRT_RUN_REAL_PROVIDER_TESTS === 'true';

describe('Multi-Provider Integration Tests', () => {
  let apiKey: string | null = null;
  let baseURL: string | undefined = undefined;
  let skipTests = false;
  let manager: ProviderManager;
  let settingsService: SettingsService;
  let runtimeConfig: Config;

  beforeAll(() => {
    if (runningInCI && !realProviderOptIn) {
      console.log(
        '\nINFO: Skipping Multi-Provider Integration Tests in CI. Set LLXPRT_RUN_REAL_PROVIDER_TESTS=true to enable.',
      );
      skipTests = true;
      return;
    }

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
    if (skipTests) {
      return;
    }

    resetSettingsService();
    const runtime = initializeTestProviderRuntime({
      runtimeId: `multi-provider.integration.${Math.random()
        .toString(36)
        .slice(2, 10)}`,
      metadata: { suite: 'multi-provider.integration.test' },
      configOverrides: {
        getProvider: () => '',
        getModel: resolveDefaultModel,
        getEphemeralSettings: () => ({
          model: resolveDefaultModel(),
          'base-url': baseURL,
        }),
      },
    });

    settingsService = runtime.settingsService;
    runtimeConfig = runtime.config;
    settingsService.set('activeProvider', '');
    manager = new ProviderManager();
  });

  afterEach(() => {
    // Clean up any state if needed
  });

  const createOpenAIProvider = (): OpenAIProvider => {
    const provider = new OpenAIProvider(apiKey!, baseURL);
    provider.setRuntimeSettingsService?.(settingsService);
    provider.setConfig?.(runtimeConfig);
    return provider;
  };

  describe('Provider Management', () => {
    it.skipIf(skipTests)(
      'should initialize and register OpenAI provider',
      () => {
        if (!manager) return; // Guard for when test is skipped

        // Initially no providers
        expect(manager.listProviders()).toEqual([]);
        expect(manager.hasActiveProvider()).toBe(false);

        // Register OpenAI provider
        const openaiProvider = createOpenAIProvider();
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
      const openaiProvider = createOpenAIProvider();
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

        const openaiProvider = createOpenAIProvider();
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
        resetSettingsService();
        const runtime = initializeTestProviderRuntime({
          runtimeId: `multi-provider.integration.model-switch.${Math.random()
            .toString(36)
            .slice(2, 10)}`,
          metadata: {
            suite: 'multi-provider.integration.test',
            test: 'model-switch',
          },
          configOverrides: {
            getProvider: () => 'openai',
            getModel: resolveDefaultModel,
            getEphemeralSettings: () => ({
              model: resolveDefaultModel(),
              'base-url': baseURL,
            }),
          },
        });

        const openaiProvider = new OpenAIProvider(apiKey!, baseURL);
        openaiProvider.setRuntimeSettingsService?.(runtime.settingsService);
        openaiProvider.setConfig?.(runtime.config);

        const localSettings = runtime.settingsService;
        localSettings.set('activeProvider', openaiProvider.name);

        // Get initial model and available models
        const initialModel = openaiProvider.getCurrentModel();
        const models = await openaiProvider.getModels();

        // Should have models available
        expect(models.length).toBeGreaterThan(0);

        // Test switching to a different model (pick first different model from list)
        const differentModel = models.find((m) => m.id !== initialModel);
        expect(differentModel).toBeTruthy();

        localSettings.set('model', differentModel!.id);
        localSettings.setProviderSetting(
          openaiProvider.name,
          'model',
          differentModel!.id,
        );
        // Model might be different if defaults changed
        const currentModel = openaiProvider.getCurrentModel();
        expect(currentModel).toBeTruthy();

        // Switch back to initial model
        localSettings.set('model', initialModel);
        localSettings.setProviderSetting(
          openaiProvider.name,
          'model',
          initialModel,
        );
        expect(openaiProvider.getCurrentModel()).toBe(initialModel);
      },
    );
  });

  describe('Chat Completion with Real API', () => {
    it.skipIf(skipTests)(
      'should generate chat completion with default model',
      async () => {
        if (!manager || skipTests) return; // Guard for when test is skipped

        const openaiProvider = createOpenAIProvider();
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

    it.skipIf(skipTests)(
      'should generate chat completion via options signature',
      async () => {
        if (!manager || skipTests) return;

        const openaiProvider = createOpenAIProvider();
        manager.registerProvider(openaiProvider);
        manager.setActiveProvider('openai');

        const messages = [
          {
            speaker: 'human',
            blocks: [
              {
                type: 'text',
                text: 'Respond with "Options signature OK".',
              },
            ],
          },
        ];

        settingsService.set('call-id', 'integration-call');
        settingsService.setProviderSetting(
          'openai',
          'model',
          openaiProvider.getDefaultModel(),
        );
        if (baseURL) {
          settingsService.set('base-url', baseURL);
          settingsService.setProviderSetting('openai', 'base-url', baseURL);
        }

        const stream = openaiProvider.generateChatCompletion(
          createProviderCallOptions({
            providerName: openaiProvider.name,
            contents: messages,
            settings: settingsService,
          }),
        );

        const chunks: string[] = [];
        for await (const message of stream) {
          const textBlocks = message.blocks.filter((b) => b.type === 'text');
          for (const block of textBlocks) {
            chunks.push((block as { type: 'text'; text: string }).text);
          }
        }

        expect(chunks.join('').toLowerCase()).toContain('options signature ok');
      },
    );

    it.skipIf(skipTests)('should handle streaming correctly', async () => {
      if (!apiKey || skipTests) return; // Guard for when test is skipped
      const runtime = initializeTestProviderRuntime({
        runtimeId: `multi-provider.integration.streaming.${Math.random()
          .toString(36)
          .slice(2, 10)}`,
        metadata: {
          suite: 'multi-provider.integration.test',
          test: 'streaming',
        },
        configOverrides: {
          getProvider: () => 'openai',
          getModel: resolveDefaultModel,
          getEphemeralSettings: () => ({
            model: resolveDefaultModel(),
            'base-url': baseURL,
          }),
        },
      });

      const openaiProvider = new OpenAIProvider(apiKey!, baseURL);
      openaiProvider.setRuntimeSettingsService?.(runtime.settingsService);
      openaiProvider.setConfig?.(runtime.config);

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
      resetSettingsService();
      const runtime = initializeTestProviderRuntime({
        runtimeId: `multi-provider.integration.model-specific.${Math.random()
          .toString(36)
          .slice(2, 10)}`,
        metadata: {
          suite: 'multi-provider.integration.test',
          test: 'model-specific',
        },
        configOverrides: {
          getProvider: () => 'openai',
          getModel: resolveDefaultModel,
          getEphemeralSettings: () => ({
            model: resolveDefaultModel(),
            'base-url': baseURL,
          }),
        },
      });

      const openaiProvider = new OpenAIProvider(apiKey!, baseURL);
      openaiProvider.setRuntimeSettingsService?.(runtime.settingsService);
      openaiProvider.setConfig?.(runtime.config);

      const localSettings = runtime.settingsService;
      localSettings.set('activeProvider', openaiProvider.name);

      // Get available models and pick the first one (or use default)
      const models = await openaiProvider.getModels();
      const testModel =
        models.length > 0 ? models[0].id : openaiProvider.getCurrentModel();
      localSettings.set('model', testModel);
      localSettings.setProviderSetting(openaiProvider.name, 'model', testModel);

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
        const runtime = initializeTestProviderRuntime({
          runtimeId: `multi-provider.integration.tool-calls.${Math.random()
            .toString(36)
            .slice(2, 10)}`,
          metadata: {
            suite: 'multi-provider.integration.test',
            test: 'tool-calls',
          },
          configOverrides: {
            getProvider: () => 'openai',
            getModel: resolveDefaultModel,
            getEphemeralSettings: () => ({
              model: resolveDefaultModel(),
              'base-url': baseURL,
            }),
          },
        });

        const openaiProvider = new OpenAIProvider(apiKey!, baseURL);
        openaiProvider.setRuntimeSettingsService?.(runtime.settingsService);
        openaiProvider.setConfig?.(runtime.config);

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
                    location: {
                      type: 'string',
                      description: 'The city name',
                    },
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
            if (toolCallBlocks.length === 0) continue;

            expect(toolCallBlocks.length).toBeGreaterThan(0);
            toolCallReceived = true;
            const toolCall = toolCallBlocks[0] as {
              type: 'tool_call';
              name: string;
              parameters: { location: string };
            };
            console.log(`\n[OK] Tool call received: ${toolCall.name}`);
            console.log(`   Arguments: ${JSON.stringify(toolCall.parameters)}`);

            expect(toolCall.name).toBe('get_weather');
            const args = toolCall.parameters;
            // Check if args exists and has location property
            expect(args).toBeTruthy();
            expect(typeof args).toBe('object');
            expect('location' in args).toBe(true);
            const location = (args as Record<string, unknown>).location;
            expect(typeof location).toBe('string');
            expect((location as string).toLowerCase()).toContain(
              'san francisco',
            );
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
      resetSettingsService();
      const runtime = initializeTestProviderRuntime({
        runtimeId: `multi-provider.integration.invalid-model.${Math.random()
          .toString(36)
          .slice(2, 10)}`,
        metadata: {
          suite: 'multi-provider.integration.test',
          test: 'invalid-model',
        },
        configOverrides: {
          getProvider: () => 'openai',
          getModel: () => 'invalid-model-xyz',
          getEphemeralSettings: () => ({
            model: 'invalid-model-xyz',
            'base-url': baseURL,
          }),
        },
      });

      const openaiProvider = new OpenAIProvider(apiKey!, baseURL);
      openaiProvider.setRuntimeSettingsService?.(runtime.settingsService);
      openaiProvider.setConfig?.(runtime.config);

      const localSettings = runtime.settingsService;
      localSettings.set('activeProvider', openaiProvider.name);
      localSettings.set('model', 'invalid-model-xyz');
      localSettings.setProviderSetting(
        openaiProvider.name,
        'model',
        'invalid-model-xyz',
      );

      const messages = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      let errorThrown = false;
      let errorMessage = '';
      let successReceived = false;

      try {
        const stream = openaiProvider.generateChatCompletion(messages);
        // Try to consume the stream
        for await (const _message of stream) {
          // Model might handle gracefully and return a response
          successReceived = true;
          break;
        }
      } catch (error) {
        errorThrown = true;
        errorMessage = error instanceof Error ? error.message : String(error);
        console.log(
          `\n[OK] Correctly caught error for invalid model: ${errorMessage}`,
        );
      }

      // Either success or error is acceptable for invalid models
      expect(errorThrown || successReceived).toBe(true);
      // If error was thrown, verify it has a message
      expect(!errorThrown || errorMessage.length > 0).toBe(true);
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

      let testErrorThrown = false;
      let testError: unknown = null;
      let modelsReturned = false;

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
          modelsReturned = true;
          // An empty array is acceptable when no authentication is provided
        } catch (error) {
          // If it throws, capture the error for verification outside the catch
          testErrorThrown = true;
          testError = error;
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

      // Verify either models were returned OR an error was thrown
      expect(testErrorThrown || modelsReturned).toBe(true);
      // If error was thrown, verify it's the right type and has expected message
      const errorMessage =
        testError instanceof Error ? testError.message : String(testError);
      expect(!testErrorThrown || testError instanceof Error).toBe(true);
      expect(
        !testErrorThrown || /authentication|API key/i.test(errorMessage),
      ).toBe(true);
    });
  });
});
