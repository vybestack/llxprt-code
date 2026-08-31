/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { RuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { loadProviderAliasEntries } from '../composition/providerAliases.js';
import { computeModelDefaults } from '../runtime/providerMutations.js';
import { prepareAnthropicRequest } from './AnthropicRequestPreparation.js';

const PROVIDER_NAME = 'anthropic';
const BASE_URL = 'https://api.anthropic.com';

interface WarningEntry {
  readonly message: string;
  readonly metadata: unknown;
}

class RecordingDebugLogger extends DebugLogger {
  readonly warnings: WarningEntry[] = [];

  override warn(
    messageOrFn: string | (() => string),
    ...args: unknown[]
  ): void {
    this.warnings.push({
      message: typeof messageOrFn === 'function' ? messageOrFn() : messageOrFn,
      metadata: args.length === 1 ? args[0] : args,
    });
  }
}

interface RequestFixture {
  readonly model?: string;
  readonly baseURL?: string;
  readonly modelBehavior?: Readonly<Record<string, unknown>>;
  readonly rawModelBehavior?: Readonly<Record<string, unknown>>;
  readonly modelParams?: Readonly<Record<string, unknown>>;
  readonly rawModelParams?: Readonly<Record<string, unknown>>;
}

interface PreparedFixture {
  readonly body: Record<string, unknown>;
  readonly logger: RecordingDebugLogger;
}

function replaceInvocationInputs(
  invocation: RuntimeInvocationContext,
  fixture: RequestFixture,
): RuntimeInvocationContext {
  return {
    ...invocation,
    modelBehavior: fixture.rawModelBehavior ?? invocation.modelBehavior,
    modelParams: fixture.rawModelParams ?? invocation.modelParams,
  } satisfies RuntimeInvocationContext;
}

async function prepare(fixture: RequestFixture): Promise<PreparedFixture> {
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(fixture.modelBehavior ?? {})) {
    settings.set(key, value);
  }
  for (const [key, value] of Object.entries(fixture.modelParams ?? {})) {
    settings.setProviderSetting(PROVIDER_NAME, key, value);
  }

  const resolved: NormalizedGenerateChatOptions['resolved'] = {
    model: fixture.model ?? 'claude-opus-5',
    baseURL: fixture.baseURL ?? BASE_URL,
    authToken: 'test-token',
  };
  const callOptions = createProviderCallOptions({
    providerName: PROVIDER_NAME,
    settings,
    resolved,
    contents: [
      { speaker: 'human', blocks: [{ type: 'text', text: 'test request' }] },
    ],
  });
  const options = {
    ...callOptions,
    metadata: callOptions.metadata ?? {},
    resolved,
    invocation: replaceInvocationInputs(callOptions.invocation, fixture),
  } satisfies NormalizedGenerateChatOptions;
  const logger = new RecordingDebugLogger(
    'llxprt:providers:anthropic:issue3255-test',
  );
  const context = await prepareAnthropicRequest({
    content: options.contents,
    tools: options.tools,
    options,
    isOAuth: false,
    placement: 'system-field',
    providerName: PROVIDER_NAME,
    config: options.config,
    getMaxTokensForModel: () => 32000,
    unprefixToolName: (name: string) => name,
    providerConfig: undefined,
    logger,
    toolsLogger: new DebugLogger(
      'llxprt:providers:anthropic:issue3255-test:tools',
    ),
    cacheLogger: { debug: () => undefined },
  });
  return { body: context.requestBody, logger };
}

function reasoningFields(
  body: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ['thinking', 'output_config', 'reasoning_effort']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      result[key] = body[key];
    }
  }
  return result;
}

interface AliasRequestFixture {
  readonly model: string;
  readonly baseURL: string;
  readonly modelBehavior: Readonly<Record<string, unknown>>;
}

function builtInZaiRequestFixture(): AliasRequestFixture {
  const aliasEntry = loadProviderAliasEntries().find(
    (candidate) => candidate.source === 'builtin' && candidate.alias === 'zai',
  );
  if (aliasEntry === undefined) {
    throw new Error('Builtin zai alias entry not found');
  }
  const model = aliasEntry.config.defaultModel;
  if (typeof model !== 'string' || model === '') {
    throw new Error('Builtin zai alias entry must declare a default model');
  }
  const baseURL = aliasEntry.config['base-url'];
  if (typeof baseURL !== 'string') {
    throw new Error('Builtin zai alias entry must declare a base URL');
  }
  return {
    model,
    baseURL,
    modelBehavior: {
      ...aliasEntry.config.ephemeralSettings,
      ...computeModelDefaults(model, aliasEntry.config.modelDefaults ?? []),
    },
  };
}
describe('Anthropic reasoning wire translation (issue #3255)', () => {
  it('emits adaptive Opus 5 thinking and native effort without a budget', async () => {
    const { body } = await prepare({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
    });
  });

  it('applies an effort map before Opus 5 effort normalization', async () => {
    const { body } = await prepare({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'minimal',
        'reasoning.effortMap': { minimal: 'low' },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'low' },
    });
  });

  it('emits an explicit GLM-5.2 minimal map as native minimal effort', async () => {
    const { body } = await prepare({
      model: 'glm-5.2',
      baseURL: 'https://api.z.ai/api/anthropic',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'minimal',
        'reasoning.enabledWireFormat': 'thinking',
        'reasoning.enabledMap': { true: 'enabled' },
        'reasoning.effortWireFormat': 'anthropic',
        'reasoning.effortMap': { minimal: 'minimal' },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled' },
      output_config: { effort: 'minimal' },
    });
  });

  it('normalizes unmapped generic minimal to low for native Claude', async () => {
    const { body } = await prepare({
      model: 'claude-opus-5',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'minimal',
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'low' },
    });
  });

  it('emits disabled thinking for Opus 5 and suppresses effort', async () => {
    const { body } = await prepare({
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.effort': 'high',
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'disabled' },
    });
  });

  it('warns separately for dropped effort and budget when disabled', async () => {
    const { body, logger } = await prepare({
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.effort': 'high',
        'reasoning.budgetTokens': 6000,
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'disabled' },
    });
    expect(logger.warnings).toStrictEqual([
      {
        message:
          "Anthropic omitted configured reasoning.effort because effort format 'anthropic' cannot emit it",
        metadata: {
          providerName: PROVIDER_NAME,
          model: 'claude-opus-5',
          format: 'anthropic',
          setting: 'reasoning.effort',
          reason: 'reasoning-disabled',
        },
      },
      {
        message:
          "Anthropic omitted configured reasoning.budgetTokens because budget format 'anthropic' cannot emit it",
        metadata: {
          providerName: PROVIDER_NAME,
          model: 'claude-opus-5',
          format: 'anthropic',
          setting: 'reasoning.budgetTokens',
          reason: 'reasoning-disabled',
        },
      },
    ]);
  });

  it('preserves direct legacy budget behavior under auto selection', async () => {
    const { body } = await prepare({
      model: 'claude-sonnet-4-5-20250929',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.budgetTokens': 12000,
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled', budget_tokens: 12000 },
    });
  });

  it('uses a numeric effort map for explicit anthropic-budget selection', async () => {
    const { body } = await prepare({
      model: 'claude-sonnet-4-5-20250929',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'anthropic-budget',
        'reasoning.effortMap': { high: 8192 },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled', budget_tokens: 8192 },
    });
  });

  it('does not fabricate a budget for explicit anthropic-budget selection', async () => {
    const { body, logger } = await prepare({
      model: 'claude-sonnet-4-5-20250929',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'anthropic-budget',
      },
    });

    expect(reasoningFields(body)).toStrictEqual({});
    expect(logger.warnings).toContainEqual({
      message:
        "Anthropic omitted configured reasoning.effort because effort format 'anthropic-budget' cannot emit it",
      metadata: {
        providerName: PROVIDER_NAME,
        model: 'claude-sonnet-4-5-20250929',
        format: 'anthropic-budget',
        setting: 'reasoning.effort',
        reason: 'numeric-effort-map-required',
      },
    });
  });

  it('expresses Z.AI GLM-5.3 native thinking and effort through explicit settings', async () => {
    const { body } = await prepare({
      model: 'glm-5.3',
      baseURL: 'https://api.z.ai/api/anthropic?token=do-not-log',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.enabledWireFormat': 'thinking',
        'reasoning.enabledMap': { true: 'enabled' },
        'reasoning.effortWireFormat': 'anthropic',
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled' },
      output_config: { effort: 'high' },
    });
  });

  it('applies an explicit GLM effort remap without a budget representation', async () => {
    const { body } = await prepare({
      model: 'glm-5.3',
      baseURL: 'https://api.z.ai/api/anthropic',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'medium',
        'reasoning.enabledWireFormat': 'thinking',
        'reasoning.enabledMap': { true: 'enabled' },
        'reasoning.effortWireFormat': 'anthropic',
        'reasoning.effortMap': { medium: 'high' },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled' },
      output_config: { effort: 'high' },
    });
  });

  it.each([
    {
      setting: 'reasoning.effortWireFormat',
      settingValue: 'none',
      extra: {},
      reason: 'effort-format-none',
      format: 'none',
    },
    {
      setting: 'reasoning.effortMap',
      settingValue: { high: null },
      extra: {},
      reason: 'effort-map-null',
      format: 'anthropic',
    },
  ] satisfies ReadonlyArray<{
    readonly setting: string;
    readonly settingValue: unknown;
    readonly extra: Readonly<Record<string, unknown>>;
    readonly reason: string;
    readonly format: string;
  }>)(
    'omits effort and warns for $reason',
    async ({ setting, settingValue, extra, reason, format }) => {
      const { body, logger } = await prepare({
        model: 'claude-opus-5',
        baseURL: 'https://api.anthropic.com?token=do-not-log',
        modelBehavior: {
          'reasoning.enabled': true,
          'reasoning.effort': 'high',
          [setting]: settingValue,
          ...extra,
        },
      });

      expect(body['output_config']).toBeUndefined();
      expect(logger.warnings).toContainEqual({
        message: `Anthropic omitted configured reasoning.effort because effort format '${format}' cannot emit it`,
        metadata: {
          providerName: PROVIDER_NAME,
          model: 'claude-opus-5',
          format,
          setting: 'reasoning.effort',
          reason,
        },
      });
      expect(JSON.stringify(logger.warnings)).not.toContain('do-not-log');
    },
  );

  it('preserves explicit thinking and makes all generic injection stand down', async () => {
    const explicitThinking = {
      type: 'enabled',
      budget_tokens: 4096,
      provider_extension: 'preserved',
    };
    const { body, logger } = await prepare({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
      },
      modelParams: { thinking: explicitThinking },
    });

    expect(reasoningFields(body)).toStrictEqual({ thinking: explicitThinking });
    expect(logger.warnings).toStrictEqual([]);
  });

  it('passes an explicit future thinking type through unchanged and stands down', async () => {
    const explicitThinking = {
      type: 'priority',
      priority_tier: 'maximum',
      budget_tokens_hint: 8192,
    };
    const { body, logger } = await prepare({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
      },
      modelParams: { thinking: explicitThinking },
    });

    expect(reasoningFields(body)).toStrictEqual({ thinking: explicitThinking });
    expect(logger.warnings).toStrictEqual([]);
  });

  it('preserves explicit output_config effort and makes all generic injection stand down', async () => {
    const explicitOutputConfig = { effort: 'low', service_hint: 'preserved' };
    const { body, logger } = await prepare({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
      },
      modelParams: { output_config: explicitOutputConfig },
    });

    expect(reasoningFields(body)).toStrictEqual({
      output_config: explicitOutputConfig,
    });
    expect(logger.warnings).toStrictEqual([]);
  });

  it('merges translated effort into unrelated output_config siblings', async () => {
    const { body } = await prepare({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'medium',
      },
      modelParams: { output_config: { service_hint: 'preserved' } },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { service_hint: 'preserved', effort: 'medium' },
    });
  });

  it.each([
    ['thinking', null, 'thinking must be an object'],
    ['thinking', [], 'thinking must be an object'],
    [
      'thinking',
      { budget_tokens: 4096 },
      'thinking.type must be a non-empty string',
    ],
    ['output_config', 'high', 'output_config must be an object'],
    [
      'output_config',
      { effort: 3 },
      'output_config.effort must be a non-empty string',
    ],
  ] satisfies ReadonlyArray<readonly [string, unknown, string]>)(
    'fails before transport for malformed explicit %s',
    async (setting, value, message) => {
      const request = prepare({ rawModelParams: { [setting]: value } });

      await expect(request).rejects.toThrow(message);
    },
  );

  it('fails before transport for an incompatible selector', async () => {
    const request = prepare({
      modelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'openrouter',
      },
    });

    await expect(request).rejects.toThrow(
      "effort wire format 'openrouter' is incompatible with the anthropic adapter",
    );
  });

  it('fails before transport for an invalid mapped type', async () => {
    const request = prepare({
      rawModelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'anthropic',
        'reasoning.effortMap': { high: 8192 },
      },
    });

    await expect(request).rejects.toThrow(
      'reasoning.effortMap.high must be a string for anthropic',
    );
  });

  it('emits native effort when effort is configured without enablement', async () => {
    const { body } = await prepare({
      modelBehavior: { 'reasoning.effort': 'medium' },
    });

    expect(reasoningFields(body)).toStrictEqual({
      output_config: { effort: 'medium' },
    });
  });

  it('emits an anthropic-budget numeric map without redundant enablement input', async () => {
    const { body } = await prepare({
      model: 'claude-sonnet-4-5-20250929',
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

  it('omits unsupported Sonnet 5 disablement and warns without leaking endpoint data', async () => {
    const { body, logger } = await prepare({
      model: 'claude-sonnet-5',
      baseURL: 'https://api.anthropic.com?token=do-not-log',
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.effort': 'high',
      },
    });

    expect(reasoningFields(body)).toStrictEqual({});
    expect(logger.warnings).toContainEqual({
      message:
        "Anthropic omitted configured reasoning.enabled because enabled format 'thinking' cannot emit it",
      metadata: {
        providerName: PROVIDER_NAME,
        model: 'claude-sonnet-5',
        format: 'thinking',
        setting: 'reasoning.enabled',
        reason: 'model-cannot-disable-thinking',
      },
    });
    expect(JSON.stringify(logger.warnings)).not.toContain('do-not-log');
  });

  it('treats a vendor-prefixed claude-sonnet-5 id as a non-adaptive compat model', async () => {
    const { body } = await prepare({
      model: 'vendor-claude-sonnet-5',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effortWireFormat': 'anthropic',
        'reasoning.enabledWireFormat': 'thinking',
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled' },
    });
  });

  it('lets an explicit adaptive enabled map override adaptiveThinking=false', async () => {
    const { body } = await prepare({
      model: 'claude-opus-5',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.adaptiveThinking': false,
        'reasoning.enabledWireFormat': 'thinking',
        'reasoning.enabledMap': { true: 'adaptive' },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'adaptive', display: 'summarized' },
    });
  });

  it.each([
    ['reasoning.enabled', 'true', 'reasoning.enabled must be a boolean'],
    ['reasoning.effort', 'ultra', "reasoning.effort must be one of 'minimal'"],
    [
      'reasoning.budgetTokens',
      0,
      'reasoning.budgetTokens must be a positive integer',
    ],
    [
      'reasoning.adaptiveThinking',
      'false',
      'reasoning.adaptiveThinking must be a boolean',
    ],
    [
      'reasoning.enabledWireFormat',
      'custom',
      "reasoning.enabledWireFormat must be one of 'auto'",
    ],
    ['reasoning.effortMap', [], 'reasoning.effortMap must be a JSON object'],
    ['reasoning.enabledMap', [], 'reasoning.enabledMap must be a JSON object'],
  ] satisfies ReadonlyArray<readonly [string, unknown, string]>)(
    'strictly rejects malformed invocation behavior for %s',
    async (setting, value, expected) => {
      const request = prepare({ rawModelBehavior: { [setting]: value } });

      await expect(request).rejects.toThrow(expected);
    },
  );

  it('fails before transport when Opus 5 disables adaptive thinking without a budget', async () => {
    const request = prepare({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.adaptiveThinking': false,
      },
    });

    await expect(request).rejects.toThrow(
      "Model 'claude-opus-5' supports adaptive thinking: budgeted thinking requires an explicit reasoning.budgetTokens",
    );
  });

  it('fails before transport for an explicit enabled map without a budget on an adaptive model', async () => {
    const request = prepare({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.adaptiveThinking': false,
        'reasoning.enabledWireFormat': 'thinking',
        'reasoning.enabledMap': { true: 'enabled' },
      },
    });

    await expect(request).rejects.toThrow(
      "Model 'claude-opus-5' supports adaptive thinking: budgeted thinking requires an explicit reasoning.budgetTokens",
    );
  });

  it('keeps a directly configured Opus 5 budget authoritative in manual mode', async () => {
    const { body } = await prepare({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.adaptiveThinking': false,
        'reasoning.budgetTokens': 6000,
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled', budget_tokens: 6000 },
    });
  });

  it('selects manual budgeted thinking when a direct budget meets an adaptive enabled map', async () => {
    const { body } = await prepare({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.budgetTokens': 6000,
        'reasoning.effortWireFormat': 'anthropic',
        'reasoning.enabledWireFormat': 'thinking',
        'reasoning.enabledMap': { true: 'adaptive' },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled', budget_tokens: 6000 },
      output_config: { effort: 'high' },
    });
  });

  it('rejects a direct Fable 5 budget before transport instead of ignoring it', async () => {
    const request = prepare({
      model: 'claude-fable-5',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.budgetTokens': 6000,
        'reasoning.effortWireFormat': 'anthropic',
        'reasoning.enabledWireFormat': 'thinking',
        'reasoning.enabledMap': { true: 'adaptive' },
      },
    });

    await expect(request).rejects.toThrow(
      "Model 'claude-fable-5' is adaptive-only: reasoning.budgetTokens cannot select budgeted thinking. Remove reasoning.budgetTokens to use adaptive thinking.",
    );
  });

  it('preserves Fable 5 always-adaptive behavior without duplicate representations', async () => {
    const { body } = await prepare({
      model: 'claude-fable-5',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'medium',
        'reasoning.budgetTokens': 8000,
        'reasoning.adaptiveThinking': false,
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'medium' },
    });
  });

  it('rejects an anthropic-budget selection for Fable 5 before transport', async () => {
    const request = prepare({
      model: 'claude-fable-5',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'anthropic-budget',
        'reasoning.effortMap': { high: 8192 },
      },
    });

    await expect(request).rejects.toThrow(
      "Model 'claude-fable-5' is adaptive-only: the anthropic-budget effort format cannot emit budgeted thinking. Use the 'anthropic' effort format or remove reasoning.effortWireFormat=anthropic-budget.",
    );
  });

  it('reports only own reasoning properties and ignores inherited ones', () => {
    const body: Record<string, unknown> = Object.create({
      reasoning_effort: 'inherited',
    });
    body['thinking'] = { type: 'enabled' };

    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled' },
    });

    body['reasoning_effort'] = 'own';
    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'own',
    });
  });

  it('sends the built-in zai alias default model through the final request without a fabricated budget', async () => {
    const fixture = builtInZaiRequestFixture();

    const { body } = await prepare(fixture);

    expect(fixture.model).toBe('glm-5.3');
    expect(reasoningFields(body)).toStrictEqual({
      thinking: { type: 'enabled' },
      output_config: { effort: 'high' },
    });
    expect(JSON.stringify(body)).not.toContain('budget_tokens');
  });
});
