/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import {
  getProviderManager,
  resetProviderManager,
} from '../providerManagerInstance.js';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import { enhanceConfigWithProviders } from '../enhanceConfigWithProviders.js';
import { Config } from '@google/gemini-cli-core';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

describe('Multi-Provider Integration Tests', () => {
  let apiKey: string | null = null;
  let skipTests = false;

  beforeAll(() => {
    // Try to load OpenAI API key
    try {
      const apiKeyPath = join(homedir(), '.openai_key');
      if (existsSync(apiKeyPath)) {
        apiKey = readFileSync(apiKeyPath, 'utf-8').trim();
      }
    } catch (_error) {
      // No API key available
    }

    if (!apiKey) {
      console.log(
        '\n⚠️  Skipping Multi-Provider Integration Tests: No OpenAI API key found at ~/.openai_key',
      );
      console.log(
        '   To run these tests, create ~/.openai_key with your OpenAI API key\n',
      );
      skipTests = true;
    }
  });

  beforeEach(() => {
    if (!skipTests) {
      resetProviderManager();
    }
  });

  afterEach(() => {
    if (!skipTests) {
      resetProviderManager();
    }
  });

  describe('Provider Management', () => {
    it.skipIf(skipTests)(
      'should initialize and register OpenAI provider',
      () => {
        const manager = getProviderManager();

        // Initially no providers
        expect(manager.listProviders()).toEqual([]);
        expect(manager.hasActiveProvider()).toBe(false);

        // Register OpenAI provider
        const openaiProvider = new OpenAIProvider(apiKey!);
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
      const manager = getProviderManager();

      // Register OpenAI
      const openaiProvider = new OpenAIProvider(apiKey!);
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
      const manager = getProviderManager();

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
        const manager = getProviderManager();
        const openaiProvider = new OpenAIProvider(apiKey!);
        manager.registerProvider(openaiProvider);
        manager.setActiveProvider('openai');

        const models = await manager.getAvailableModels();

        // Should have multiple models
        expect(models.length).toBeGreaterThan(0);

        // Should include common OpenAI models
        const modelIds = models.map((m) => m.id);
        expect(modelIds).toContain('gpt-3.5-turbo');

        console.log(`\n✅ Found ${models.length} OpenAI models`);
        console.log(`   Sample models: ${modelIds.slice(0, 5).join(', ')}...`);
      },
    );

    it.skipIf(skipTests)(
      'should switch between models within provider',
      async () => {
        const openaiProvider = new OpenAIProvider(apiKey!);

        // Default model
        expect(openaiProvider.getCurrentModel()).toBe('gpt-3.5-turbo');

        // Switch to GPT-4
        openaiProvider.setModel('gpt-4');
        expect(openaiProvider.getCurrentModel()).toBe('gpt-4');

        // Switch to another model
        openaiProvider.setModel('gpt-3.5-turbo-16k');
        expect(openaiProvider.getCurrentModel()).toBe('gpt-3.5-turbo-16k');
      },
    );
  });

  describe('Chat Completion with Real API', () => {
    it.skipIf(skipTests)(
      'should generate chat completion with gpt-3.5-turbo',
      async () => {
        const manager = getProviderManager();
        const openaiProvider = new OpenAIProvider(apiKey!);
        manager.registerProvider(openaiProvider);
        manager.setActiveProvider('openai');

        const messages = [
          {
            role: 'user' as const,
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
        console.log(`\n✅ GPT-3.5-turbo response: "${fullResponse}"`);

        expect(fullResponse.toLowerCase()).toContain(
          'hello from openai integration test',
        );
      },
    );

    it.skipIf(skipTests)('should handle streaming correctly', async () => {
      const openaiProvider = new OpenAIProvider(apiKey!);

      const messages = [
        {
          role: 'user' as const,
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
      const openaiProvider = new OpenAIProvider(apiKey!);
      openaiProvider.setModel('gpt-4');

      const messages = [
        {
          role: 'user' as const,
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
      const openaiProvider = new OpenAIProvider(apiKey!);

      const messages = [
        {
          role: 'user' as const,
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

  describe('Integration with Config and ContentGenerator', () => {
    it.skipIf(skipTests)('should work through enhanced Config', async () => {
      // Setup provider
      const manager = getProviderManager();
      const openaiProvider = new OpenAIProvider(apiKey!);
      manager.registerProvider(openaiProvider);
      manager.setActiveProvider('openai');

      // Create a minimal config
      const mockGeminiClient = {
        chat: { contentGenerator: null },
      };

      const config = {
        refreshAuth: async () => {},
        getGeminiClient: () => mockGeminiClient,
        getModel: () => 'gpt-3.5-turbo',
      } as unknown as Config;

      // Enhance config
      enhanceConfigWithProviders(config);

      // Call refreshAuth to trigger provider integration
      await config.refreshAuth('test-auth');

      // Verify content generator was set
      const contentGenerator = mockGeminiClient.chat.contentGenerator;
      expect(contentGenerator).not.toBeNull();
      expect(contentGenerator?.generateContent).toBeDefined();
      expect(contentGenerator?.generateContentStream).toBeDefined();

      // Test actual content generation
      if (contentGenerator) {
        const response = await contentGenerator.generateContent({
          model: 'gpt-3.5-turbo',
          contents: 'Say hello',
          config: {},
        });

        expect(response.candidates).toBeDefined();
        expect(response.candidates?.[0]?.content).toBeDefined();

        const text = response.candidates?.[0]?.content?.parts
          ?.filter(
            (p: unknown) => typeof p === 'object' && p !== null && 'text' in p,
          )
          .map((p: unknown) => (p as { text: string }).text)
          .join('');

        console.log(`\n✅ Content generator response: "${text}"`);
        expect(text?.toLowerCase()).toContain('hello');
      }
    });
  });

  describe('Error Handling', () => {
    it.skipIf(skipTests)('should handle invalid model gracefully', async () => {
      const openaiProvider = new OpenAIProvider(apiKey!);
      openaiProvider.setModel('invalid-model-xyz');

      const messages = [{ role: 'user' as const, content: 'Hello' }];

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

    it('should handle missing API key', () => {
      expect(() => new OpenAIProvider('')).toThrow(
        'OpenAI API key is required',
      );
    });
  });
});
