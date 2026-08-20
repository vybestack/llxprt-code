/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { computeModelDefaults } from '../runtime/providerMutations.js';
import {
  loadProviderAliasEntries,
  type ProviderAliasConfig,
} from './providerAliases.js';

function loadBuiltinAlias(alias: string): ProviderAliasConfig {
  const entry = loadProviderAliasEntries().find(
    (candidate) =>
      candidate.source === 'builtin' &&
      candidate.alias.toLowerCase() === alias.toLowerCase(),
  );
  if (!entry) {
    throw new Error(`Builtin provider alias '${alias}' was not loaded`);
  }
  return entry.config;
}

function resolveAliasDefaults(
  alias: string,
  model: string,
): Record<string, unknown> {
  const config = loadBuiltinAlias(alias);
  return {
    ...config.ephemeralSettings,
    ...computeModelDefaults(model, config.modelDefaults ?? []),
  };
}

function expectMap(
  defaults: Readonly<Record<string, unknown>>,
  key: 'reasoning.effortMap' | 'reasoning.enabledMap',
  expected: Readonly<Record<string, unknown>>,
): void {
  expect(defaults[key]).toStrictEqual(expected);
}

describe('issue #3255 builtin alias reasoning defaults', () => {
  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])(
    'resolves Codex Responses wire format and existing defaults for %s',
    (model) => {
      const defaults = resolveAliasDefaults('codex', model);

      expect(defaults).toMatchObject({
        'reasoning.effortWireFormat': 'openai-responses',
        'reasoning.effort': 'medium',
        'reasoning.summary': 'auto',
      });
    },
  );

  it('leaves OpenAI GPT-5.6 effort selection to the chosen adapter', () => {
    const gpt56 = resolveAliasDefaults('openai', 'gpt-5.6');
    const unrelatedChatModel = resolveAliasDefaults('openai', 'gpt-5.5');

    expect(gpt56['reasoning.effortWireFormat']).toBeUndefined();
    expect(gpt56).toMatchObject({
      'reasoning.enabled': true,
      'reasoning.effort': 'high',
    });
    expect(unrelatedChatModel['reasoning.effortWireFormat']).toBeUndefined();
  });

  it('selects OpenRouter wire formats without forcing reasoning controls', () => {
    const defaults = resolveAliasDefaults(
      'openrouter',
      'anthropic/claude-sonnet-4.6',
    );

    expect(defaults).toMatchObject({
      'reasoning.effortWireFormat': 'openrouter',
      'reasoning.enabledWireFormat': 'openrouter',
    });
    expect(defaults).not.toHaveProperty('reasoning.enabled');
    expect(defaults).not.toHaveProperty('reasoning.effort');
  });

  it.each(['anthropic', 'claudecode'])(
    'selects Opus 5 Anthropic adaptive controls narrowly for %s',
    (alias) => {
      const opus = resolveAliasDefaults(alias, 'claude-opus-5');
      const sonnet = resolveAliasDefaults(alias, 'claude-sonnet-5');

      expect(opus).toMatchObject({
        'reasoning.effortWireFormat': 'anthropic',
        'reasoning.enabledWireFormat': 'thinking',
      });
      expectMap(opus, 'reasoning.effortMap', { minimal: 'low' });
      expectMap(opus, 'reasoning.enabledMap', {
        true: 'adaptive',
        false: 'disabled',
      });
      expect(sonnet).not.toHaveProperty('reasoning.effortWireFormat');
      expect(sonnet).not.toHaveProperty('reasoning.enabledWireFormat');
      expect(sonnet).not.toHaveProperty('reasoning.enabledMap');
    },
  );

  it('resolves GLM-5.3 forced-thinking formats and maps over broad GLM-5 defaults', () => {
    const defaults = resolveAliasDefaults('zai', 'glm-5.3');

    expect(defaults).toMatchObject({
      'reasoning.effortWireFormat': 'anthropic',
      'reasoning.enabledWireFormat': 'thinking',
    });
    expectMap(defaults, 'reasoning.effortMap', {
      minimal: 'low',
      low: 'low',
      medium: 'high',
      high: 'high',
      xhigh: 'max',
      max: 'max',
    });
    expectMap(defaults, 'reasoning.enabledMap', {
      true: 'enabled',
      false: null,
    });
  });

  it('resolves GLM-5.2 formats, documented effort values, and disable support', () => {
    const defaults = resolveAliasDefaults('zai', 'glm-5.2');

    expect(defaults).toMatchObject({
      'reasoning.effortWireFormat': 'anthropic',
      'reasoning.enabledWireFormat': 'thinking',
      'reasoning.effort': 'high',
      'context-limit': 1000000,
      maxOutputTokens: 128000,
    });
    expectMap(defaults, 'reasoning.effortMap', {
      minimal: 'minimal',
      low: 'high',
      medium: 'high',
      high: 'high',
      xhigh: 'max',
      max: 'max',
    });
    expectMap(defaults, 'reasoning.enabledMap', {
      true: 'enabled',
      false: 'disabled',
    });
  });

  it.each(['kimi-for-coding', 'kimi-for-coding-highspeed'])(
    'uses thinking enablement without a K3 effort default for %s',
    (model) => {
      const defaults = resolveAliasDefaults('kimi', model);

      expect(defaults).toMatchObject({
        'reasoning.effortWireFormat': 'none',
        'reasoning.enabledWireFormat': 'thinking',
        'reasoning.enabled': true,
        max_tokens: 32768,
        'context-limit': 262144,
      });
      expectMap(defaults, 'reasoning.enabledMap', {
        true: 'enabled',
        false: null,
      });
      expect(defaults).not.toHaveProperty('reasoning.effort');
    },
  );

  it.each([
    ['kimi-k3', 'max', 1000000],
    ['k3-256k', 'high', 262144],
  ])(
    'uses OpenAI effort and enablement for %s',
    (model, effort, contextLimit) => {
      const defaults = resolveAliasDefaults('kimi', model);

      expect(defaults).toMatchObject({
        'reasoning.effortWireFormat': 'openai',
        'reasoning.enabledWireFormat': 'openai',
        'reasoning.effort': effort,
        max_tokens: 131072,
        'context-limit': contextLimit,
      });
      expectMap(defaults, 'reasoning.effortMap', {
        minimal: 'low',
        low: 'low',
        medium: 'high',
        high: 'high',
        xhigh: 'max',
        max: 'max',
      });
      expect(defaults['reasoning.enabledWireFormat']).not.toBe('thinking');
    },
  );

  it.each(['deepseek-v4-flash', 'deepseek-v4-chat'])(
    'selects DeepSeek V4 reasoning controls and geometry for %s',
    (model) => {
      const defaults = resolveAliasDefaults('deepseek', model);

      expect(defaults).toMatchObject({
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'openai',
        'reasoning.enabledWireFormat': 'thinking',
        'context-limit': 1000000,
        max_tokens: 4096,
      });
      expectMap(defaults, 'reasoning.effortMap', {
        minimal: 'low',
        low: 'low',
        medium: 'high',
        high: 'high',
        xhigh: 'high',
        max: 'max',
      });
      expectMap(defaults, 'reasoning.enabledMap', {
        true: 'enabled',
        false: 'disabled',
      });
    },
  );

  it('does not apply DeepSeek V4 defaults to a foreign near-match', () => {
    const defaults = resolveAliasDefaults(
      'deepseek',
      'foreign-deepseek-v4-chat',
    );

    expect(defaults).toStrictEqual({});
  });

  it('selects only the compatible Fireworks MiniMax controls', () => {
    const defaults = resolveAliasDefaults('fireworks', 'fireworks/minimax-m3');

    expect(defaults).toMatchObject({
      'reasoning.effortWireFormat': 'openai',
      'reasoning.enabledWireFormat': 'openai',
    });
    expectMap(defaults, 'reasoning.enabledMap', { false: 'none' });
    expect(defaults['reasoning.enabledMap']).not.toHaveProperty('true');
    expect(defaults['reasoning.enabledWireFormat']).not.toBe('thinking');
  });

  it.each(['llama.cpp', 'LM Studio', 'LiteLLM'])(
    'does not impose reasoning wire defaults on local alias %s',
    (alias) => {
      const defaults = resolveAliasDefaults(alias, 'local-model');

      expect(defaults).not.toHaveProperty('reasoning.effortWireFormat');
      expect(defaults).not.toHaveProperty('reasoning.enabledWireFormat');
    },
  );
});
