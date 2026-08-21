/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  builtinAliasModelBehavior,
  prepare,
  reasoningFields,
} from './OpenAIRequestPreparation.issue3255.test-helpers.js';

describe('OpenAI Chat reasoning wire translation (issue #3255)', () => {
  it('emits top-level OpenAI effort for a custom URL with an explicit selector', async () => {
    const { body } = await prepare({
      baseURL: 'http://localhost:8000/v1',
      modelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'openai',
      },
    });

    expect(reasoningFields(body)).toStrictEqual({ reasoning_effort: 'high' });
  });

  it('auto-selects top-level effort for the official OpenAI Chat API', async () => {
    const { body } = await prepare({
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-5.2',
      modelBehavior: { 'reasoning.effort': 'medium' },
    });

    expect(reasoningFields(body)).toStrictEqual({ reasoning_effort: 'medium' });
  });

  it('omits reasoning on an unknown auto endpoint and records a credential-free warning', async () => {
    const { body, logger } = await prepare({
      baseURL: 'https://unknown.example/v1?api_key=do-not-log',
      model: 'local-model',
      modelBehavior: { 'reasoning.effort': 'high' },
    });

    expect(reasoningFields(body)).toStrictEqual({});
    expect(logger.warnings).toStrictEqual([
      {
        message:
          'OpenAI Chat omitted configured reasoning.effort because the effort format could not be detected for this endpoint',
        metadata: {
          provider: 'openai',
          model: 'local-model',
          selectedFormat: 'none',
          setting: 'reasoning.effort',
          reason: 'effort-format-undetected',
        },
      },
    ]);
    expect(JSON.stringify(logger.warnings)).not.toContain('do-not-log');
  });

  it('warns when an explicit none selector suppresses effort', async () => {
    const { body, logger } = await prepare({
      baseURL: 'http://localhost:8000/v1',
      modelBehavior: {
        'reasoning.effort': 'low',
        'reasoning.effortWireFormat': 'none',
      },
    });

    expect(reasoningFields(body)).toStrictEqual({});
    expect(logger.warnings).toStrictEqual([
      {
        message:
          "OpenAI Chat omitted configured reasoning.effort because the effort format is set to 'none'",
        metadata: {
          provider: 'openai',
          model: 'test-reasoning-model',
          selectedFormat: 'none',
          setting: 'reasoning.effort',
          reason: 'effort-format-none',
        },
      },
    ]);
  });

  it('combines both template kwargs forms and preserves an unrelated sibling', async () => {
    const { body } = await prepare({
      baseURL: 'http://localhost:8000/v1',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.enabledWireFormat': 'template-kwargs',
        'reasoning.effortWireFormat': 'template-kwargs',
      },
      modelParams: {
        chat_template_kwargs: { tokenize: false },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      chat_template_kwargs: {
        tokenize: false,
        enable_thinking: true,
        reasoning_effort: 'high',
      },
    });
  });

  it('merges selected OpenRouter enablement and effort into one reasoning object', async () => {
    const { body } = await prepare({
      baseURL: 'https://openrouter.ai/api/v1',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.enabledMap': { true: true },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      reasoning: { enabled: true, effort: 'high' },
    });
  });

  it('emits the coordinated Z.AI thinking and effort pair without alternatives', async () => {
    const { body } = await prepare({
      baseURL: 'https://api.z.ai/api/paas/v4',
      model: 'glm-5.3',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'xhigh',
        'reasoning.effortMap': { xhigh: 'max' },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
    });
  });

  it('supports a Kimi K3-style effort-only profile selection', async () => {
    const { body, logger } = await prepare({
      baseURL: 'https://api.moonshot.ai/v1',
      model: 'kimi-k3',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'medium',
        'reasoning.enabledWireFormat': 'none',
        'reasoning.effortWireFormat': 'openai',
        'reasoning.effortMap': { medium: 'high' },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({ reasoning_effort: 'high' });
    expect(logger.warnings).toStrictEqual([]);
  });

  it('supports Kimi K2.7-style thinking and warns when effort is suppressed', async () => {
    const { body, logger } = await prepare({
      baseURL: 'https://api.moonshot.ai/v1',
      model: 'kimi-k2.7',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.enabledWireFormat': 'thinking',
        'reasoning.effortWireFormat': 'none',
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled' },
    });
    expect(logger.warnings).toStrictEqual([
      {
        message:
          "OpenAI Chat omitted configured reasoning.effort because the effort format is set to 'none'",
        metadata: {
          provider: 'openai',
          model: 'kimi-k2.7',
          selectedFormat: 'none',
          setting: 'reasoning.effort',
          reason: 'effort-format-none',
        },
      },
    ]);
  });

  it('emits the exact Anthropic budget thinking body from a numeric effort map', async () => {
    const { body } = await prepare({
      baseURL: 'http://localhost:8000/v1',
      modelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'anthropic-budget',
        'reasoning.effortMap': { high: 8192 },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled', budget_tokens: 8192 },
    });
  });

  it('lets a direct budget override an effort-derived Anthropic budget', async () => {
    const { body } = await prepare({
      baseURL: 'http://localhost:8000/v1',
      modelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.budgetTokens': 16384,
        'reasoning.effortWireFormat': 'anthropic-budget',
        'reasoning.effortMap': { high: 8192 },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled', budget_tokens: 16384 },
    });
  });

  it('gives enabled=false precedence over effort on OpenRouter', async () => {
    const { body } = await prepare({
      baseURL: 'https://openrouter.ai/api/v1',
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.effort': 'high',
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      reasoning: { enabled: false },
    });
  });

  it('uses an enabled map to express disablement through OpenAI effort', async () => {
    const { body } = await prepare({
      baseURL: 'http://localhost:8000/v1',
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.effort': 'high',
        'reasoning.enabledWireFormat': 'openai',
        'reasoning.effortWireFormat': 'openai',
        'reasoning.enabledMap': { false: 'none' },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({ reasoning_effort: 'none' });
  });

  it('keeps an explicit effort authoritative over an enabled map string on the OpenAI effort field', async () => {
    const { body, logger } = await prepare({
      baseURL: 'http://localhost:8000/v1',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'openai',
        'reasoning.enabledWireFormat': 'openai',
        'reasoning.enabledMap': { true: 'max' },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      reasoning_effort: 'high',
    });
    expect(logger.warnings).toStrictEqual([]);
  });

  it('suppresses an enabled map string with a null entry while effort still emits', async () => {
    const { body, logger } = await prepare({
      baseURL: 'http://localhost:8000/v1',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'openai',
        'reasoning.enabledWireFormat': 'openai',
        'reasoning.enabledMap': { true: null },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      reasoning_effort: 'high',
    });
    expect(logger.warnings).toStrictEqual([
      {
        message:
          'OpenAI Chat omitted configured reasoning.enabled because its enabled map entry is null',
        metadata: {
          provider: 'openai',
          model: 'test-reasoning-model',
          selectedFormat: 'openai',
          setting: 'reasoning.enabled',
          reason: 'enabled-map-null',
        },
      },
    ]);
  });

  it('fails before transport when emitted effort and enabled formats conflict', async () => {
    const preparation = prepare({
      baseURL: 'https://openrouter.ai/api/v1',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'openrouter',
        'reasoning.enabledWireFormat': 'thinking',
      },
    });

    await expect(preparation).rejects.toThrow(
      "effort format 'openrouter' and enabled format 'thinking' emit conflicting OpenAI Chat reasoning representations",
    );
  });

  it('fails before transport when a thinking disabled map meets an emitted budget', async () => {
    const preparation = prepare({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'anthropic-budget',
        'reasoning.effortMap': { high: 8192 },
        'reasoning.enabledWireFormat': 'thinking',
        'reasoning.enabledMap': { true: 'disabled' },
      },
    });

    await expect(preparation).rejects.toThrow(
      "effort format 'anthropic-budget' and thinking type 'disabled' emit conflicting OpenAI Chat reasoning representations",
    );
  });

  it('suppresses a direct budget when reasoning is disabled', async () => {
    const { body } = await prepare({
      baseURL: 'http://localhost:8000/v1',
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.budgetTokens': 8192,
        'reasoning.enabledWireFormat': 'thinking',
        'reasoning.effortWireFormat': 'anthropic-budget',
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'disabled' },
    });
  });

  it('omits effort and warns when enabled=false cannot be represented', async () => {
    const { body, logger } = await prepare({
      baseURL: 'http://localhost:8000/v1',
      model: 'effort-only-model',
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.effort': 'high',
        'reasoning.enabledWireFormat': 'none',
        'reasoning.effortWireFormat': 'openai',
      },
    });

    expect(reasoningFields(body)).toStrictEqual({});
    expect(logger.warnings).toStrictEqual([
      {
        message:
          'OpenAI Chat omitted configured reasoning.effort because reasoning is explicitly disabled',
        metadata: {
          provider: 'openai',
          model: 'effort-only-model',
          selectedFormat: 'openai',
          setting: 'reasoning.effort',
          reason: 'reasoning-disabled',
        },
      },
      {
        message:
          "OpenAI Chat omitted configured reasoning.enabled because the enabled format is set to 'none'",
        metadata: {
          provider: 'openai',
          model: 'effort-only-model',
          selectedFormat: 'none',
          setting: 'reasoning.enabled',
          reason: 'enabled-format-none',
        },
      },
    ]);
  });

  it('warns when a null effort map deliberately suppresses emission', async () => {
    const { body, logger } = await prepare({
      baseURL: 'http://localhost:8000/v1',
      modelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'openai',
        'reasoning.effortMap': { high: null },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({});
    expect(logger.warnings).toStrictEqual([
      {
        message:
          'OpenAI Chat omitted configured reasoning.effort because its effort map entry is null',
        metadata: {
          provider: 'openai',
          model: 'test-reasoning-model',
          selectedFormat: 'openai',
          setting: 'reasoning.effort',
          reason: 'effort-map-null',
        },
      },
    ]);
  });

  it('warns independently for dropped effort and budget configured together', async () => {
    const { body, logger } = await prepare({
      baseURL: 'http://localhost:8000/v1',
      modelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.budgetTokens': 8192,
        'reasoning.effortWireFormat': 'none',
      },
    });

    expect(reasoningFields(body)).toStrictEqual({});
    expect(logger.warnings).toStrictEqual([
      {
        message:
          "OpenAI Chat omitted configured reasoning.effort because the effort format is set to 'none'",
        metadata: {
          provider: 'openai',
          model: 'test-reasoning-model',
          selectedFormat: 'none',
          setting: 'reasoning.effort',
          reason: 'effort-format-none',
        },
      },
      {
        message:
          'OpenAI Chat omitted configured reasoning.budgetTokens because direct budgets are only supported by the anthropic-budget effort format',
        metadata: {
          provider: 'openai',
          model: 'test-reasoning-model',
          selectedFormat: 'none',
          setting: 'reasoning.budgetTokens',
          reason: 'budget-not-supported',
        },
      },
    ]);
  });

  it('warns when a budget alone is dropped by a non-budget Chat format', async () => {
    const { body, logger } = await prepare({
      baseURL: 'http://localhost:8000/v1',
      modelBehavior: {
        'reasoning.budgetTokens': 8192,
        'reasoning.effortWireFormat': 'openai',
      },
    });

    expect(reasoningFields(body)).toStrictEqual({});
    expect(logger.warnings).toStrictEqual([
      {
        message:
          'OpenAI Chat omitted configured reasoning.budgetTokens because direct budgets are only supported by the anthropic-budget effort format',
        metadata: {
          provider: 'openai',
          model: 'test-reasoning-model',
          selectedFormat: 'openai',
          setting: 'reasoning.budgetTokens',
          reason: 'budget-not-supported',
        },
      },
    ]);
  });

  it('does not warn for a budget consumed by the anthropic-budget Chat format', async () => {
    const { body, logger } = await prepare({
      baseURL: 'http://localhost:8000/v1',
      modelBehavior: {
        'reasoning.budgetTokens': 8192,
        'reasoning.effortWireFormat': 'anthropic-budget',
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled', budget_tokens: 8192 },
    });
    expect(logger.warnings).toStrictEqual([]);
  });

  it('warns for a dropped budget and disablement separately under anthropic-budget', async () => {
    const { body, logger } = await prepare({
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.budgetTokens': 8192,
        'reasoning.effortWireFormat': 'anthropic-budget',
        'reasoning.enabledWireFormat': 'none',
      },
    });

    expect(reasoningFields(body)).toStrictEqual({});
    expect(logger.warnings).toStrictEqual([
      {
        message:
          'OpenAI Chat omitted configured reasoning.budgetTokens because reasoning is explicitly disabled',
        metadata: {
          provider: 'openai',
          model: 'test-reasoning-model',
          selectedFormat: 'anthropic-budget',
          setting: 'reasoning.budgetTokens',
          reason: 'reasoning-disabled',
        },
      },
      {
        message:
          "OpenAI Chat omitted configured reasoning.enabled because the enabled format is set to 'none'",
        metadata: {
          provider: 'openai',
          model: 'test-reasoning-model',
          selectedFormat: 'none',
          setting: 'reasoning.enabled',
          reason: 'enabled-format-none',
        },
      },
    ]);
  });
  it.each([
    ['reasoning', { effort: 'max' }],
    ['thinking', { type: 'disabled' }],
    ['reasoning_effort', 'minimal'],
    ['parse_reasoning', true],
  ])(
    'keeps explicit top-level %s authoritative without warnings',
    async (key, value) => {
      const { body, logger } = await prepare({
        baseURL: 'https://api.z.ai/api/paas/v4',
        modelBehavior: {
          'reasoning.enabled': true,
          'reasoning.effort': 'high',
        },
        modelParams: { [key]: value },
      });

      expect(reasoningFields(body)).toStrictEqual({ [key]: value });
      expect(logger.warnings).toStrictEqual([]);
    },
  );

  it.each([
    ['reasoning_effort', 'low'],
    ['enable_thinking', false],
  ])(
    'keeps explicit nested template kwarg %s authoritative',
    async (key, value) => {
      const { body, logger } = await prepare({
        baseURL: 'http://localhost:8000/v1',
        modelBehavior: {
          'reasoning.enabled': true,
          'reasoning.effort': 'high',
          'reasoning.enabledWireFormat': 'template-kwargs',
          'reasoning.effortWireFormat': 'template-kwargs',
        },
        modelParams: {
          chat_template_kwargs: { tokenize: false, [key]: value },
        },
      });

      expect(reasoningFields(body)).toStrictEqual({
        chat_template_kwargs: { tokenize: false, [key]: value },
      });
      expect(logger.warnings).toStrictEqual([]);
    },
  );

  it('keeps explicit nested output_config.effort authoritative without warnings', async () => {
    const { body, logger } = await prepare({
      baseURL: 'https://api.z.ai/api/paas/v4',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
      },
      modelParams: { output_config: { effort: 'low' } },
    });

    expect(reasoningFields(body)).toStrictEqual({
      output_config: { effort: 'low' },
    });
    expect(logger.warnings).toStrictEqual([]);
  });

  it('keeps generic translation active when output_config has only unrelated siblings', async () => {
    const { body } = await prepare({
      baseURL: 'http://localhost:8000/v1',
      modelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'openai',
      },
      modelParams: { output_config: { service_hint: 'preserved' } },
    });

    expect(reasoningFields(body)).toStrictEqual({
      output_config: { service_hint: 'preserved' },
      reasoning_effort: 'high',
    });
  });

  it('fails fast on a malformed runtime effort map', async () => {
    const preparation = prepare({
      baseURL: 'http://localhost:8000/v1',
      rawModelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'openai',
        'reasoning.effortMap': ['high'],
      },
    });

    await expect(preparation).rejects.toThrow(
      'reasoning.effortMap must be a JSON object',
    );
  });

  it('fails fast when a narrowed map is incompatible with its selected format', async () => {
    const preparation = prepare({
      baseURL: 'http://localhost:8000/v1',
      rawModelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'openai',
        'reasoning.effortMap': { high: 8192 },
      },
    });

    await expect(preparation).rejects.toThrow(
      'reasoning.effortMap.high must be a string for openai',
    );
  });

  it('fails fast on a malformed runtime enabled map', async () => {
    const preparation = prepare({
      baseURL: 'http://localhost:8000/v1',
      rawModelBehavior: {
        'reasoning.enabled': true,
        'reasoning.enabledWireFormat': 'thinking',
        'reasoning.enabledMap': { sometimes: 'enabled' },
      },
    });

    await expect(preparation).rejects.toThrow(
      "reasoning.enabledMap contains unsupported key 'sometimes'",
    );
  });

  it('normalizes surrounding whitespace in alias map values', async () => {
    const { body } = await prepare({
      baseURL: 'http://localhost:8000/v1',
      rawModelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'openai',
        'reasoning.enabled': true,
        'reasoning.enabledWireFormat': 'thinking',
        'reasoning.effortMap': { high: ' max ' },
        'reasoning.enabledMap': { true: ' enabled ' },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      reasoning_effort: 'max',
      thinking: { type: 'enabled' },
    });
  });

  it('fails before transport when an alias map value is whitespace only', async () => {
    const preparation = prepare({
      baseURL: 'http://localhost:8000/v1',
      rawModelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'openai',
        'reasoning.effortMap': { high: '   ' },
      },
    });

    await expect(preparation).rejects.toThrow(
      'reasoning.effortMap values must be non-empty strings, integer budgets of at least 1024, or null',
    );
  });

  it('fails before transport when an alias effort map is a Map instance', async () => {
    const preparation = prepare({
      baseURL: 'http://localhost:8000/v1',
      rawModelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'openai',
        'reasoning.effortMap': new Map([['high', 'max']]),
      },
    });

    await expect(preparation).rejects.toThrow(
      'reasoning.effortMap must be a JSON object',
    );
  });

  it('fails before transport when an alias effort map is a class instance', async () => {
    class AliasedEffortMap {
      readonly high = 'max';
    }
    const preparation = prepare({
      baseURL: 'http://localhost:8000/v1',
      rawModelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'openai',
        'reasoning.effortMap': new AliasedEffortMap(),
      },
    });

    await expect(preparation).rejects.toThrow(
      'reasoning.effortMap must be a JSON object',
    );
  });

  it('fails before transport when an alias enabled map is a Map instance', async () => {
    const preparation = prepare({
      baseURL: 'http://localhost:8000/v1',
      rawModelBehavior: {
        'reasoning.enabled': true,
        'reasoning.enabledWireFormat': 'thinking',
        'reasoning.enabledMap': new Map([['true', 'enabled']]),
      },
    });

    await expect(preparation).rejects.toThrow(
      'reasoning.enabledMap must be a JSON object',
    );
  });

  it.each([
    {
      setting: 'reasoning.enabled',
      value: 'true',
      expected: 'reasoning.enabled must be a boolean',
    },
    {
      setting: 'reasoning.effort',
      value: 'ultra',
      expected: "reasoning.effort must be one of 'minimal'",
    },
    {
      setting: 'reasoning.budgetTokens',
      value: 0,
      expected: 'reasoning.budgetTokens must be a positive integer',
    },
    {
      setting: 'reasoning.effortWireFormat',
      value: 'custom',
      expected: "reasoning.effortWireFormat must be one of 'auto'",
    },
    {
      setting: 'reasoning.enabledWireFormat',
      value: 'custom',
      expected: "reasoning.enabledWireFormat must be one of 'auto'",
    },
  ] satisfies ReadonlyArray<{
    readonly setting: string;
    readonly value: unknown;
    readonly expected: string;
  }>)(
    'fails fast on invalid runtime $setting values',
    async ({ setting, value, expected }) => {
      const preparation = prepare({
        baseURL: 'http://localhost:8000/v1',
        rawModelBehavior: { [setting]: value },
      });

      await expect(preparation).rejects.toThrow(expected);
    },
  );

  it('propagates incompatible selector errors before returning a request', async () => {
    const preparation = prepare({
      baseURL: 'http://localhost:8000/v1',
      modelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'openai-responses',
      },
    });

    await expect(preparation).rejects.toThrow(
      "effort wire format 'openai-responses' is incompatible with the openai-chat adapter",
    );
  });

  it('routes built-in OpenAI GPT-5.6 alias defaults through a custom Chat URL without a transport-specific selector', async () => {
    const { body, logger } = await prepare({
      baseURL: 'http://localhost:8000/v1',
      model: 'gpt-5.6',
      modelBehavior: builtinAliasModelBehavior('openai', 'gpt-5.6'),
    });

    expect(reasoningFields(body)).toStrictEqual({});
    expect(logger.warnings).toStrictEqual([
      {
        message:
          'OpenAI Chat omitted configured reasoning.effort because the effort format could not be detected for this endpoint',
        metadata: {
          provider: 'openai',
          model: 'gpt-5.6',
          selectedFormat: 'none',
          setting: 'reasoning.effort',
          reason: 'effort-format-undetected',
        },
      },
      {
        message:
          'OpenAI Chat omitted configured reasoning.enabled because the enabled format could not be detected for this endpoint',
        metadata: {
          provider: 'openai',
          model: 'gpt-5.6',
          selectedFormat: 'none',
          setting: 'reasoning.enabled',
          reason: 'enabled-format-undetected',
        },
      },
    ]);
  });

  it('attributes suppressed alias reasoning to the resolved provider name', async () => {
    const { body, logger } = await prepare({
      providerName: 'kimi',
      baseURL: 'https://api.kimi.com/coding/v1',
      model: 'kimi-for-coding',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'none',
        'reasoning.enabledWireFormat': 'thinking',
        'reasoning.enabledMap': { true: 'enabled' },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled' },
    });
    expect(logger.warnings).toStrictEqual([
      {
        message:
          "OpenAI Chat omitted configured reasoning.effort because the effort format is set to 'none'",
        metadata: {
          provider: 'kimi',
          model: 'kimi-for-coding',
          selectedFormat: 'none',
          setting: 'reasoning.effort',
          reason: 'effort-format-none',
        },
      },
    ]);
    expect(JSON.stringify(logger.warnings)).not.toContain('api.kimi.com');
  });

  it('sends the built-in Kimi K3 alias defaults as one top-level effort field', async () => {
    const { body, logger } = await prepare({
      providerName: 'kimi',
      baseURL: 'https://api.kimi.com/coding/v1',
      model: 'kimi-k3',
      modelBehavior: builtinAliasModelBehavior('kimi', 'kimi-k3'),
    });

    expect(reasoningFields(body)).toStrictEqual({
      reasoning_effort: 'max',
    });
    expect(logger.warnings).toStrictEqual([]);
  });

  it('sends the built-in Kimi K2.7 alias defaults as enabled thinking without effort', async () => {
    const { body, logger } = await prepare({
      providerName: 'kimi',
      baseURL: 'https://api.kimi.com/coding/v1',
      model: 'kimi-for-coding',
      modelBehavior: builtinAliasModelBehavior('kimi', 'kimi-for-coding'),
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled' },
    });
    expect(logger.warnings).toStrictEqual([]);
  });

  it('reports only own reasoning properties and ignores inherited ones', () => {
    const body: Record<string, unknown> = Object.create({
      reasoning_effort: 'inherited',
    });
    body['thinking'] = { type: 'enabled' };
    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled' },
    });
  });
});
