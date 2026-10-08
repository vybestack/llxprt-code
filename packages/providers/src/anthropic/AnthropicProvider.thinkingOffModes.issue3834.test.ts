/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { RuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { prepareAnthropicRequest } from './AnthropicRequestPreparation.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
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

describe('Anthropic thinking-off modes and effort caps (@issue:3834)', () => {
  it('emits between_tools without extra fields for Sonnet 5.5 thinking-off @issue:3834', async () => {
    const { body } = await prepare({
      model: 'claude-sonnet-5-5',
      modelBehavior: { 'reasoning.enabled': false },
    });
    expect(reasoningFields(body)['thinking']).toStrictEqual({
      type: 'between_tools',
    });
  });

  it('emits disabled without display for Haiku 5.5 thinking-off @issue:3834', async () => {
    const { body } = await prepare({
      model: 'claude-haiku-5-5',
      modelBehavior: { 'reasoning.enabled': false },
    });
    expect(reasoningFields(body)['thinking']).toStrictEqual({
      type: 'disabled',
    });
  });

  it('omits thinking when Opus 5.5 cannot disable it @issue:3834', async () => {
    const { body, logger } = await prepare({
      model: 'claude-opus-5-5',
      modelBehavior: { 'reasoning.enabled': false },
    });
    expect(reasoningFields(body)).toStrictEqual({});
    expect(logger.warnings.length).toBeGreaterThan(0);
  });

  it('keeps disabled thinking on Opus 5 @issue:3834', async () => {
    const { body } = await prepare({
      model: 'claude-opus-5',
      modelBehavior: { 'reasoning.enabled': false },
    });
    expect(reasoningFields(body)['thinking']).toStrictEqual({
      type: 'disabled',
    });
  });

  it.each([
    ['claude-sonnet-5-5', 'between_tools'],
    ['claude-haiku-5-5', 'disabled'],
    ['claude-opus-5', 'disabled'],
  ] as const)(
    'caps selected-path %s thinking-off max effort at high @issue:3834',
    async (model, thinkingType) => {
      const { body } = await prepare({
        model,
        modelBehavior: {
          'reasoning.enabled': false,
          'reasoning.effort': 'max',
          'reasoning.effortWireFormat': 'anthropic',
          'reasoning.enabledWireFormat': 'thinking',
          'reasoning.effortMap': { minimal: 'low' },
          'reasoning.enabledMap': { true: 'adaptive', false: 'disabled' },
        },
      });

      expect(reasoningFields(body)).toStrictEqual({
        thinking: { type: thinkingType },
        output_config: { effort: 'high' },
      });
    },
  );

  it('does not cap selected-path Sonnet 5 disabled effort @issue:3834', async () => {
    const { body } = await prepare({
      model: 'claude-sonnet-5',
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.effort': 'max',
        'reasoning.effortWireFormat': 'anthropic',
        'reasoning.enabledWireFormat': 'thinking',
        'reasoning.effortMap': { minimal: 'low' },
        'reasoning.enabledMap': { true: 'adaptive', false: 'disabled' },
      },
    });

    expect(reasoningFields(body)).toStrictEqual({
      output_config: { effort: 'max' },
    });
  });

  it.each([
    ['claude-sonnet-5-5', 'between_tools'],
    ['claude-haiku-5-5', 'disabled'],
  ] as const)(
    'keeps legacy-auto %s thinking-off effort off the wire @issue:3834',
    async (model, thinkingType) => {
      const { body } = await prepare({
        model,
        modelBehavior: {
          'reasoning.enabled': false,
          'reasoning.effort': 'max',
        },
      });

      // No effort on the wire means the model applies its default, so xhigh/max cannot be rejected.
      expect(reasoningFields(body)).toStrictEqual({
        thinking: { type: thinkingType },
      });
    },
  );

  it('accepts between_tools in the enabled false map for Sonnet 5.5 @issue:3834', async () => {
    const { body } = await prepare({
      model: 'claude-sonnet-5-5',
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.enabledWireFormat': 'thinking',
        'reasoning.enabledMap': { false: 'between_tools' },
      },
    });
    expect(reasoningFields(body)['thinking']).toStrictEqual({
      type: 'between_tools',
    });
  });
});
