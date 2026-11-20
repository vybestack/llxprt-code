/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * The history-array `/dump` builders. They convert a whole `IContent[]` into
 * the provider message array and exist only as the reference the streaming
 * dump (`buildProviderDumpBodyStream`) is compared with; no product code calls
 * them (issue #854 F1).
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { OutputLimitConfig } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { convertToAnthropicMessages } from '../../../anthropic/AnthropicMessageNormalizer.js';
import { buildMessagesWithReasoning } from '../../../openai/OpenAIRequestBuilder.js';
import {
  anthropicDumpOptions,
  dumpProviderFamily,
  openAIDumpOptions,
  withModel,
} from '../../providerRequestConversion.js';

export function buildOpenAIDumpMessages(
  history: IContent[],
  policy?: Readonly<Record<string, unknown>>,
  config?: OutputLimitConfig,
): unknown[] {
  return buildMessagesWithReasoning(
    history,
    openAIDumpOptions(policy),
    'openai',
    config,
  );
}

export function buildAnthropicDumpMessages(
  history: IContent[],
  policy?: Readonly<Record<string, unknown>>,
  config?: OutputLimitConfig,
  model?: string,
  baseURL?: string,
): unknown[] {
  return convertToAnthropicMessages(
    history,
    anthropicDumpOptions(policy, config, model, baseURL),
  );
}

export function buildProviderDumpBody(params: {
  providerName: string;
  history: IContent[];
  policy?: Readonly<Record<string, unknown>>;
  config?: OutputLimitConfig;
  model?: string;
  baseURL?: string;
}): Record<string, unknown> {
  const family = dumpProviderFamily(params.providerName);
  if (family === 'openai') {
    return withModel(
      {
        messages: buildOpenAIDumpMessages(
          params.history,
          params.policy,
          params.config,
        ),
      },
      params.model,
    );
  }
  if (family === 'anthropic') {
    return withModel(
      {
        messages: buildAnthropicDumpMessages(
          params.history,
          params.policy,
          params.config,
          params.model,
          params.baseURL,
        ),
      },
      params.model,
    );
  }
  return { history: params.history };
}
