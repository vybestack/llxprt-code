/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type {
  ReasoningEffortMap,
  ReasoningEnabledMap,
} from '@vybestack/llxprt-code-settings';
import {
  resolveReasoningConfiguration,
  type ReasoningResolverInput,
  type ResolvedReasoningEffortWireFormat,
  type ResolvedReasoningEnabledWireFormat,
} from './reasoning-config-resolver.js';

const BASE_INPUT: ReasoningResolverInput = {
  nativeAdapter: 'openai-chat',
  effortWireFormat: 'auto',
  enabledWireFormat: 'auto',
  reasoning: {},
};

function resolve(
  overrides: Partial<ReasoningResolverInput> = {},
): ReturnType<typeof resolveReasoningConfiguration> {
  return resolveReasoningConfiguration({ ...BASE_INPUT, ...overrides });
}

function nativeAdapterForEnabledFormat(
  format: ReasoningResolverInput['enabledWireFormat'],
): ReasoningResolverInput['nativeAdapter'] {
  if (format === 'openai-responses') {
    return 'openai-responses';
  }
  return format === 'gemini' ? 'gemini' : 'openai-chat';
}

describe('reasoning configuration auto selection', () => {
  it.each([
    {
      nativeAdapter: 'openai-chat',
      chatBaseUrl: 'https://openrouter.ai/api/v1',
      effortFormat: 'openrouter',
      enabledFormat: 'openrouter',
    },
    {
      nativeAdapter: 'openai-chat',
      chatBaseUrl: 'https://api.z.ai/api/paas/v4',
      effortFormat: 'openai',
      enabledFormat: 'thinking',
    },
    {
      nativeAdapter: 'openai-chat',
      chatBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      effortFormat: 'openai',
      enabledFormat: 'thinking',
    },
    {
      nativeAdapter: 'openai-chat',
      chatBaseUrl: 'https://api.openai.com/v1',
      effortFormat: 'openai',
      enabledFormat: 'none',
    },
    {
      nativeAdapter: 'openai-responses',
      effortFormat: 'openai-responses',
      enabledFormat: 'none',
    },
    {
      nativeAdapter: 'anthropic',
      effortFormat: 'anthropic',
      enabledFormat: 'thinking',
    },
    {
      nativeAdapter: 'gemini',
      effortFormat: 'gemini',
      enabledFormat: 'gemini',
    },
  ] satisfies ReadonlyArray<{
    readonly nativeAdapter: ReasoningResolverInput['nativeAdapter'];
    readonly chatBaseUrl?: string;
    readonly effortFormat: ResolvedReasoningEffortWireFormat;
    readonly enabledFormat: ResolvedReasoningEnabledWireFormat;
  }>)(
    'resolves $nativeAdapter $chatBaseUrl to its native formats',
    ({ nativeAdapter, chatBaseUrl, effortFormat, enabledFormat }) => {
      const result = resolve({ nativeAdapter, chatBaseUrl });

      expect({
        effortFormat: result.effortFormat,
        enabledFormat: result.enabledFormat,
      }).toStrictEqual({ effortFormat, enabledFormat });
    },
  );

  it.each([undefined, 'not a URL', 'https://custom.example/v1'])(
    'leaves unknown or invalid Chat endpoint %s unresolved',
    (chatBaseUrl) => {
      const result = resolve({
        chatBaseUrl,
        reasoning: { effort: 'high', enabled: true },
      });

      expect(result).toStrictEqual({
        effortFormat: 'none',
        enabledFormat: 'none',
        effort: {
          state: 'unrepresentable',
          reason: 'effort-format-undetected',
        },
        enabled: {
          state: 'unrepresentable',
          reason: 'enabled-format-undetected',
        },
      });
    },
  );

  it.each([
    'https://openrouter.ai.attacker.example/v1',
    'https://z.ai.attacker.example/v1',
    'https://bigmodel.cn.attacker.example/v1',
    'https://api.openai.com.attacker.example/v1',
  ])('rejects hostname suffix spoof %s', (chatBaseUrl) => {
    const result = resolve({ chatBaseUrl });

    expect({
      effortFormat: result.effortFormat,
      enabledFormat: result.enabledFormat,
    }).toStrictEqual({ effortFormat: 'none', enabledFormat: 'none' });
  });
});

describe('reasoning effort mapping', () => {
  it('uses the generic effort unchanged when a string map entry is absent', () => {
    const result = resolve({
      effortWireFormat: 'openai',
      reasoning: { effort: 'high' },
      effortMap: { low: 'tiny' },
    });

    expect(result.effort).toStrictEqual({ state: 'emitted', value: 'high' });
  });

  it('remaps a generic effort for a string-valued format', () => {
    const result = resolve({
      effortWireFormat: 'template-kwargs',
      reasoning: { effort: 'medium' },
      effortMap: { medium: 'balanced' },
    });

    expect(result.effort).toStrictEqual({
      state: 'emitted',
      value: 'balanced',
    });
  });

  it('treats a null effort map entry as explicit suppression', () => {
    const result = resolve({
      effortWireFormat: 'openrouter',
      reasoning: { effort: 'minimal' },
      effortMap: { minimal: null },
    });

    expect(result.effort).toStrictEqual({
      state: 'suppressed',
      reason: 'effort-map-null',
    });
  });

  it('emits a numeric mapped value for anthropic-budget', () => {
    const result = resolve({
      effortWireFormat: 'anthropic-budget',
      reasoning: { effort: 'high' },
      effortMap: { high: 8192 },
    });

    expect(result.effort).toStrictEqual({ state: 'emitted', value: 8192 });
  });

  it('reports an effort without a numeric anthropic-budget mapping', () => {
    const result = resolve({
      effortWireFormat: 'anthropic-budget',
      reasoning: { effort: 'high' },
    });

    expect(result.effort).toStrictEqual({
      state: 'unrepresentable',
      reason: 'numeric-effort-map-required',
    });
  });

  it('gives a direct budget precedence over an effort-derived budget', () => {
    const result = resolve({
      effortWireFormat: 'anthropic-budget',
      reasoning: { effort: 'high', budgetTokens: 16384 },
      effortMap: { high: 8192 },
    });

    expect(result.effort).toStrictEqual({ state: 'emitted', value: 16384 });
  });

  it('emits a direct budget when generic effort is absent', () => {
    const result = resolve({
      effortWireFormat: 'anthropic-budget',
      reasoning: { budgetTokens: 4096 },
    });

    expect(result.effort).toStrictEqual({ state: 'emitted', value: 4096 });
  });

  it('distinguishes absent effort from suppression', () => {
    const result = resolve({ effortWireFormat: 'openai' });

    expect(result.effort).toStrictEqual({ state: 'absent' });
  });

  it('treats an explicit none effort selector as suppression', () => {
    const result = resolve({
      effortWireFormat: 'none',
      reasoning: { effort: 'low' },
    });

    expect(result.effort).toStrictEqual({
      state: 'suppressed',
      reason: 'effort-format-none',
    });
  });

  it('rejects string mappings for anthropic-budget', () => {
    const effortMap: ReasoningEffortMap = { high: '8192' };

    expect(() =>
      resolve({
        effortWireFormat: 'anthropic-budget',
        reasoning: { effort: 'high' },
        effortMap,
      }),
    ).toThrow('reasoning.effortMap.high must be a number for anthropic-budget');
  });

  it('rejects numeric mappings for string-valued formats', () => {
    const effortMap: ReasoningEffortMap = { high: 8192 };

    expect(() =>
      resolve({
        effortWireFormat: 'openai',
        reasoning: { effort: 'high' },
        effortMap,
      }),
    ).toThrow('reasoning.effortMap.high must be a string for openai');
  });
});

describe('reasoning enabled mapping', () => {
  it.each([
    ['openrouter', true, true],
    ['openrouter', false, false],
    ['thinking', true, 'enabled'],
    ['thinking', false, 'disabled'],
    ['gemini', true, true],
    ['gemini', false, false],
    ['template-kwargs', true, true],
    ['template-kwargs', false, false],
  ] satisfies ReadonlyArray<
    readonly [
      ReasoningResolverInput['enabledWireFormat'],
      boolean,
      string | boolean,
    ]
  >)(
    'applies the %s default for enabled=%s',
    (enabledWireFormat, enabled, expected) => {
      const nativeAdapter = nativeAdapterForEnabledFormat(enabledWireFormat);
      const result = resolve({
        nativeAdapter,
        enabledWireFormat,
        reasoning: { enabled },
      });

      expect(result.enabled).toStrictEqual({
        state: 'emitted',
        value: expected,
      });
    },
  );

  it.each(['openai', 'openai-responses'] satisfies ReadonlyArray<
    ReasoningResolverInput['enabledWireFormat']
  >)('requires an explicit enabled map for %s', (enabledWireFormat) => {
    const nativeAdapter = nativeAdapterForEnabledFormat(enabledWireFormat);
    const result = resolve({
      nativeAdapter,
      enabledWireFormat,
      reasoning: { enabled: true },
    });

    expect(result.enabled).toStrictEqual({
      state: 'unrepresentable',
      reason: 'enabled-map-required',
    });
  });

  it.each([
    ['openai', 'on'],
    ['openai-responses', 'low'],
    ['thinking', 'adaptive'],
    ['openrouter', false],
    ['gemini', false],
    ['template-kwargs', false],
  ] satisfies ReadonlyArray<
    readonly [ReasoningResolverInput['enabledWireFormat'], string | boolean]
  >)(
    'uses an accepted custom %s enabled mapping',
    (enabledWireFormat, expected) => {
      const nativeAdapter = nativeAdapterForEnabledFormat(enabledWireFormat);
      const enabledMap: ReasoningEnabledMap = { true: expected };
      const result = resolve({
        nativeAdapter,
        enabledWireFormat,
        reasoning: { enabled: true },
        enabledMap,
      });

      expect(result.enabled).toStrictEqual({
        state: 'emitted',
        value: expected,
      });
    },
  );

  it('treats a null enabled map entry as explicit suppression', () => {
    const result = resolve({
      enabledWireFormat: 'thinking',
      reasoning: { enabled: false },
      enabledMap: { false: null },
    });

    expect(result.enabled).toStrictEqual({
      state: 'suppressed',
      reason: 'enabled-map-null',
    });
  });

  it('distinguishes absent enabled input', () => {
    const result = resolve({ enabledWireFormat: 'thinking' });

    expect(result.enabled).toStrictEqual({ state: 'absent' });
  });

  it.each([
    ['openai-chat', 'https://api.openai.com/v1'],
    ['openai-responses', undefined],
  ] satisfies ReadonlyArray<
    readonly [ReasoningResolverInput['nativeAdapter'], string | undefined]
  >)(
    'allows emitted effort to represent enabled=true for %s',
    (nativeAdapter, chatBaseUrl) => {
      const result = resolve({
        nativeAdapter,
        chatBaseUrl,
        reasoning: { enabled: true, effort: 'high' },
      });

      expect(result.enabled).toStrictEqual({
        state: 'represented',
        reason: 'effort-emitted',
      });
    },
  );

  it('allows an effort value to represent enabled=true without an enabled map', () => {
    const result = resolve({
      effortWireFormat: 'openai',
      enabledWireFormat: 'openai',
      reasoning: { enabled: true, effort: 'high' },
    });

    expect(result.enabled).toStrictEqual({
      state: 'represented',
      reason: 'effort-emitted',
    });
  });

  it('does not add redundant default OpenRouter enablement when effort is emitted', () => {
    const result = resolve({
      effortWireFormat: 'openrouter',
      enabledWireFormat: 'openrouter',
      reasoning: { enabled: true, effort: 'high' },
    });

    expect(result.enabled).toStrictEqual({
      state: 'represented',
      reason: 'effort-emitted',
    });
  });

  it('represents enabled=true by emitted effort instead of an openai enabled map string', () => {
    const result = resolve({
      effortWireFormat: 'openai',
      enabledWireFormat: 'openai',
      reasoning: { enabled: true, effort: 'high' },
      enabledMap: { true: 'max' },
    });

    expect(result.effort).toStrictEqual({ state: 'emitted', value: 'high' });
    expect(result.enabled).toStrictEqual({
      state: 'represented',
      reason: 'effort-emitted',
    });
  });

  it('represents enabled=true by emitted effort instead of an openai-responses enabled map string', () => {
    const result = resolve({
      nativeAdapter: 'openai-responses',
      effortWireFormat: 'openai-responses',
      enabledWireFormat: 'openai-responses',
      reasoning: { enabled: true, effort: 'high' },
      enabledMap: { true: 'medium' },
    });

    expect(result.effort).toStrictEqual({ state: 'emitted', value: 'high' });
    expect(result.enabled).toStrictEqual({
      state: 'represented',
      reason: 'effort-emitted',
    });
  });

  it('keeps a mapped enabled=false emission when effort is disabled-suppressed', () => {
    const result = resolve({
      effortWireFormat: 'openai',
      enabledWireFormat: 'openai',
      reasoning: { enabled: false, effort: 'high' },
      enabledMap: { false: 'none' },
    });

    expect(result.effort).toStrictEqual({
      state: 'suppressed',
      reason: 'reasoning-disabled',
    });
    expect(result.enabled).toStrictEqual({
      state: 'emitted',
      value: 'none',
    });
  });
  it('treats an explicit none enabled selector as suppression', () => {
    const result = resolve({
      enabledWireFormat: 'none',
      reasoning: { enabled: true },
    });

    expect(result.enabled).toStrictEqual({
      state: 'suppressed',
      reason: 'enabled-format-none',
    });
  });

  it('treats enabled=true as represented when an effort-only profile emits effort', () => {
    const result = resolve({
      effortWireFormat: 'openai',
      enabledWireFormat: 'none',
      reasoning: { enabled: true, effort: 'high' },
    });

    expect(result.enabled).toStrictEqual({
      state: 'represented',
      reason: 'effort-emitted',
    });
  });

  it.each([
    ['openai', true],
    ['openai-responses', false],
    ['thinking', true],
    ['openrouter', 'enabled'],
    ['gemini', 'enabled'],
    ['template-kwargs', 'enabled'],
  ] satisfies ReadonlyArray<
    readonly [ReasoningResolverInput['enabledWireFormat'], string | boolean]
  >)(
    'rejects an incompatible custom value for %s',
    (enabledWireFormat, mappedValue) => {
      const nativeAdapter = nativeAdapterForEnabledFormat(enabledWireFormat);
      const enabledMap: ReasoningEnabledMap = { true: mappedValue };

      expect(() =>
        resolve({
          nativeAdapter,
          enabledWireFormat,
          reasoning: { enabled: true },
          enabledMap,
        }),
      ).toThrow(
        `reasoning.enabledMap.true has an incompatible value for ${enabledWireFormat}`,
      );
    },
  );
});

describe('reasoning enablement precedence', () => {
  it('suppresses generic effort when reasoning is explicitly disabled', () => {
    const result = resolve({
      effortWireFormat: 'openrouter',
      enabledWireFormat: 'openrouter',
      reasoning: { enabled: false, effort: 'high' },
    });

    expect({ effort: result.effort, enabled: result.enabled }).toStrictEqual({
      effort: { state: 'suppressed', reason: 'reasoning-disabled' },
      enabled: { state: 'emitted', value: false },
    });
  });

  it('reports disablement that an effort-only format cannot represent', () => {
    const result = resolve({
      effortWireFormat: 'openai',
      enabledWireFormat: 'auto',
      reasoning: { enabled: false, effort: 'high' },
    });

    expect({ effort: result.effort, enabled: result.enabled }).toStrictEqual({
      effort: { state: 'suppressed', reason: 'reasoning-disabled' },
      enabled: {
        state: 'unrepresentable',
        reason: 'enabled-format-undetected',
      },
    });
  });

  it('suppresses a direct budget when reasoning is explicitly disabled', () => {
    const result = resolve({
      effortWireFormat: 'anthropic-budget',
      enabledWireFormat: 'thinking',
      reasoning: { enabled: false, budgetTokens: 8192 },
    });

    expect({ effort: result.effort, enabled: result.enabled }).toStrictEqual({
      effort: { state: 'suppressed', reason: 'reasoning-disabled' },
      enabled: { state: 'emitted', value: 'disabled' },
    });
  });
});

describe('native adapter selector compatibility', () => {
  it.each([
    ['openai-responses', 'openai'],
    ['anthropic', 'openrouter'],
    ['gemini', 'openai'],
    ['openai-chat', 'anthropic'],
  ] satisfies ReadonlyArray<
    readonly [
      ReasoningResolverInput['nativeAdapter'],
      ReasoningResolverInput['effortWireFormat'],
    ]
  >)('rejects %s effort selector %s', (nativeAdapter, selector) => {
    expect(() =>
      resolve({ nativeAdapter, effortWireFormat: selector }),
    ).toThrow(
      `effort wire format '${selector}' is incompatible with the ${nativeAdapter} adapter`,
    );
  });

  it.each([
    ['openai-responses', 'thinking'],
    ['anthropic', 'openrouter'],
    ['gemini', 'thinking'],
    ['openai-chat', 'gemini'],
  ] satisfies ReadonlyArray<
    readonly [
      ReasoningResolverInput['nativeAdapter'],
      ReasoningResolverInput['enabledWireFormat'],
    ]
  >)('rejects %s enabled selector %s', (nativeAdapter, selector) => {
    expect(() =>
      resolve({ nativeAdapter, enabledWireFormat: selector }),
    ).toThrow(
      `enabled wire format '${selector}' is incompatible with the ${nativeAdapter} adapter`,
    );
  });

  it.each([
    {
      nativeAdapter: 'openai-responses',
      effortWireFormat: 'openai-responses',
      enabledWireFormat: 'openai-responses',
    },
    {
      nativeAdapter: 'anthropic',
      effortWireFormat: 'anthropic-budget',
      enabledWireFormat: 'thinking',
    },
    {
      nativeAdapter: 'gemini',
      effortWireFormat: 'none',
      enabledWireFormat: 'gemini',
    },
    {
      nativeAdapter: 'openai-chat',
      effortWireFormat: 'anthropic-budget',
      enabledWireFormat: 'template-kwargs',
    },
  ] satisfies ReadonlyArray<
    Pick<
      ReasoningResolverInput,
      'nativeAdapter' | 'effortWireFormat' | 'enabledWireFormat'
    >
  >)('accepts supported selectors for $nativeAdapter', (selectors) => {
    expect(() => resolve(selectors)).not.toThrow();
  });
});

describe('emitted Chat format pair coordination (issue #3255)', () => {
  it.each([
    {
      title: 'openai effort with thinking enablement',
      effortWireFormat: 'openai',
      enabledWireFormat: 'thinking',
      effortMap: undefined,
      enabledMap: undefined,
    },
    {
      title: 'anthropic-budget effort with thinking enablement',
      effortWireFormat: 'anthropic-budget',
      enabledWireFormat: 'thinking',
      effortMap: { high: 8192 },
      enabledMap: undefined,
    },
    {
      title: 'openai effort with openai enablement',
      effortWireFormat: 'openai',
      enabledWireFormat: 'openai',
      effortMap: undefined,
      enabledMap: undefined,
    },
    {
      title: 'openrouter effort with openrouter enablement',
      effortWireFormat: 'openrouter',
      enabledWireFormat: 'openrouter',
      effortMap: undefined,
      enabledMap: { true: false },
    },
    {
      title: 'template-kwargs effort with template-kwargs enablement',
      effortWireFormat: 'template-kwargs',
      enabledWireFormat: 'template-kwargs',
      effortMap: undefined,
      enabledMap: undefined,
    },
  ] satisfies ReadonlyArray<{
    readonly title: string;
    readonly effortWireFormat: ReasoningResolverInput['effortWireFormat'];
    readonly enabledWireFormat: ReasoningResolverInput['enabledWireFormat'];
    readonly effortMap: ReasoningEffortMap | undefined;
    readonly enabledMap: ReasoningEnabledMap | undefined;
  }>)(
    'accepts the coordinated $title pair',
    ({ effortWireFormat, enabledWireFormat, effortMap, enabledMap }) => {
      expect(() =>
        resolve({
          effortWireFormat,
          enabledWireFormat,
          reasoning: { enabled: true, effort: 'high' },
          effortMap,
          enabledMap,
        }),
      ).not.toThrow();
    },
  );

  it.each([
    {
      effortWireFormat: 'openrouter',
      enabledWireFormat: 'thinking',
      effortMap: undefined,
      enabledMap: undefined,
    },
    {
      effortWireFormat: 'anthropic-budget',
      enabledWireFormat: 'openrouter',
      effortMap: { high: 8192 },
      enabledMap: { true: false },
    },
    {
      effortWireFormat: 'template-kwargs',
      enabledWireFormat: 'openrouter',
      effortMap: undefined,
      enabledMap: { true: false },
    },
  ] satisfies ReadonlyArray<{
    readonly effortWireFormat: ReasoningResolverInput['effortWireFormat'];
    readonly enabledWireFormat: ReasoningResolverInput['enabledWireFormat'];
    readonly effortMap: ReasoningEffortMap | undefined;
    readonly enabledMap: ReasoningEnabledMap | undefined;
  }>)(
    'rejects conflicting emitted effort $effortWireFormat with enabled $enabledWireFormat',
    ({ effortWireFormat, enabledWireFormat, effortMap, enabledMap }) => {
      expect(() =>
        resolve({
          effortWireFormat,
          enabledWireFormat,
          reasoning: { enabled: true, effort: 'high' },
          effortMap,
          enabledMap,
        }),
      ).toThrow(
        `effort format '${effortWireFormat}' and enabled format '${enabledWireFormat}' emit conflicting OpenAI Chat reasoning representations`,
      );
    },
  );

  it('allows openrouter effort when a null enabled map suppresses enablement', () => {
    expect(() =>
      resolve({
        effortWireFormat: 'openrouter',
        enabledWireFormat: 'thinking',
        reasoning: { enabled: true, effort: 'high' },
        enabledMap: { true: null },
      }),
    ).not.toThrow();
  });

  it('allows anthropic-budget effort when enablement is represented by effort', () => {
    expect(() =>
      resolve({
        effortWireFormat: 'anthropic-budget',
        enabledWireFormat: 'openrouter',
        reasoning: { enabled: true, effort: 'high' },
        effortMap: { high: 8192 },
      }),
    ).not.toThrow();
  });

  it('allows template-kwargs effort when the enabled format is none', () => {
    expect(() =>
      resolve({
        effortWireFormat: 'template-kwargs',
        enabledWireFormat: 'none',
        reasoning: { enabled: true, effort: 'high' },
      }),
    ).not.toThrow();
  });

  it('allows conflicting selectors when enablement is absent', () => {
    expect(() =>
      resolve({
        effortWireFormat: 'template-kwargs',
        enabledWireFormat: 'openrouter',
        reasoning: { effort: 'high' },
      }),
    ).not.toThrow();
  });

  it('allows conflicting selectors when effort is absent', () => {
    expect(() =>
      resolve({
        effortWireFormat: 'anthropic-budget',
        enabledWireFormat: 'openrouter',
        reasoning: { enabled: true },
        enabledMap: { true: false },
      }),
    ).not.toThrow();
  });

  it('allows conflicting selectors when effort is suppressed by reasoning-disabled', () => {
    expect(() =>
      resolve({
        effortWireFormat: 'openrouter',
        enabledWireFormat: 'thinking',
        reasoning: { enabled: false, effort: 'high' },
      }),
    ).not.toThrow();
  });

  it('allows conflicting selectors when effort is unrepresentable', () => {
    expect(() =>
      resolve({
        effortWireFormat: 'anthropic-budget',
        enabledWireFormat: 'openrouter',
        reasoning: { enabled: true, effort: 'high' },
        enabledMap: { true: false },
      }),
    ).not.toThrow();
  });
});
