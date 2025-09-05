/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import { IContent } from '../../services/history/IContent.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
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
    if (!provider) return; // Skip if no API key
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

    // If LLXPRT_DEFAULT_MODEL is set, verify it's in the list
    if (process.env.LLXPRT_DEFAULT_MODEL) {
      const modelIds = models.map((m) => m.id);
      expect(modelIds).toContain(process.env.LLXPRT_DEFAULT_MODEL);
    }

    console.log(`Found ${models.length} OpenAI models`);
  });

  it('should generate real chat completion', async () => {
    if (!provider) return; // Skip if no API key
    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: 'Say "Hello from integration test" and nothing else.',
          },
        ],
      },
    ];

    const responses: IContent[] = [];
    const generator = provider.generateChatCompletion(messages);

    for await (const message of generator) {
      console.log('Received message:', JSON.stringify(message));
      responses.push(message);
    }

    // Should have received at least one response
    expect(responses.length).toBeGreaterThan(0);

    // Combine all content from messages
    const fullContent = responses
      .map((m) => {
        const textBlocks = m.blocks.filter((b) => b.type === 'text');
        return textBlocks.map((b) => (b as { text: string }).text).join('');
      })
      .join('');

    expect(fullContent).toBeTruthy();
    expect(fullContent).toContain('Hello from integration test');

    // Check that we have assistant messages
    const assistantMessages = responses.filter((m) => m.role === 'assistant');
    expect(assistantMessages.length).toBeGreaterThan(0);

    // Note: The exact content may vary based on the model's response
    console.log('Received full response:', fullContent);
  });

  it('should handle tool calls', { timeout: 10000 }, async () => {
    if (!provider) return; // Skip if no API key
    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: 'What is the weather in San Francisco? Use the get_weather tool.',
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
                unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
              },
              required: ['location'],
            },
          },
        ],
      },
    ];

    const responses: IContent[] = [];
    const generator = provider.generateChatCompletion(messages, tools);

    for await (const message of generator) {
      console.log('Tool message:', JSON.stringify(message));
      responses.push(message);
    }

    // Find message with tool calls
    const toolCallMessage = responses.find((m) =>
      m.blocks.some((b) => b.type === 'tool_call'),
    );
    expect(toolCallMessage).toBeDefined();

    const toolCallBlocks =
      toolCallMessage?.blocks.filter((b) => b.type === 'tool_call') || [];
    expect(toolCallBlocks.length).toBeGreaterThan(0);

    if (toolCallBlocks.length > 0) {
      const toolCall = toolCallBlocks[0] as {
        type: 'tool_call';
        name: string;
        parameters: { location: string };
      };
      expect(toolCall.name).toBe('get_weather');
      expect(toolCall.parameters).toBeTruthy();

      // Verify parameters
      const args = toolCall.parameters;
      expect(args.location.toLowerCase()).toContain('san francisco');

      console.log('Tool call received:', toolCall);
    }
  });
});
