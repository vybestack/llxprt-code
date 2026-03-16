/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

vi.unmock('./providerAliases.js');

import { loadProviderAliasEntries } from './providerAliases.js';

describe('provider alias default models (#1543)', () => {
  const entries = loadProviderAliasEntries();

  const findAlias = (alias: string) =>
    entries.find((candidate) => candidate.alias === alias);

  it('openai defaults to gpt-5.2', () => {
    const entry = findAlias('openai');
    expect(entry).toBeDefined();
    expect(entry?.config.defaultModel).toBe('gpt-5.2');
  });

  it('xAI defaults to grok-4', () => {
    const entry = findAlias('xAI');
    expect(entry).toBeDefined();
    expect(entry?.config.defaultModel).toBe('grok-4');
  });

  it('Synthetic defaults to hf:zai-org/GLM-4.7', () => {
    const entry = findAlias('Synthetic');
    expect(entry).toBeDefined();
    expect(entry?.config.defaultModel).toBe('hf:zai-org/GLM-4.7');
  });

  it('Chutes.ai defaults to zai-org/GLM-5-TEE', () => {
    const entry = findAlias('Chutes.ai');
    expect(entry).toBeDefined();
    expect(entry?.config.defaultModel).toBe('zai-org/GLM-5-TEE');
  });

  it('OpenRouter defaults to nvidia/nemotron-nano-9b-v2', () => {
    const entry = findAlias('OpenRouter');
    expect(entry).toBeDefined();
    expect(entry?.config.defaultModel).toBe('nvidia/nemotron-nano-9b-v2');
  });

  it('Fireworks defaults to fireworks/minimax-m2p5', () => {
    const entry = findAlias('Fireworks');
    expect(entry).toBeDefined();
    expect(entry?.config.defaultModel).toBe('fireworks/minimax-m2p5');
  });

  describe('deepseek alias', () => {
    it('is registered and discoverable', () => {
      const entry = findAlias('deepseek');
      expect(entry).toBeDefined();
      expect(entry?.source).toBe('builtin');
    });

    it('has correct base configuration', () => {
      const entry = findAlias('deepseek');
      expect(entry?.config.baseProvider).toBe('openai');
      expect(entry?.config['base-url']).toBe('https://api.deepseek.com/v1');
      expect(entry?.config.defaultModel).toBe('deepseek-chat');
      expect(entry?.config.apiKeyEnv).toBe('DEEPSEEK_API_KEY');
    });
  });
});
