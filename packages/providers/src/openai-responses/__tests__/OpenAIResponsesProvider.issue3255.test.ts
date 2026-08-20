/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { RuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { NormalizedGenerateChatOptions } from '../../BaseProvider.js';
import { loadProviderAliasEntries } from '../../composition/providerAliases.js';
import { computeModelDefaults } from '../../runtime/providerMutations.js';
import {
  buildRequestContext,
  type ResponsesExecutorDeps,
} from '../openAIResponsesExecutor.js';
import type { OpenAIResponsesRequest } from '../OpenAIResponsesTypes.js';

const PROVIDER_NAME = 'openai-responses';
const BASE_URL = 'https://api.openai.com/v1';

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

interface BuiltFixture {
  readonly request: OpenAIResponsesRequest;
  readonly logger: RecordingDebugLogger;
}

function createOptions(fixture: RequestFixture): NormalizedGenerateChatOptions {
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(fixture.modelBehavior ?? {})) {
    settings.set(key, value);
  }
  for (const [key, value] of Object.entries(fixture.modelParams ?? {})) {
    settings.setProviderSetting(PROVIDER_NAME, key, value);
  }

  const resolved: NormalizedGenerateChatOptions['resolved'] = {
    model: fixture.model ?? 'gpt-5.6-sol',
    baseURL: fixture.baseURL ?? BASE_URL,
    authToken: 'test-token',
  };
  const generated = createProviderCallOptions({
    providerName: PROVIDER_NAME,
    settings,
    resolved,
    contents: [
      { speaker: 'human', blocks: [{ type: 'text', text: 'test request' }] },
    ],
  });
  const invocation = createInvocation(
    generated.invocation,
    fixture.rawModelBehavior,
    fixture.rawModelParams,
  );

  return {
    ...generated,
    invocation,
    metadata: generated.metadata ?? {},
    resolved,
  } satisfies NormalizedGenerateChatOptions;
}

function createInvocation(
  invocation: RuntimeInvocationContext,
  rawModelBehavior: Readonly<Record<string, unknown>> | undefined,
  rawModelParams: Readonly<Record<string, unknown>> | undefined,
): RuntimeInvocationContext {
  const next: RuntimeInvocationContext =
    rawModelBehavior === undefined
      ? invocation
      : ({
          ...invocation,
          modelBehavior: rawModelBehavior,
        } satisfies RuntimeInvocationContext);
  return rawModelParams === undefined
    ? next
    : ({
        ...next,
        modelParams: rawModelParams,
      } satisfies RuntimeInvocationContext);
}

function createDeps(
  logger: RecordingDebugLogger,
  baseURL: string,
): ResponsesExecutorDeps {
  return {
    providerName: PROVIDER_NAME,
    logger,
    getProviderBaseURL: () => baseURL,
    getCustomHeaders: () => undefined,
    isCodexBaseURL: () => false,
    getCodexAccountId: async () => 'test-account',
    resolveAuthTokenForPrompt: async () => 'test-token',
    shouldRetryOnError: () => false,
    getDefaultModel: () => 'gpt-5.6-sol',
    getGlobalConfig: () => undefined,
  } satisfies ResponsesExecutorDeps;
}

async function build(fixture: RequestFixture): Promise<BuiltFixture> {
  const options = createOptions(fixture);
  const logger = new RecordingDebugLogger(
    'llxprt:providers:openai-responses:issue3255-test',
  );
  const baseURL = fixture.baseURL ?? BASE_URL;
  const context = await buildRequestContext(
    options,
    [...options.contents],
    { ...options.invocation.ephemerals },
    createDeps(logger, baseURL),
  );
  return { request: context.request, logger };
}

function reasoningTranslationKeys(
  request: Readonly<OpenAIResponsesRequest>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of [
    'reasoning',
    'reasoning.effortWireFormat',
    'reasoning.enabledWireFormat',
    'reasoning.effortMap',
    'reasoning.enabledMap',
  ]) {
    if (key in request) {
      result[key] = request[key];
    }
  }
  return result;
}

describe('OpenAI Responses reasoning wire translation (issue #3255)', () => {
  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])(
    'emits nested effort for %s through the Responses adapter',
    async (model) => {
      const { request } = await build({
        model,
        modelBehavior: { 'reasoning.effort': 'high' },
      });

      expect(reasoningTranslationKeys(request)).toStrictEqual({
        reasoning: { effort: 'high' },
      });
    },
  );

  it('applies a profile effort remap before building nested Responses reasoning', async () => {
    const { request } = await build({
      modelBehavior: {
        'reasoning.effort': 'medium',
        'reasoning.effortMap': { medium: 'high' },
        'reasoning.effortWireFormat': 'openai-responses',
        'reasoning.enabledWireFormat': 'auto',
      },
    });

    expect(reasoningTranslationKeys(request)).toStrictEqual({
      reasoning: { effort: 'high' },
    });
  });

  it('applies GPT-5.6 minimal-to-none policy after the profile map', async () => {
    const { request } = await build({
      model: 'gpt-5.6-terra',
      modelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortMap': { high: 'minimal' },
      },
    });

    expect(request.reasoning).toStrictEqual({ effort: 'none' });
  });

  it('emits an explicit mapped enablement value as Responses effort', async () => {
    const { request } = await build({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.enabledWireFormat': 'openai-responses',
        'reasoning.enabledMap': { true: 'medium' },
      },
    });

    expect(request.reasoning).toStrictEqual({ effort: 'medium' });
    expect(request.include).toStrictEqual(['reasoning.encrypted_content']);
  });

  it('keeps an explicit effort authoritative over an enabled map string', async () => {
    const { request, logger } = await build({
      modelBehavior: {
        'reasoning.enabled': true,
        'reasoning.effort': 'high',
        'reasoning.enabledWireFormat': 'openai-responses',
        'reasoning.enabledMap': { true: 'medium' },
      },
    });

    expect(request.reasoning).toStrictEqual({ effort: 'high' });
    expect(request.include).toStrictEqual(['reasoning.encrypted_content']);
    expect(logger.warnings).toStrictEqual([]);
  });

  it('selects reasoning output without an effort or warning when enabled only', async () => {
    const { request, logger } = await build({
      modelBehavior: { 'reasoning.enabled': true },
    });

    expect(request.reasoning).toBeUndefined();
    expect(request.include).toStrictEqual(['reasoning.encrypted_content']);
    expect(logger.warnings).toStrictEqual([]);
  });

  it('uses a mapped disabled value instead of the ordinary generic effort', async () => {
    const { request } = await build({
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.effort': 'high',
        'reasoning.enabledWireFormat': 'openai-responses',
        'reasoning.enabledMap': { false: 'none' },
      },
    });

    expect(request.reasoning).toStrictEqual({ effort: 'none' });
    expect(request.include).toStrictEqual(['reasoning.encrypted_content']);
  });

  it('omits stale effort and encrypted-content include when disablement is unrepresentable', async () => {
    const { request, logger } = await build({
      baseURL: 'https://api.openai.com/v1?token=do-not-log',
      model: 'gpt-5.6-luna',
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.effort': 'high',
      },
    });

    expect(request.reasoning).toBeUndefined();
    expect(request.include).toBeUndefined();
    expect(logger.warnings).toStrictEqual([
      {
        message:
          "OpenAI Responses omitted configured reasoning.effort because effort format 'openai-responses' cannot emit it",
        metadata: {
          providerName: PROVIDER_NAME,
          model: 'gpt-5.6-luna',
          selectedFormat: 'openai-responses',
          setting: 'reasoning.effort',
          reason: 'reasoning-disabled',
        },
      },
      {
        message:
          "OpenAI Responses omitted configured reasoning.enabled because enabled format 'none' cannot emit it",
        metadata: {
          providerName: PROVIDER_NAME,
          model: 'gpt-5.6-luna',
          selectedFormat: 'none',
          setting: 'reasoning.enabled',
          reason: 'enabled-format-undetected',
        },
      },
    ]);
    expect(JSON.stringify(logger.warnings)).not.toContain('do-not-log');
  });

  it('omits effort for an explicit none selector and records the accepted warning', async () => {
    const { request, logger } = await build({
      model: 'gpt-5.6-sol',
      modelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'none',
      },
    });

    expect(request.reasoning).toBeUndefined();
    expect(logger.warnings).toStrictEqual([
      {
        message:
          "OpenAI Responses omitted configured reasoning.effort because effort format 'none' cannot emit it",
        metadata: {
          providerName: PROVIDER_NAME,
          model: 'gpt-5.6-sol',
          selectedFormat: 'none',
          setting: 'reasoning.effort',
          reason: 'effort-format-none',
        },
      },
    ]);
  });

  it('omits effort for a null map entry and records the accepted warning', async () => {
    const { request, logger } = await build({
      model: 'gpt-5.6-terra',
      modelBehavior: {
        'reasoning.effort': 'medium',
        'reasoning.effortMap': { medium: null },
      },
    });

    expect(request.reasoning).toBeUndefined();
    expect(logger.warnings).toStrictEqual([
      {
        message:
          "OpenAI Responses omitted configured reasoning.effort because effort format 'openai-responses' cannot emit it",
        metadata: {
          providerName: PROVIDER_NAME,
          model: 'gpt-5.6-terra',
          selectedFormat: 'openai-responses',
          setting: 'reasoning.effort',
          reason: 'effort-map-null',
        },
      },
    ]);
  });

  it('preserves explicit native reasoning exactly and skips generic translation warnings', async () => {
    const explicitReasoning = {
      effort: 'low',
      summary: 'concise',
      provider_extension: { mode: 'preserve' },
    };
    const { request, logger } = await build({
      modelBehavior: {
        'reasoning.enabled': false,
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'none',
        'reasoning.effortMap': { high: null },
      },
      modelParams: { reasoning: explicitReasoning },
    });

    expect(request.reasoning).toStrictEqual(explicitReasoning);
    expect(request.include).toStrictEqual(['reasoning.encrypted_content']);
    expect(logger.warnings).toStrictEqual([]);
  });

  it('preserves an explicit null reasoning value exactly and stands down', async () => {
    const { request, logger } = await build({
      modelBehavior: { 'reasoning.effort': 'high' },
      rawModelParams: { reasoning: null },
    });

    const explicitReasoning: unknown = request['reasoning'];
    expect(explicitReasoning).toBeNull();
    expect(request.include).toBeUndefined();
    expect(logger.warnings).toStrictEqual([]);
  });

  it('preserves an explicit non-object reasoning value exactly and stands down', async () => {
    const { request, logger } = await build({
      modelBehavior: { 'reasoning.effort': 'high' },
      rawModelParams: { reasoning: 'disabled' },
    });

    const explicitReasoning: unknown = request['reasoning'];
    expect(explicitReasoning).toBe('disabled');
    expect(request.include).toBeUndefined();
    expect(logger.warnings).toStrictEqual([]);
  });

  it('keeps generic translation active when an unrelated request override exists', async () => {
    const { request } = await build({
      modelBehavior: { 'reasoning.effort': 'medium' },
      modelParams: { temperature: 0.4 },
    });

    expect(request.temperature).toBe(0.4);
    expect(request.reasoning).toStrictEqual({ effort: 'medium' });
  });

  it('retains summary and encrypted-content include for emitted reasoning', async () => {
    const { request } = await build({
      modelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.summary': 'detailed',
      },
    });

    expect(request.reasoning).toStrictEqual({
      effort: 'high',
      summary: 'detailed',
    });
    expect(request.include).toStrictEqual(['reasoning.encrypted_content']);
  });

  it('fails before transport when an effort map is not an object', async () => {
    const request = build({
      rawModelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortMap': ['high'],
      },
    });

    await expect(request).rejects.toThrow(
      'reasoning.effortMap must be a JSON object',
    );
  });

  it('fails before transport when a mapped type is incompatible', async () => {
    const request = build({
      rawModelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortMap': { high: 8192 },
      },
    });

    await expect(request).rejects.toThrow(
      'reasoning.effortMap.high must be a string for openai-responses',
    );
  });

  it('fails before transport for an incompatible explicit selector', async () => {
    const request = build({
      modelBehavior: {
        'reasoning.effort': 'high',
        'reasoning.effortWireFormat': 'anthropic',
      },
    });

    await expect(request).rejects.toThrow(
      "effort wire format 'anthropic' is incompatible with the openai-responses adapter",
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
    'strictly rejects malformed invocation model behavior for $setting',
    async ({ setting, value, expected }) => {
      const request = build({
        rawModelBehavior: { [setting]: value },
      });

      await expect(request).rejects.toThrow(expected);
    },
  );

  it('sends the built-in codex alias defaults as nested Responses reasoning', async () => {
    const aliasEntry = loadProviderAliasEntries().find(
      (candidate) =>
        candidate.source === 'builtin' && candidate.alias === 'codex',
    );
    if (!aliasEntry) {
      throw new Error('Builtin codex alias entry not found');
    }
    const model = aliasEntry.config.defaultModel;
    if (typeof model !== 'string' || model === '') {
      throw new Error('Builtin codex alias entry must declare a default model');
    }
    const baseUrl = aliasEntry.config['base-url'];
    if (typeof baseUrl !== 'string') {
      throw new Error('Builtin codex alias entry must declare a base URL');
    }
    const modelBehavior: Record<string, unknown> = {
      ...aliasEntry.config.ephemeralSettings,
      ...computeModelDefaults(model, aliasEntry.config.modelDefaults ?? []),
    };

    const { request, logger } = await build({
      model,
      baseURL: baseUrl,
      modelBehavior,
    });

    expect(model).toBe('gpt-5.6-sol');
    expect(request.reasoning).toStrictEqual({
      effort: 'medium',
      summary: 'auto',
    });
    expect(logger.warnings).toStrictEqual([]);
  });
});
