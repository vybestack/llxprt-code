/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { NormalizedGenerateChatOptions } from '../../BaseProvider.js';
import { buildRequestConfig } from '../geminiRequestBuilding.js';
import { extractReasoningConfig } from '../geminiReasoningConfig.js';

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

interface GeminiFixture {
  readonly model?: string;
  readonly modelBehavior?: Readonly<Record<string, unknown>>;
  readonly rawModelBehavior?: Readonly<Record<string, unknown>>;
  readonly modelParams?: Readonly<Record<string, unknown>>;
  readonly legacyEphemerals?: Readonly<Record<string, unknown>>;
}

function createOptions(fixture: GeminiFixture): NormalizedGenerateChatOptions {
  const settings = new SettingsService();
  const ephemeralsSnapshot = {
    ...(fixture.legacyEphemerals ?? {}),
    ...(fixture.modelBehavior ?? {}),
    gemini: { ...(fixture.modelParams ?? {}) },
  };
  const runtime = createProviderRuntimeContext({
    runtimeId: 'gemini-issue3255-test',
    settingsService: settings,
  });
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: 'gemini',
    ephemeralsSnapshot,
  });
  const effectiveInvocation =
    fixture.rawModelBehavior === undefined
      ? invocation
      : {
          ...invocation,
          modelBehavior: fixture.rawModelBehavior,
        };

  return {
    contents: [],
    tools: undefined,
    metadata: {},
    settings,
    invocation: effectiveInvocation,
    systemInstruction: 'test system prompt',
    resolved: {
      model: fixture.model ?? 'gemini-3-flash-preview',
      authToken: 'test-token',
    },
  } satisfies NormalizedGenerateChatOptions;
}

interface BuiltFixture {
  readonly config: Record<string, unknown>;
  readonly logger: RecordingDebugLogger;
}

function build(fixture: GeminiFixture): BuiltFixture {
  const options = createOptions(fixture);
  const logger = new RecordingDebugLogger(
    'llxprt:gemini:provider:issue3255-test',
  );
  return {
    config: buildRequestConfig(
      options,
      undefined,
      extractReasoningConfig(options),
      options.resolved.model,
      logger,
    ),
    logger,
  };
}

function buildConfig(fixture: GeminiFixture): Record<string, unknown> {
  return build(fixture).config;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error('expected a record');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function thinkingConfig(
  config: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  const value = config['thinkingConfig'];
  return value === undefined ? undefined : readRecord(value);
}

describe('Gemini issue 3255 reasoning request translation', () => {
  it('retains Gemini 3 generic effort mapping under auto selectors', () => {
    const config = buildConfig({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'medium',
      },
    });

    expect(thinkingConfig(config)).toStrictEqual({
      includeThoughts: true,
      thinkingLevel: 'MEDIUM',
    });
  });

  it('applies a profile effort remap before Gemini 3 level mapping', () => {
    const config = buildConfig({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.effortMap': { high: 'low' },
      },
    });

    expect(thinkingConfig(config)).toStrictEqual({
      includeThoughts: true,
      thinkingLevel: 'LOW',
    });
  });

  it('accepts an explicitly mapped native Gemini 3 level', () => {
    const config = buildConfig({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'gemini',
        'reasoning.effortMap': { high: 'LOW' },
      },
    });

    expect(thinkingConfig(config)).toStrictEqual({
      includeThoughts: true,
      thinkingLevel: 'LOW',
    });
  });

  it('suppresses effort selected as none while retaining enabled thinking', () => {
    const config = buildConfig({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'none',
      },
    });

    expect(thinkingConfig(config)).toStrictEqual({ includeThoughts: true });
  });

  it('suppresses a null effort map entry while retaining enabled thinking', () => {
    const config = buildConfig({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.effortMap': { high: null },
      },
    });

    expect(thinkingConfig(config)).toStrictEqual({ includeThoughts: true });
  });

  it.each([
    ['none', undefined, 'effort-format-none'],
    ['auto', { high: null }, 'effort-map-null'],
  ])(
    'warns when Gemini effort is suppressed by %s configuration',
    (effortWireFormat, effortMap, reason) => {
      const result = build({
        modelBehavior: {
          'reasoning.enabled': true,
          'reasoning.effort': 'high',
          'reasoning.effortWireFormat': effortWireFormat,
          ...(effortMap === undefined
            ? {}
            : { 'reasoning.effortMap': effortMap }),
        },
      });

      expect(result.logger.warnings).toStrictEqual([
        {
          message: `Gemini omitted configured reasoning.effort for model gemini-3-flash-preview using format '${effortWireFormat === 'none' ? 'none' : 'gemini'}' because ${reason}`,
          metadata: {
            provider: 'gemini',
            model: 'gemini-3-flash-preview',
            format: effortWireFormat === 'none' ? 'none' : 'gemini',
            genericSetting: 'reasoning.effort',
            reason,
          },
        },
      ]);
    },
  );

  it('enables Gemini 3 thinking without forcing a level when effort is absent', () => {
    const config = buildConfig({
      modelBehavior: { 'reasoning.enabled': true },
    });

    expect(thinkingConfig(config)).toStrictEqual({ includeThoughts: true });
  });

  it('omits translated Gemini 3 thinking when default disablement is unrepresentable', () => {
    const config = buildConfig({
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.effort': 'high',
        'reasoning.maxTokens': 4096,
      },
    });

    expect(thinkingConfig(config)).toBeUndefined();
  });

  it('warns with safe context when Gemini 3 disablement cannot be represented', () => {
    const result = build({
      model: 'gemini-3-pro-preview',
      modelBehavior: { 'reasoning.enabled': false },
    });

    expect(result.logger.warnings).toStrictEqual([
      {
        message:
          "Gemini omitted configured reasoning.enabled for model gemini-3-pro-preview using format 'gemini' because gemini-3-disablement-unrepresentable",
        metadata: {
          provider: 'gemini',
          model: 'gemini-3-pro-preview',
          format: 'gemini',
          genericSetting: 'reasoning.enabled',
          reason: 'gemini-3-disablement-unrepresentable',
        },
      },
    ]);
  });

  it('uses an explicit supported native level to represent Gemini 3 disablement', () => {
    const config = buildConfig({
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.enabledMap': { false: 'LOW' },
      },
    });

    expect(thinkingConfig(config)).toStrictEqual({
      includeThoughts: true,
      thinkingLevel: 'LOW',
    });
  });

  it('emits Gemini 2 thinking budget when reasoning is enabled', () => {
    const config = buildConfig({
      model: 'gemini-2.5-pro',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.maxTokens': 4096,
      },
    });

    expect(thinkingConfig(config)).toStrictEqual({
      includeThoughts: true,
      thinkingBudget: 4096,
    });
  });

  it('emits thinkingBudget zero for default Gemini 2 disablement', () => {
    const config = buildConfig({
      model: 'gemini-2.5-flash',
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.maxTokens': 4096,
      },
    });

    expect(thinkingConfig(config)).toStrictEqual({ thinkingBudget: 0 });
  });

  it('warns that configured effort was suppressed when Gemini 2 is disabled', () => {
    const result = build({
      model: 'gemini-2.5-pro',
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.effort': 'high',
      },
    });

    expect(thinkingConfig(result.config)).toStrictEqual({
      thinkingBudget: 0,
    });
    expect(result.logger.warnings).toStrictEqual([
      {
        message:
          "Gemini omitted configured reasoning.effort for model gemini-2.5-pro using format 'gemini' because reasoning-disabled",
        metadata: {
          provider: 'gemini',
          model: 'gemini-2.5-pro',
          format: 'gemini',
          genericSetting: 'reasoning.effort',
          reason: 'reasoning-disabled',
        },
      },
    ]);
  });

  it('warns for suppressed effort and unrepresentable disablement when Gemini 3 is disabled', () => {
    const result = build({
      model: 'gemini-3-pro-preview',
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.effort': 'high',
      },
    });

    expect(thinkingConfig(result.config)).toBeUndefined();
    expect(result.logger.warnings).toStrictEqual([
      {
        message:
          "Gemini omitted configured reasoning.effort for model gemini-3-pro-preview using format 'gemini' because reasoning-disabled",
        metadata: {
          provider: 'gemini',
          model: 'gemini-3-pro-preview',
          format: 'gemini',
          genericSetting: 'reasoning.effort',
          reason: 'reasoning-disabled',
        },
      },
      {
        message:
          "Gemini omitted configured reasoning.enabled for model gemini-3-pro-preview using format 'gemini' because gemini-3-disablement-unrepresentable",
        metadata: {
          provider: 'gemini',
          model: 'gemini-3-pro-preview',
          format: 'gemini',
          genericSetting: 'reasoning.enabled',
          reason: 'gemini-3-disablement-unrepresentable',
        },
      },
    ]);
  });

  it('honors an enabled map that disables Gemini 2 thinking', () => {
    const config = buildConfig({
      model: 'gemini-2.5-pro',
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.maxTokens': 4096,
        'reasoning.enabledMap': { true: false },
      },
    });

    expect(thinkingConfig(config)).toStrictEqual({ thinkingBudget: 0 });
  });

  it.each(['gemini-2.5-pro', 'gemini-3-flash-preview'])(
    'keeps an explicit null disabled map entry as wire suppression for %s',
    (model) => {
      const config = buildConfig({
        model,
        modelBehavior: {
          'reasoning.enabled': false,
          'reasoning.effort': 'high',
          'reasoning.enabledWireFormat': 'gemini',
          'reasoning.enabledMap': { false: null },
        },
      });

      // Null suppression emits nothing on the wire; it must not degrade
      // into the default disablement form (thinkingBudget: 0).
      expect(config).not.toHaveProperty('thinkingConfig');
    },
  );

  it('preserves explicit native thinkingConfig exactly and adds no generic representation', () => {
    const explicit = {
      includeThoughts: false,
      thinkingBudget: 2048,
      customOption: { mode: 'user-selected' },
    };
    const result = build({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.maxTokens': 8192,
      },
      modelParams: { thinkingConfig: explicit },
    });

    expect({
      thinkingConfig: thinkingConfig(result.config),
      warnings: result.logger.warnings,
    }).toStrictEqual({ thinkingConfig: explicit, warnings: [] });
  });

  it('retains unrelated model parameters without suppressing generic translation', () => {
    const config = buildConfig({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'low',
      },
      modelParams: { temperature: 0.25 },
    });

    expect({
      temperature: config['temperature'],
      thinkingConfig: thinkingConfig(config),
    }).toStrictEqual({
      temperature: 0.25,
      thinkingConfig: {
        includeThoughts: true,
        thinkingLevel: 'LOW',
      },
    });
  });

  it('warns once when an unenabled effort is suppressed by a null map entry', () => {
    const { config, logger } = build({
      modelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortMap': { high: null },
      },
    });

    expect(config).not.toHaveProperty('thinkingConfig');
    expect(logger.warnings).toStrictEqual([
      {
        message:
          "Gemini omitted configured reasoning.effort for model gemini-3-flash-preview using format 'gemini' because effort-map-null",
        metadata: {
          provider: 'gemini',
          model: 'gemini-3-flash-preview',
          format: 'gemini',
          genericSetting: 'reasoning.effort',
          reason: 'effort-map-null',
        },
      },
    ]);
  });

  it('warns once when an unenabled effort is suppressed by a none selector', () => {
    const { logger } = build({
      modelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'none',
      },
    });

    expect(logger.warnings).toStrictEqual([
      {
        message:
          "Gemini omitted configured reasoning.effort for model gemini-3-flash-preview using format 'none' because effort-format-none",
        metadata: {
          provider: 'gemini',
          model: 'gemini-3-flash-preview',
          format: 'none',
          genericSetting: 'reasoning.effort',
          reason: 'effort-format-none',
        },
      },
    ]);
  });

  it('identifies the native Gemini adapter when unenabled maxTokens are dropped', () => {
    const { config, logger } = build({
      modelBehavior: { 'reasoning.maxTokens': 4096 },
    });

    expect(config).not.toHaveProperty('thinkingConfig');
    expect(logger.warnings).toStrictEqual([
      {
        message:
          "Gemini omitted configured reasoning.maxTokens for model gemini-3-flash-preview using format 'gemini' because reasoning-not-enabled",
        metadata: {
          provider: 'gemini',
          model: 'gemini-3-flash-preview',
          format: 'gemini',
          genericSetting: 'reasoning.maxTokens',
          reason: 'reasoning-not-enabled',
        },
      },
    ]);
  });

  it('identifies the native Gemini adapter when Gemini 3 maxTokens are dropped', () => {
    const { config, logger } = build({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.maxTokens': 4096,
      },
    });

    expect(config['thinkingConfig']).toStrictEqual({ includeThoughts: true });
    expect(logger.warnings).toStrictEqual([
      {
        message:
          "Gemini omitted configured reasoning.maxTokens for model gemini-3-flash-preview using format 'gemini' because gemini-3-max-tokens-unrepresentable",
        metadata: {
          provider: 'gemini',
          model: 'gemini-3-flash-preview',
          format: 'gemini',
          genericSetting: 'reasoning.maxTokens',
          reason: 'gemini-3-max-tokens-unrepresentable',
        },
      },
    ]);
  });

  it.each([
    ['reasoning.effortWireFormat', 'openai'],
    ['reasoning.enabledWireFormat', 'thinking'],
  ])('rejects incompatible Gemini selector %s', (setting, value) => {
    expect(() =>
      buildConfig({
        modelBehavior: {
          'reasoning.enabled': true,
          [setting]: value,
        },
      }),
    ).toThrow('is incompatible with the gemini adapter');
  });

  it.each([
    ['reasoning.enabled', 'yes', 'reasoning.enabled must be a boolean'],
    ['reasoning.effort', 'turbo', 'reasoning.effort must be one of'],
    [
      'reasoning.maxTokens',
      1.5,
      'reasoning.maxTokens must be a positive integer',
    ],
    ['reasoning.effortMap', [], 'reasoning.effortMap must be a JSON object'],
    [
      'reasoning.enabledMap',
      { maybe: true },
      "reasoning.enabledMap contains unsupported key 'maybe'",
    ],
  ])('rejects malformed invocation value for %s', (setting, value, message) => {
    expect(() =>
      buildConfig({ rawModelBehavior: { [setting]: value } }),
    ).toThrow(message);
  });

  it.each([
    ['TURBO', 'gemini-3-pro-preview'],
    ['LOW', 'gemini-2.5-pro'],
  ])(
    'rejects unsupported native mapped level %s for model %s',
    (mappedLevel, model) => {
      expect(() =>
        buildConfig({
          model,
          modelBehavior: {
            'reasoning.enabled': true,
            'reasoning.effort': 'high',
            'reasoning.effortMap': { high: mappedLevel },
          },
        }),
      ).toThrow('is not supported by the Gemini adapter');
    },
  );

  it('keeps legacy generic reasoning ephemerals as checked fallbacks', () => {
    const config = buildConfig({
      model: 'gemini-2.5-pro',
      legacyEphemerals: {
        reasoning: { enabled: true, maxTokens: 3072 },
      },
      rawModelBehavior: {},
    });

    expect(thinkingConfig(config)).toStrictEqual({
      includeThoughts: true,
      thinkingBudget: 3072,
    });
  });

  it('keeps an explicit effort authoritative over an enabled map native level', () => {
    const config = buildConfig({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'low',
        'reasoning.enabledWireFormat': 'gemini',
        'reasoning.enabledMap': { true: 'HIGH' },
      },
    });

    expect(thinkingConfig(config)).toStrictEqual({
      includeThoughts: true,
      thinkingLevel: 'LOW',
    });
  });

  it('keeps an explicit effort authoritative over an enabled map boolean false', () => {
    const config = buildConfig({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'low',
        'reasoning.enabledWireFormat': 'gemini',
        'reasoning.enabledMap': { true: false },
      },
    });

    expect(thinkingConfig(config)).toStrictEqual({
      includeThoughts: true,
      thinkingLevel: 'LOW',
    });
  });

  it('keeps an explicit effort remap authoritative over an enabled map native level', () => {
    const config = buildConfig({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'low',
        'reasoning.effortMap': { low: 'medium' },
        'reasoning.enabledWireFormat': 'gemini',
        'reasoning.enabledMap': { true: 'HIGH' },
      },
    });

    expect(thinkingConfig(config)).toStrictEqual({
      includeThoughts: true,
      thinkingLevel: 'MEDIUM',
    });
  });

  it('keeps a mapped enabled level when effort is absent', () => {
    const config = buildConfig({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.enabledWireFormat': 'gemini',
        'reasoning.enabledMap': { true: 'HIGH' },
      },
    });

    expect(thinkingConfig(config)).toStrictEqual({
      includeThoughts: true,
      thinkingLevel: 'HIGH',
    });
  });

  it('emits only one native reasoning representation', () => {
    const config = buildConfig({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'gemini',
        'reasoning.enabledWireFormat': 'gemini',
      },
    });
    const reasoningKeys = Object.keys(config).filter(
      (key) =>
        key.toLowerCase().includes('reasoning') || key === 'thinkingConfig',
    );

    expect(reasoningKeys).toStrictEqual(['thinkingConfig']);
  });

  it.each([
    ['a Map instance', new Map([['enabled', true]])],
    ['an array', ['enabled']],
    ['a Date instance', new Date(0)],
  ])('rejects a legacy reasoning ephemeral that is %s', (_label, value) => {
    expect(() =>
      buildConfig({
        legacyEphemerals: { reasoning: value },
        rawModelBehavior: {},
      }),
    ).toThrow('legacy reasoning ephemeral must be a JSON object');
  });

  it('rejects a legacy reasoning ephemeral that is a class instance', () => {
    class LegacyReasoningRecord {
      readonly enabled = true;
    }

    expect(() =>
      buildConfig({
        legacyEphemerals: { reasoning: new LegacyReasoningRecord() },
        rawModelBehavior: {},
      }),
    ).toThrow('legacy reasoning ephemeral must be a JSON object');
  });
});
