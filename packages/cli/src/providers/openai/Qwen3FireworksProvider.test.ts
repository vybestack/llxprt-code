/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { Qwen3FireworksProvider } from './Qwen3FireworksProvider';
import { ContentGeneratorRole } from '../types.js';

describe('Qwen3FireworksProvider', () => {
  it('should initialize with correct name and endpoint', () => {
    const provider = new Qwen3FireworksProvider('test-api-key');
    expect(provider.name).toBe('qwen3-fireworks');
  });

  it('should return correct models', async () => {
    const provider = new Qwen3FireworksProvider('test-api-key');
    const models = await provider.getModels();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('accounts/fireworks/models/qwen3-235b-a22b');
    expect(models[0].name).toBe('Qwen3 235B');
    expect(models[0].provider).toBe('qwen3-fireworks');
  });

  it('should clean Qwen3 control tokens from content', async () => {
    const provider = new Qwen3FireworksProvider('test-api-key');

    // Mock the parent's generateChatCompletion to return content with Qwen3 tokens
    const mockMessages = [
      {
        role: ContentGeneratorRole.ASSISTANT,
        content:
          '<|im_start|>assistant\nHello<|im_end|> world<|reserved_special_token_123|>!',
      },
    ];

    // Access the private method through reflection for testing
    const cleanMethod = (
      provider as unknown as { cleanQwen3Content: (content: string) => string }
    ).cleanQwen3Content.bind(provider);
    const cleaned = cleanMethod(mockMessages[0].content);

    expect(cleaned).toBe('Hello world!');
  });

  it('should handle multiple newlines correctly', async () => {
    const provider = new Qwen3FireworksProvider('test-api-key');

    // Access the private method through reflection for testing
    const cleanMethod = (
      provider as unknown as { cleanQwen3Content: (content: string) => string }
    ).cleanQwen3Content.bind(provider);
    const cleaned = cleanMethod('Hello\n\n\n\nworld');

    expect(cleaned).toBe('Hello world');
  });

  it('should fix missing spaces between words', () => {
    const provider = new Qwen3FireworksProvider('test-api-key');

    // Access the private method through reflection for testing
    const cleanMethod = (
      provider as unknown as { cleanQwen3Content: (content: string) => string }
    ).cleanQwen3Content.bind(provider);

    // Test the exact pattern from the user's example
    const input =
      'findaProviderContext.tsfile,whichprobably indicatesa different namingconventionforprovider-relatedcode';
    const cleaned = cleanMethod(input);

    // Should add spaces before capital letters
    expect(cleaned).toContain('Provider Context');
    expect(cleaned).not.toContain('findaProvider');
  });

  it('should keep think tags visible', () => {
    const provider = new Qwen3FireworksProvider('test-api-key');

    // Access the private method through reflection for testing
    const cleanMethod = (
      provider as unknown as { cleanQwen3Content: (content: string) => string }
    ).cleanQwen3Content.bind(provider);

    const input =
      "✦ <think>Okay, I couldn't find a file</think>Here is the actual response";
    const cleaned = cleanMethod(input);

    // Think tags should be kept visible
    expect(cleaned).toBe(
      "✦ <think>Okay, I couldn't find a file</think>Here is the actual response",
    );
  });

  it('should fix malformed tool calls', () => {
    const provider = new Qwen3FireworksProvider('test-api-key');

    // Access the private method through reflection for testing
    const cleanMethod = (
      provider as unknown as { cleanQwen3Content: (content: string) => string }
    ).cleanQwen3Content.bind(provider);

    const input = '<tool_call>  {"name": "test"} </tool_call>';
    const cleaned = cleanMethod(input);

    expect(cleaned).toBe('<tool_call>{"name": "test"}</tool_call>');
  });

  it('should remove duplicate tool calls', () => {
    const provider = new Qwen3FireworksProvider('test-api-key');

    // Access the private method through reflection for testing
    const cleanMethod = (
      provider as unknown as { cleanQwen3Content: (content: string) => string }
    ).cleanQwen3Content.bind(provider);

    const input =
      '<tool_call>{"name": "test"}</tool_call> <tool_call>{"name": "test"}</tool_call>';
    const cleaned = cleanMethod(input);

    expect(cleaned).toBe('<tool_call>{"name": "test"}</tool_call>');
  });

  it('should set model correctly', () => {
    const provider = new Qwen3FireworksProvider('test-api-key');

    // Should keep the Qwen3 model when trying to set a different one
    provider.setModel('gpt-4');
    expect(provider.getCurrentModel()).toBe(
      'accounts/fireworks/models/qwen3-235b-a22b',
    );

    // Should accept a different Qwen3 model
    provider.setModel('accounts/fireworks/models/qwen3-70b');
    expect(provider.getCurrentModel()).toBe(
      'accounts/fireworks/models/qwen3-70b',
    );
  });

  it('should clean incomplete tool calls from the user example', () => {
    const provider = new Qwen3FireworksProvider('test-api-key');

    // Access the private method through reflection for testing
    const cleanMethod = (
      provider as unknown as { cleanQwen3Content: (content: string) => string }
    ).cleanQwen3Content.bind(provider);

    // The exact malformed output from the user's example
    const input = `✦ <think>Okay, I couldn't findaProviderContext.tsfile,whichprobably indicatesa different namingconventionforprovider-relatedcode. Let's searchfor files thatmightcontainQwen3 or provider-specificcode.
  </think><tool_call>
  {"name":"glob", "arguments":{"pattern": "/qwen3*|/Qwen3*|*/provider", "path": "/Users/acoliver/projects/gemini-c<tool_call>{"name": "glob","arguments": {"pattern":"/qwen3*|/Qwen3*|*/provider", 
  "path": "/Users/acoliver/projects/gemini-code/gemini-cli`;

    const cleaned = cleanMethod(input);

    // Should keep think tags but remove incomplete tool calls
    expect(cleaned).toContain('<think>');
    expect(cleaned).toContain('</think>');
    expect(cleaned).not.toContain('<tool_call>');
    expect(cleaned).not.toContain('{"name"');
    // The content should include the think block but with cleaned up spacing
    expect(cleaned).toMatch(/✦ <think>.*<\/think>/s);
  });
});
