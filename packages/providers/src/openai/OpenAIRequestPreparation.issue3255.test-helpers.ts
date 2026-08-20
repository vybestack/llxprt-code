/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared harness for the issue #3255 OpenAI Chat reasoning wire-translation
 * suites: fixture builders, invocation wiring, and the recording logger the
 * tests assert suppressed-setting warnings through.
 */
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  createRuntimeInvocationContext,
  type RuntimeInvocationContext,
} from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { loadProviderAliasEntries } from '../composition/providerAliases.js';
import { computeModelDefaults } from '../runtime/providerMutations.js';
import { prepareRequest } from './OpenAIRequestPreparation.js';

const PROVIDER = 'openai';
/**
 * Real top-level reasoning wire keys only. The nested controls
 * (`chat_template_kwargs.enable_thinking`, `thinking.budget_tokens`,
 * `output_config.effort`) are asserted through their compared parent
 * containers rather than listed here as top-level pseudo-keys.
 */
const REASONING_BODY_KEYS: readonly string[] = [
  'reasoning',
  'thinking',
  'reasoning_effort',
  'parse_reasoning',
  'chat_template_kwargs',
  'output_config',
];

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
  readonly baseURL?: string;
  readonly model?: string;
  readonly modelBehavior?: Readonly<Record<string, unknown>>;
  readonly rawModelBehavior?: Readonly<Record<string, unknown>>;
  readonly modelParams?: Readonly<Record<string, unknown>>;
  readonly providerName?: string;
}

interface PreparedFixture {
  readonly body: Record<string, unknown>;
  readonly logger: RecordingDebugLogger;
}

/**
 * Resolve the merged model behavior a shipped builtin alias produces for a
 * model: alias ephemeralSettings overlaid by matching modelDefaults rules.
 */
export function builtinAliasModelBehavior(
  alias: string,
  model: string,
): Record<string, unknown> {
  const entry = loadProviderAliasEntries().find(
    (candidate) =>
      candidate.source === 'builtin' &&
      candidate.alias.toLowerCase() === alias.toLowerCase(),
  );
  if (!entry) {
    throw new Error(`Builtin provider alias '${alias}' was not loaded`);
  }
  return {
    ...entry.config.ephemeralSettings,
    ...computeModelDefaults(model, entry.config.modelDefaults ?? []),
  };
}

function createInvocation(
  settings: SettingsService,
  providerName: string,
  modelBehavior: Readonly<Record<string, unknown>>,
  rawModelBehavior: Readonly<Record<string, unknown>> | undefined,
  modelParams: Readonly<Record<string, unknown>>,
): RuntimeInvocationContext {
  for (const [key, value] of Object.entries(modelBehavior)) {
    settings.set(key, value);
  }
  for (const [key, value] of Object.entries(modelParams)) {
    settings.setProviderSetting(providerName, key, value);
  }

  const invocation = createRuntimeInvocationContext({
    runtime: { settingsService: settings, runtimeId: 'issue3255-test' },
    settings,
    providerName,
    ephemeralsSnapshot: {
      ...modelBehavior,
      [providerName]: modelParams,
    },
  });
  if (rawModelBehavior === undefined) {
    return invocation;
  }

  return {
    ...invocation,
    modelBehavior: rawModelBehavior,
  } satisfies RuntimeInvocationContext;
}

function createOptions(
  fixture: RequestFixture,
  providerName: string,
): NormalizedGenerateChatOptions {
  const settings = new SettingsService();
  const invocation = createInvocation(
    settings,
    providerName,
    fixture.modelBehavior ?? {},
    fixture.rawModelBehavior,
    fixture.modelParams ?? {},
  );

  return {
    contents: [],
    tools: undefined,
    metadata: {},
    settings,
    config: undefined,
    invocation,
    systemInstruction: 'test system prompt',
    resolved: {
      model: fixture.model ?? 'test-reasoning-model',
      baseURL: fixture.baseURL,
      authToken: 'test-token',
    },
  } satisfies NormalizedGenerateChatOptions;
}

export async function prepare(
  fixture: RequestFixture,
): Promise<PreparedFixture> {
  const logger = new RecordingDebugLogger(
    'llxprt:provider:openai:issue3255-test',
  );
  const providerName = fixture.providerName ?? PROVIDER;
  const result = await prepareRequest(
    createOptions(fixture, providerName),
    'fallback-model',
    undefined,
    logger,
    providerName,
  );
  return { body: { ...result.requestBody }, logger };
}

export function reasoningFields(
  body: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of REASONING_BODY_KEYS) {
    if (key in body) {
      fields[key] = body[key];
    }
  }
  return fields;
}
