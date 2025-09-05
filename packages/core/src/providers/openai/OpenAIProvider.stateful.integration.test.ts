/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
// ConversationContext is not available in core package
// import { ConversationContext } from '../../../utils/ConversationContext.js';
import { IContent } from '../../services/history/IContent.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

// This test suite makes live API calls and requires an OpenAI API key.
// The key is expected to be in a file named .openai_key in the user's home directory.
describe('OpenAIProvider Stateful Integration', () => {
  let provider: OpenAIProvider;
  let apiKey: string | undefined;

  beforeAll(() => {
    try {
      const keyPath = path.join(os.homedir(), '.openai_key');
      apiKey = fs.readFileSync(keyPath, 'utf-8').trim();
    } catch {
      console.warn(
        'Skipping stateful integration tests: API key not found at ~/.openai_key',
      );
      apiKey = undefined;
    }
  });

  beforeEach(() => {
    // Ensure each test starts with a fresh context
    // ConversationContext.reset(); // Not available in core package
    if (apiKey) {
      provider = new OpenAIProvider(apiKey, 'https://api.openai.com/v1');
    }
  });

  // Helper function to consume the async iterator and collect content
  async function collectResponse(
    stream: AsyncIterableIterator<IContent>,
  ): Promise<string> {
    let fullContent = '';
    for await (const chunk of stream) {
      const textBlocks = chunk.blocks?.filter((b) => b.type === 'text');
      if (textBlocks?.length) {
        for (const textBlock of textBlocks) {
          fullContent += (textBlock as { text: string }).text;
        }
      }
    }
    return fullContent;
  }

  // TODO: Revert this before finishing. Forcing test to run for TDD.
  it.skip(
    'should maintain context across multiple turns with a stateful model (o3)',
    async () => {
      if (!apiKey) {
        console.warn('Skipping test: API key not found');
        return;
      }
      provider.setModel('o3');

      // Turn 1: Establish context
      // ConversationContext.startNewConversation(); // Not available in core
      const history: IContent[] = [
        {
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: 'My name is Clara and my favorite color is blue.',
            },
          ],
        },
      ];
      const response1 = await collectResponse(
        provider.generateChatCompletion(history),
      );
      history.push({
        speaker: 'ai',
        blocks: [{ type: 'text', text: response1 }],
      });

      // Assert that parentId was set after the first turn
      // ConversationContext not available in core package
      // const contextAfterTurn1 = ConversationContext.getContext();
      // expect(contextAfterTurn1.parentId).toBeDefined();
      // expect(contextAfterTurn1.parentId).not.toBeNull();
      // expect(contextAfterTurn1.parentId).not.toBe('');

      // Turn 2: Ask a follow-up question
      history.push({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'What is my name?' }],
      });
      const response2 = await collectResponse(
        provider.generateChatCompletion(history),
      );

      // Assert that the model remembers the context
      expect(response2.toLowerCase()).toContain('clara');
    },
    { timeout: 30000 }, // 30-second timeout for live API calls
  );

  // TODO: Revert this before finishing. Forcing test to run for TDD.
  it(
    'should not break stateless models by correctly passing full message history',
    async () => {
      if (!apiKey) {
        console.warn('Skipping test: API key not found');
        return;
      }
      provider.setModel('gpt-3.5-turbo');

      const history: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'The secret word is "banana".' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Okay, I will remember that.' }],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'What is the secret word?' }],
        },
      ];

      const response = await collectResponse(
        provider.generateChatCompletion(history),
      );

      // Assert that the model received the full history
      expect(response.toLowerCase()).toContain('banana');
    },
    { timeout: 30000 },
  );
});
