/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from 'bun:test';
import {
  OpenAIProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { resetSettingsService } from '@vybestack/llxprt-code-settings';
import { initializeTestProviderRuntime } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  IContent,
  ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

const resolveDefaultModel = (): string =>
  process.env.LLXPRT_DEFAULT_MODEL ?? 'gpt-4o';

function log(message: string): void {
  process.stdout.write(message + '\n');
}

function getProviderDisplayName(baseURL: string | undefined): string {
  return baseURL?.includes('openrouter') === true ? 'OpenRouter' : 'OpenAI';
}

function getEffectiveBaseURL(baseURL: string | undefined): string {
  return baseURL ?? '';
}

function selectTestModel(
  models: ReadonlyArray<{ readonly id: string }>,
  fallbackModel: string,
): string {
  if (models.length > 0) {
    return models[0].id;
  }
  return fallbackModel;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertToolCallBlocks(
  toolCallBlocks: readonly ToolCallBlock[],
  toolCallPreviouslyReceived: boolean,
): boolean {
  if (toolCallBlocks.length === 0) {
    return toolCallPreviouslyReceived;
  }

  expect(toolCallBlocks.length).toBeGreaterThan(0);
  const toolCall = toolCallBlocks[0];

  log(`\n[OK] Tool call received: ${toolCall.name}`);
  log(`   Arguments: ${JSON.stringify(toolCall.parameters)}`);

  expect(toolCall.name).toBe('get_weather');
  const args = toolCall.parameters as { location: string };
  expect(args).toBeTruthy();
  expect(typeof args).toBe('object');
  expect('location' in args).toBe(true);
  const location = (args as Record<string, unknown>).location;
  expect(typeof location).toBe('string');
  expect((location as string).toLowerCase()).toContain('san francisco');
  return true;
}

async function inspectWeatherToolCalls(
  stream: AsyncIterable<IContent>,
): Promise<boolean> {
  let toolCallReceived = false;
  for await (const message of stream) {
    const toolCallBlocks = message.blocks.filter(
      (block): block is ToolCallBlock => block.type === 'tool_call',
    );
    toolCallReceived = assertToolCallBlocks(toolCallBlocks, toolCallReceived);
  }
  return toolCallReceived;
}

function handleToolCallError(error: unknown): void {
  const errorMessage = getErrorMessage(error);
  if (
    errorMessage.includes('tool calling') ||
    errorMessage.includes('not supported')
  ) {
    log(
      `\nWARNING:  Skipping tool call test: Model doesn't support tool calling`,
    );
    return;
  }
  throw error;
}

interface InvalidModelOutcome {
  readonly completed: boolean;
  readonly errorHasMessage: boolean;
}

function getInvalidModelOutcome(
  errorThrown: boolean,
  successReceived: boolean,
  errorMessage: string,
): InvalidModelOutcome {
  return {
    completed: errorThrown || successReceived,
    errorHasMessage: !errorThrown || errorMessage.length > 0,
  };
}

interface SavedApiKeys {
  readonly openAI: string | undefined;
  readonly defaultProvider: string | undefined;
  readonly google: string | undefined;
}

function restoreApiKeys(savedApiKeys: SavedApiKeys): void {
  if (savedApiKeys.openAI) {
    process.env.OPENAI_API_KEY = savedApiKeys.openAI;
  }
  if (savedApiKeys.defaultProvider) {
    process.env.GEMINI_API_KEY = savedApiKeys.defaultProvider;
  }
  if (savedApiKeys.google) {
    process.env.GOOGLE_API_KEY = savedApiKeys.google;
  }
}

function missingApiKeyAttemptCompleted(
  testErrorThrown: boolean,
  modelsReturned: boolean,
): boolean {
  return testErrorThrown || modelsReturned;
}

function missingApiKeyErrorIsTyped(
  testErrorThrown: boolean,
  testError: unknown,
): boolean {
  return !testErrorThrown || testError instanceof Error;
}

function missingApiKeyErrorExplainsAuthentication(
  testErrorThrown: boolean,
  testError: unknown,
): boolean {
  return (
    !testErrorThrown ||
    /authentication|API key/i.test(getErrorMessage(testError))
  );
}

const runningInCI = process.env.CI === 'true';
const realProviderOptIn = process.env.LLXPRT_RUN_REAL_PROVIDER_TESTS === 'true';

describe('Multi-Provider Integration Tests', () => {
  const apiKey: string | null = process.env.OPENAI_API_KEY ?? null;
  const baseURL: string | undefined = process.env.OPENAI_BASE_URL ?? undefined;
  const skipTests =
    (runningInCI && !realProviderOptIn) ||
    !apiKey ||
    Boolean(baseURL?.includes('openrouter'));
  let manager: ProviderManager;
  let settingsService: SettingsService;
  let runtimeConfig: Config;

  beforeAll(() => {
    if (runningInCI && !realProviderOptIn) {
      log(
        '\nINFO: Skipping Multi-Provider Integration Tests in CI. Set LLXPRT_RUN_REAL_PROVIDER_TESTS=true to enable.',
      );
    } else if (!apiKey) {
      log(
        '\nWARNING:  Skipping Multi-Provider Integration Tests: No OpenAI API key found',
      );
      log(
        '   To run these tests, set the OPENAI_API_KEY environment variable\n',
      );
    } else if (baseURL != null && baseURL.includes('openrouter') === true) {
      log(
        '\nWARNING:  Skipping Multi-Provider Integration Tests: OpenRouter detected',
      );
      log('   These tests are currently not compatible with OpenRouter\n');
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
    manager = new ProviderManager(runtime);
  });

  afterEach(() => {
    // Clean up any state if needed
  });

  const createOpenAIProvider = (): OpenAIProvider => {
    const provider = new OpenAIProvider(apiKey!, baseURL);
    provider.setRuntimeSettingsService(settingsService);
    provider.setConfig?.(runtimeConfig);
    return provider;
  };

  describe.skipIf(skipTests)('Provider Management', () => {
    it('should initialize and register OpenAI provider', () => {
      // Initially no providers
      expect(manager.listProviders()).toStrictEqual([]);
      expect(manager.hasActiveProvider()).toBe(false);

      // Register OpenAI provider
      const openaiProvider = createOpenAIProvider();
      manager.registerProvider(openaiProvider);

      // Verify registration
      expect(manager.listProviders()).toStrictEqual(['openai']);
      expect(manager.hasActiveProvider()).toBe(false); // Not active yet

      // Activate provider
      manager.setActiveProvider('openai');
      expect(manager.hasActiveProvider()).toBe(true);
      expect(manager.getActiveProviderName()).toBe('openai');
    });

    it('should switch between providers and Gemini', () => {
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

    it('should handle errors for invalid provider', () => {
      // Try to set non-existent provider
      expect(() => manager.setActiveProvider('invalid-provider')).toThrow(
        /Provider .* not found/,
      );
    });
  });

  describe.skipIf(skipTests)('Model Management', () => {
    it('should list available models from OpenAI', async () => {
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

      log(`\n[OK] Found ${models.length} models`);
      log(`   Sample models: ${modelIds.slice(0, 5).join(', ')}...`);
    });

    it('should switch between models within provider', async () => {
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

      const openaiProvider = new OpenAIProvider(apiKey, baseURL);
      openaiProvider.setRuntimeSettingsService(runtime.settingsService);
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
    });
  });

  describe.skipIf(skipTests)('Chat Completion with Real API', () => {
    it('should generate chat completion with default model', async () => {
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
      const providerName = getProviderDisplayName(baseURL);
      log(`\n[OK] ${providerName} response: "${fullResponse}"`);

      expect(fullResponse.toLowerCase()).toContain(
        'hello from openai integration test',
      );
    });

    it('should generate chat completion via options signature', async () => {
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
      const effectiveBaseURL = getEffectiveBaseURL(baseURL);
      settingsService.set('base-url', effectiveBaseURL);
      settingsService.setProviderSetting(
        'openai',
        'base-url',
        effectiveBaseURL,
      );

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
    });

    it('should handle streaming correctly', async () => {
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

      const openaiProvider = new OpenAIProvider(apiKey, baseURL);
      openaiProvider.setRuntimeSettingsService(runtime.settingsService);
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
      log(`\n[OK] Streaming test received ${chunkCount} chunks`);
      log(`   Response: "${fullResponse.trim()}"`);

      // Should receive at least one chunk (streaming)
      expect(chunkCount).toBeGreaterThanOrEqual(1);

      // Should contain numbers 1-5
      expect(fullResponse).toMatch(/1/);
      expect(fullResponse).toMatch(/2/);
      expect(fullResponse).toMatch(/3/);
      expect(fullResponse).toMatch(/4/);
      expect(fullResponse).toMatch(/5/);
    });

    it('should work with a specific model', async () => {
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

      const openaiProvider = new OpenAIProvider(apiKey, baseURL);
      openaiProvider.setRuntimeSettingsService(runtime.settingsService);
      openaiProvider.setConfig?.(runtime.config);

      const localSettings = runtime.settingsService;
      localSettings.set('activeProvider', openaiProvider.name);

      // Get available models and pick the first one (or use default)
      const models = await openaiProvider.getModels();
      const testModel = selectTestModel(
        models,
        openaiProvider.getCurrentModel(),
      );
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
      log(`\n[OK] Model ${testModel} response: "${fullResponse}"`);

      expect(fullResponse).toContain('4');
    });

    it('should handle tool calls', async () => {
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

      const openaiProvider = new OpenAIProvider(apiKey, baseURL);
      openaiProvider.setRuntimeSettingsService(runtime.settingsService);
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
        const stream = openaiProvider.generateChatCompletion(messages, tools);
        const toolCallReceived = await inspectWeatherToolCalls(stream);
        expect(toolCallReceived).toBe(true);
      } catch (error) {
        handleToolCallError(error);
      }
    }, 10000);
  });

  describe('Error Handling', () => {
    describe.skipIf(skipTests)('configured provider behavior', () => {
      it('should handle invalid model gracefully', async () => {
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

        const openaiProvider = new OpenAIProvider(apiKey, baseURL);
        openaiProvider.setRuntimeSettingsService(runtime.settingsService);
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
          errorMessage = getErrorMessage(error);
          log(
            `\n[OK] Correctly caught error for invalid model: ${errorMessage}`,
          );
        }

        // Either success or error is acceptable for invalid models. If an error
        // was thrown, it must include a message.
        const outcome = getInvalidModelOutcome(
          errorThrown,
          successReceived,
          errorMessage,
        );
        expect(outcome.completed).toBe(true);
        expect(outcome.errorHasMessage).toBe(true);
      });
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
        restoreApiKeys({
          openAI: savedApiKey,
          defaultProvider: savedGeminiKey,
          google: savedGoogleKey,
        });
      }

      // Verify either models were returned OR an error was thrown. If an error
      // was thrown, verify its type and authentication message.
      expect(
        missingApiKeyAttemptCompleted(testErrorThrown, modelsReturned),
      ).toBe(true);
      expect(missingApiKeyErrorIsTyped(testErrorThrown, testError)).toBe(true);
      expect(
        missingApiKeyErrorExplainsAuthentication(testErrorThrown, testError),
      ).toBe(true);
    });
  });
});
