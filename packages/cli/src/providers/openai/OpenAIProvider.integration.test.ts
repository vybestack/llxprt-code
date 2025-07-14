/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider';
import { IMessage, ITool } from '../IProvider.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Helper to load API key from file
function loadApiKey(filename: string): string | undefined {
  const keyPath = path.join(os.homedir(), filename);
  try {
    if (fs.existsSync(keyPath)) {
      return fs.readFileSync(keyPath, 'utf8').trim();
    }
  } catch (error) {
    console.error(`Failed to read ${filename}:`, error);
  }
  return undefined;
}

const OPENAI_API_KEY = loadApiKey('.openai_key');
const skipTests = !OPENAI_API_KEY;

describe.skipIf(skipTests)('OpenAIProvider Integration Tests', () => {
  let provider: OpenAIProvider;

  beforeAll(() => {
    if (!OPENAI_API_KEY) {
      console.log('Skipping OpenAI integration tests: ~/.openai_key not found');
      return;
    }
    provider = new OpenAIProvider(OPENAI_API_KEY);
  });

  it('should fetch real models from OpenAI API', async () => {
    const models = await provider.getModels();

    // Verify we got models back
    expect(models).toBeDefined();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);

    // Verify model structure
    const firstModel = models[0];
    expect(firstModel).toHaveProperty('id');
    expect(firstModel).toHaveProperty('name');
    expect(firstModel).toHaveProperty('provider', 'openai');
    expect(firstModel).toHaveProperty('supportedToolFormats');
    expect(firstModel.supportedToolFormats).toEqual(['openai']);

    // Check for some expected models
    const modelIds = models.map((m) => m.id);
    expect(modelIds).toContain('gpt-3.5-turbo');

    console.log(`Found ${models.length} OpenAI models:`, modelIds);
  });

  it('should generate real chat completion', async () => {
    const messages: IMessage[] = [
      {
        role: 'user',
        content: 'Say "Hello from integration test" and nothing else.',
      },
    ];

    const responses: IMessage[] = [];
    const generator = provider.generateChatCompletion(messages);

    for await (const message of generator) {
      responses.push(message);
    }

    // Should have received at least one response
    expect(responses.length).toBeGreaterThan(0);

    // Last message should have the full content
    const lastMessage = responses[responses.length - 1];
    expect(lastMessage.role).toBe('assistant');
    expect(lastMessage.content).toBeTruthy();

    // Note: The exact content may vary based on the model's response
    console.log('Received response:', lastMessage.content);
  });

  it('should handle tool calls', async () => {
    const messages: IMessage[] = [
      {
        role: 'user',
        content:
          'What is the weather in San Francisco? Use the get_weather tool.',
      },
    ];

    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get the weather for a location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'The city name' },
              unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
            },
            required: ['location'],
          },
        },
      },
    ];

    const responses: IMessage[] = [];
    const generator = provider.generateChatCompletion(messages, tools);

    for await (const message of generator) {
      responses.push(message);
    }

    // Last message should have tool calls
    const lastMessage = responses[responses.length - 1];
    expect(lastMessage.tool_calls).toBeDefined();
    expect(Array.isArray(lastMessage.tool_calls)).toBe(true);

    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      const toolCall = lastMessage.tool_calls[0];
      expect(toolCall.function.name).toBe('get_weather');
      expect(toolCall.function.arguments).toBeTruthy();

      // Parse and verify arguments
      const args = JSON.parse(toolCall.function.arguments);
      expect(args.location.toLowerCase()).toContain('san francisco');

      console.log('Tool call received:', toolCall);
    }
  });
});
