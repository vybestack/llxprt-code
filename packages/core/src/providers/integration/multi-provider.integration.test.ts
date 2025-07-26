/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import {
  OpenAIProvider,
  ProviderManager,
  ContentGeneratorRole,
} from '../../index.js';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

describe('Multi-Provider Integration Tests', () => {
  let apiKey: string | null = null;
  let baseURL: string | undefined = undefined;
  let skipTests = false;
  let manager: ProviderManager;

  beforeAll(() => {
    // Try to load OpenAI API key from environment first
    apiKey = process.env.OPENAI_API_KEY || null;
    baseURL = process.env.OPENAI_BASE_URL || undefined;

    // If not in environment, try to load from file
    if (!apiKey) {
      try {
        const apiKeyPath = join(homedir(), '.openai_key');
        if (existsSync(apiKeyPath)) {
          apiKey = readFileSync(apiKeyPath, 'utf-8').trim();
        }
      } catch (_error) {
        // No API key available
      }
    }

    if (!apiKey) {
      console.log(
        '\n⚠️  Skipping Multi-Provider Integration Tests: No OpenAI API key found',
      );
      console.log(
        '   To run these tests, either:\n' +
          '   - Set the OPENAI_API_KEY environment variable, or\n' +
          '   - Create ~/.openai_key with your OpenAI API key\n',
      );
      skipTests = true;
    }

    // Skip tests when using OpenRouter for now
    if (baseURL?.includes('openrouter')) {
      console.log(
        '\n⚠️  Skipping Multi-Provider Integration Tests: OpenRouter detected',
      );
      console.log(
        '   These tests are currently not compatible with OpenRouter\n',
      );
      skipTests = true;
    }
  });

  beforeEach(() => {
    if (!skipTests) {
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

        // Should have multiple models
        expect(models.length).toBeGreaterThan(0);

        // Check for models based on whether we're using OpenRouter or not
        const modelIds = models.map((m) => m.id);
        if (baseURL?.includes('openrouter')) {
          // OpenRouter uses prefixed model names
          expect(
            modelIds.some(
              (id) => id.includes('openai/') || id.includes('google/'),
            ),
          ).toBe(true);
        } else {
          // Direct OpenAI API
          expect(modelIds).toContain('gpt-4.1');
        }

        console.log(`\n✅ Found ${models.length} models`);
        console.log(`   Sample models: ${modelIds.slice(0, 5).join(', ')}...`);
      },
    );

    it.skipIf(skipTests)(
      'should switch between models within provider',
      async () => {
        const openaiProvider = new OpenAIProvider(apiKey!, baseURL);

        // Default model
        expect(openaiProvider.getCurrentModel()).toBe('gpt-4.1');

        // Switch to different models based on provider
        if (baseURL?.includes('openrouter')) {
          // OpenRouter models
          openaiProvider.setModel('openai/gpt-4o');
          expect(openaiProvider.getCurrentModel()).toBe('openai/gpt-4o');

          openaiProvider.setModel('google/gemini-2.5-flash');
          expect(openaiProvider.getCurrentModel()).toBe(
            'google/gemini-2.5-flash',
          );
        } else {
          // Direct OpenAI models
          openaiProvider.setModel('gpt-4');
          expect(openaiProvider.getCurrentModel()).toBe('gpt-4');

          openaiProvider.setModel('gpt-4.1');
          expect(openaiProvider.getCurrentModel()).toBe('gpt-4.1');
        }
      },
    );
  });

  describe('Chat Completion with Real API', () => {
    it.skipIf(skipTests)(
      'should generate chat completion with default model',
      async () => {
        if (!manager) return; // Guard for when test is skipped

        const openaiProvider = new OpenAIProvider(apiKey!, baseURL);
        manager.registerProvider(openaiProvider);
        manager.setActiveProvider('openai');

        const messages = [
          {
            role: ContentGeneratorRole.USER,
            content:
              'Say "Hello from OpenAI integration test" and nothing else.',
          },
        ];

        // Collect the streaming response
        const chunks: string[] = [];
        const stream = openaiProvider.generateChatCompletion(messages);

        for await (const message of stream) {
          if (message.content) {
            chunks.push(message.content);
          }
        }

        const fullResponse = chunks.join('');
        const providerName = baseURL?.includes('openrouter')
          ? 'OpenRouter'
          : 'OpenAI';
        console.log(`\n✅ ${providerName} response: "${fullResponse}"`);

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
          role: ContentGeneratorRole.USER,
          content: 'Count from 1 to 5, one number per line.',
        },
      ];

      const chunks: string[] = [];
      let chunkCount = 0;
      const stream = openaiProvider.generateChatCompletion(messages);

      for await (const message of stream) {
        if (message.content) {
          chunks.push(message.content);
          chunkCount++;
        }
      }

      const fullResponse = chunks.join('');
      console.log(`\n✅ Streaming test received ${chunkCount} chunks`);
      console.log(`   Response: "${fullResponse.trim()}"`);

      // Should receive multiple chunks (streaming)
      expect(chunkCount).toBeGreaterThan(1);

      // Should contain numbers 1-5
      expect(fullResponse).toMatch(/1/);
      expect(fullResponse).toMatch(/2/);
      expect(fullResponse).toMatch(/3/);
      expect(fullResponse).toMatch(/4/);
      expect(fullResponse).toMatch(/5/);
    });

    it.skipIf(skipTests)('should work with GPT-4 model', async () => {
      if (!apiKey || skipTests) return; // Guard for when test is skipped
      const openaiProvider = new OpenAIProvider(apiKey!, baseURL);
      // Use appropriate model based on provider
      const model = baseURL?.includes('openrouter') ? 'openai/gpt-4o' : 'gpt-4';
      openaiProvider.setModel(model);

      const messages = [
        {
          role: ContentGeneratorRole.USER,
          content: 'What is 2+2? Reply with just the number.',
        },
      ];

      const chunks: string[] = [];
      const stream = openaiProvider.generateChatCompletion(messages);

      for await (const message of stream) {
        if (message.content) {
          chunks.push(message.content);
        }
      }

      const fullResponse = chunks.join('').trim();
      console.log(`\n✅ GPT-4 response: "${fullResponse}"`);

      expect(fullResponse).toContain('4');
    });

    it.skipIf(skipTests)('should handle tool calls', async () => {
      if (!apiKey || skipTests) return; // Guard for when test is skipped
      const openaiProvider = new OpenAIProvider(apiKey!, baseURL);

      const messages = [
        {
          role: ContentGeneratorRole.USER,
          content:
            'What is the weather in San Francisco? Use the get_weather function.',
        },
      ];

      const tools = [
        {
          type: 'function' as const,
          function: {
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
        },
      ];

      let toolCallReceived = false;
      const stream = openaiProvider.generateChatCompletion(messages, tools);

      for await (const message of stream) {
        if (message.tool_calls && message.tool_calls.length > 0) {
          toolCallReceived = true;
          const toolCall = message.tool_calls[0];
          console.log(`\n✅ Tool call received: ${toolCall.function.name}`);
          console.log(`   Arguments: ${toolCall.function.arguments}`);

          expect(toolCall.function.name).toBe('get_weather');
          const args = JSON.parse(toolCall.function.arguments);
          expect(args.location.toLowerCase()).toContain('san francisco');
        }
      }

      expect(toolCallReceived).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it.skipIf(skipTests)('should handle invalid model gracefully', async () => {
      if (!apiKey || skipTests) return; // Guard for when test is skipped
      const openaiProvider = new OpenAIProvider(apiKey!, baseURL);
      openaiProvider.setModel('invalid-model-xyz');

      const messages = [{ role: ContentGeneratorRole.USER, content: 'Hello' }];

      try {
        const stream = openaiProvider.generateChatCompletion(messages);
        // Try to consume the stream
        for await (const _message of stream) {
          // Should throw before getting here
        }
        expect.fail('Should have thrown an error');
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.log(
          `\n✅ Correctly caught error for invalid model: ${errorMessage}`,
        );
        expect(errorMessage).toMatch(/model|invalid/i);
      }
    });

    it('should handle missing API key', async () => {
      const provider = new OpenAIProvider('');
      await expect(provider.getModels()).rejects.toThrow(
        'OpenAI API key is required to fetch models',
      );
    });
  });
});
