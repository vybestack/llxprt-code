/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ResponsesExecutorDeps } from './openAIResponsesExecutor.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ToolOutputSettingsProvider } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import {
  buildOpenAIResponsesInput,
  type ResponsesInputBuildContext,
} from './OpenAIResponsesInputBuilder.js';
import { resolveRuntimeAuthToken } from '../utils/authToken.js';
import { convertToolsToOpenAIResponses } from './schemaConverter.js';
import {
  applyOpenAIResponsesReasoning,
  type AppliedOpenAIResponsesReasoning,
} from './openai-responses-reasoning.js';
import { sanitizePromptCacheKey } from './sanitizePromptCacheKey.js';
import type {
  OpenAIResponsesRequest,
  ResponsesInputItem,
} from './OpenAIResponsesTypes.js';

export function resolveInvocationEphemerals(
  options: NormalizedGenerateChatOptions,
): Record<string, unknown> {
  const invocation = options.invocation as {
    ephemerals?: Record<string, unknown>;
  };
  return invocation.ephemerals ?? {};
}

export async function resolveApiKey(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
): Promise<string> {
  const promptAuthToken = await deps.resolveAuthTokenForPrompt();
  // Strict guard on the value that becomes the Authorization header:
  // only forward a genuine non-empty string. Provider implementations
  // can resolve to '' from deeper auth paths, and a defensive runtime
  // typeof check ensures a non-string (undefined/null from a loosely
  // typed implementation) is never injected into the header.
  if (typeof promptAuthToken === 'string' && promptAuthToken !== '') {
    return promptAuthToken;
  }
  const runtimeToken = await resolveRuntimeAuthToken(
    options.resolved.authToken,
  );
  if (typeof runtimeToken === 'string' && runtimeToken !== '') {
    return runtimeToken;
  }

  const isCodex = deps.isCodexMode();
  throw new Error(
    isCodex
      ? 'Codex authentication required. Run /auth codex enable to authenticate.'
      : 'OpenAI API key is required',
  );
}

export function isResponsesPdfEnabled(
  options: NormalizedGenerateChatOptions,
): boolean {
  const invocationEphemerals = resolveInvocationEphemerals(options);
  const setting =
    (invocationEphemerals['media.pdf.enabled'] as boolean | undefined) ??
    options.invocation.getModelBehavior<boolean>('media.pdf.enabled') ??
    readOptionalSetting(options, 'media.pdf.enabled');
  return setting !== false;
}

/**
 * Read a setting through the structurally optional `SettingsService.get`
 * seam. `get` is declared optional on the contract, so a settings object that
 * omits it must fall through to the caller's default rather than throwing.
 */
export function readOptionalSetting(
  options: NormalizedGenerateChatOptions,
  key: string,
): unknown {
  const get = (
    options as { settings?: { get?: (settingKey: string) => unknown } }
  ).settings?.get;
  return typeof get === 'function'
    ? get.call(options.settings, key)
    : undefined;
}

export function buildInput(
  options: NormalizedGenerateChatOptions,
  patchedContent: IContent[],
  invocationEphemerals: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
  serverSideParentActive: boolean = false,
): ResponsesInputItem[] {
  return buildOpenAIResponsesInput(
    patchedContent,
    responsesInputContext(
      options,
      invocationEphemerals,
      deps,
      serverSideParentActive,
    ),
  );
}

export function responsesInputContext(
  options: NormalizedGenerateChatOptions,
  invocationEphemerals: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
  serverSideParentActive: boolean = false,
): ResponsesInputBuildContext {
  const includeReasoningInContextSetting =
    (invocationEphemerals['reasoning.includeInContext'] as
      | boolean
      | undefined) ??
    options.invocation.getModelBehavior<boolean>(
      'reasoning.includeInContext',
    ) ??
    readOptionalSetting(options, 'reasoning.includeInContext');
  const outputLimiterConfig =
    options.config ??
    options.runtime?.config ??
    deps.getGlobalConfig() ??
    ({
      getEphemeralSettings: () => ({}),
    } satisfies ToolOutputSettingsProvider);
  return {
    includeReasoningInContext: includeReasoningInContextSetting !== false,
    outputLimiterConfig,
    debug: (messageFactory) => deps.logger.debug(messageFactory),
    serverSideParentActive,
    mediaPdfEnabled: isResponsesPdfEnabled(options),
  };
}

export function normalizeBaseURL(baseURLCandidate: string): string {
  let baseURL = baseURLCandidate;
  while (baseURL.endsWith('/')) baseURL = baseURL.slice(0, -1);
  return baseURL;
}

export function createRequest(
  options: NormalizedGenerateChatOptions,
  input: ResponsesInputItem[],
  requestOverrides: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
): OpenAIResponsesRequest {
  return {
    model: options.resolved.model || deps.getDefaultModel(),
    input,
    stream: true,
    ...requestOverrides,
  };
}

export function applyInstructionsAndTools(
  request: OpenAIResponsesRequest,
  systemPrompt: string,
  options: NormalizedGenerateChatOptions,
): void {
  if (systemPrompt) request.instructions = systemPrompt;

  const responsesTools = convertToolsToOpenAIResponses(options.tools);
  if (responsesTools === undefined || responsesTools.length === 0) return;

  request.tools = responsesTools;
  if (
    request.tool_choice === undefined ||
    request.tool_choice === null ||
    request.tool_choice === ''
  ) {
    request.tool_choice = 'auto';
  }
  request.parallel_tool_calls = true;
}

export function applyReasoningSettings(
  request: OpenAIResponsesRequest,
  options: NormalizedGenerateChatOptions,
  invocationEphemerals: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
): AppliedOpenAIResponsesReasoning {
  const reasoning = applyOpenAIResponsesReasoning({
    request,
    modelBehavior: options.invocation.modelBehavior,
    fallbacks: {
      enabled:
        invocationEphemerals['reasoning.enabled'] ??
        readOptionalSetting(options, 'reasoning.enabled'),
      effort:
        invocationEphemerals['reasoning.effort'] ??
        readOptionalSetting(options, 'reasoning.effort'),
      budgetTokens:
        invocationEphemerals['reasoning.budgetTokens'] ??
        readOptionalSetting(options, 'reasoning.budgetTokens'),
      summary:
        invocationEphemerals['reasoning.summary'] ??
        readOptionalSetting(options, 'reasoning.summary'),
      includeInResponse:
        invocationEphemerals['reasoning.includeInResponse'] ??
        readOptionalSetting(options, 'reasoning.includeInResponse'),
    },
    providerName: deps.providerName,
    logger: deps.logger,
  });
  deps.logger.debug(
    () =>
      `Reasoning check: enabled=${String(reasoning.enabled)}, effort=${String(reasoning.effort)}, summary=${String(reasoning.summary)}, shouldRequest=${reasoning.selected}, includeInResponse=${reasoning.includeThinkingInResponse}`,
  );
  if (reasoning.selected) {
    request.include = ['reasoning.encrypted_content'];
    deps.logger.debug(
      () => `Added include parameter: ${JSON.stringify(request.include)}`,
    );
  }
  deps.logger.debug(
    () => `Full request reasoning config: ${JSON.stringify(request.reasoning)}`,
  );
  return reasoning;
}

export function applyTextVerbosity(
  request: OpenAIResponsesRequest,
  options: NormalizedGenerateChatOptions,
  ephemerals: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
): void {
  const textVerbosity =
    (ephemerals['text.verbosity'] as string | undefined) ??
    (options as { settings?: { get: (key: string) => unknown } }).settings?.get(
      'text.verbosity',
    );
  if (
    typeof textVerbosity !== 'string' ||
    textVerbosity === '' ||
    !['low', 'medium', 'high'].includes(textVerbosity.toLowerCase())
  ) {
    return;
  }
  request.text = { verbosity: textVerbosity.toLowerCase() };
  deps.logger.debug(() => `Added text.verbosity to request: ${textVerbosity}`);
}

export function applyCodexRequestSettings(
  request: OpenAIResponsesRequest,
  isCodex: boolean,
  deps: ResponsesExecutorDeps,
): void {
  if (!isCodex) return;

  // store=false is only the Codex DEFAULT. applyStatefulConversation runs
  // after this and raises it to store=true whenever statefulness is active.
  // See the design rationale doc comment on applyStatefulConversation in
  // openAIResponsesStateful.ts for the full trade-off discussion (#3134).
  request.store = false;
  for (const parameter of deps.getUnallowedModelParameters(request.model)) {
    delete request[parameter];
  }
  if ('max_output_tokens' in request) {
    delete request.max_output_tokens;
    deps.logger.debug(
      () => 'Codex mode: removed unsupported max_output_tokens from request',
    );
  }
}

export function applyPromptCaching(
  request: OpenAIResponsesRequest,
  options: NormalizedGenerateChatOptions,
  ephemerals: Record<string, unknown>,
  isCodex: boolean,
  deps: ResponsesExecutorDeps,
): void {
  const promptCachingSetting =
    (ephemerals['prompt-caching'] as string | undefined) ??
    ((
      options as {
        settings?: {
          getProviderSettings: (name: string) => Record<string, unknown>;
        };
      }
    ).settings?.getProviderSettings(deps.providerName)['prompt-caching'] as
      | string
      | undefined) ??
    '1h';
  if (promptCachingSetting === 'off') return;

  if (
    typeof request.prompt_cache_key === 'string' &&
    request.prompt_cache_key.trim() !== ''
  ) {
    if (!isCodex) request.prompt_cache_retention = '24h';
    return;
  }

  const cacheKey =
    (options.invocation as { runtimeId?: string } | undefined)?.runtimeId ??
    options.runtime?.runtimeId;
  if (typeof cacheKey !== 'string' || cacheKey.trim() === '') return;

  request.prompt_cache_key = sanitizePromptCacheKey(cacheKey);
  if (!isCodex) request.prompt_cache_retention = '24h';
}
