/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { convertToAnthropicMessages } from './AnthropicMessageNormalizer.js';
import { attachAnchorCacheControl } from './AnthropicAnchorCache.js';
import { attachPromptCaching } from './AnthropicRequestBuilder.js';
import { prepareAnthropicRequest } from './AnthropicRequestPreparation.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { AnthropicMessage } from './AnthropicMessageNormalizer.js';
type CacheTestLogger = { debug: (fn: () => string) => void };

export function human(text: string, anchored = false): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    ...(anchored ? { metadata: { cacheAnchor: true } } : {}),
  };
}

export function ai(text: string, anchored = false): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    ...(anchored ? { metadata: { cacheAnchor: true } } : {}),
  };
}

export function applyCaching(
  contents: IContent[],
  ttl: '5m' | '1h' = '5m',
): AnthropicMessage[] {
  const messages = convertToAnthropicMessages(contents, {
    ...convertOptions,
  });
  attachPromptCaching(messages, ttl, noopLogger);
  attachAnchorCacheControl(messages, ttl, noopLogger);
  return messages;
}

export function cacheControlCount(messages: AnthropicMessage[]): number {
  let count = 0;
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) {
      continue;
    }
    for (const block of msg.content) {
      if ('cache_control' in block) {
        count++;
      }
    }
  }
  return count;
}

export function cacheControlLocations(messages: AnthropicMessage[]): string[] {
  const locations: string[] = [];
  for (
    let messageIndex = 0;
    messageIndex < messages.length;
    messageIndex += 1
  ) {
    const content = messages[messageIndex]?.content;
    if (!Array.isArray(content)) continue;
    for (let blockIndex = 0; blockIndex < content.length; blockIndex += 1) {
      const block = content[blockIndex];
      if ('cache_control' in block) {
        locations.push(`${messageIndex}:${blockIndex}`);
      }
    }
  }
  return locations;
}

export function buildOptions(opts: {
  baseURL: string;
  promptCaching: 'off' | '5m' | '1h';
  semanticMediaPurge?: unknown;
  isOAuth: boolean;
  contents: IContent[];
}) {
  const callOpts = createProviderCallOptions({
    providerName: 'anthropic',
    contents: opts.contents,
    settingsOverrides: {
      global:
        opts.semanticMediaPurge === undefined
          ? undefined
          : { 'media.semantic-purge': opts.semanticMediaPurge },
      provider: { 'prompt-caching': opts.promptCaching },
    },
    resolved: {
      model: 'claude-3-5-sonnet-20241022',
      baseURL: opts.baseURL,
      authToken: 'test-token',
      telemetry: { providerName: 'anthropic' },
    },
  });
  return {
    ...callOpts,
    contents: opts.contents,
    metadata: {},
    resolved: {
      model: 'claude-3-5-sonnet-20241022',
      baseURL: opts.baseURL,
      authToken: 'test-token',
      telemetry: { providerName: 'anthropic' },
    },
  };
}

export async function prepare(opts: {
  baseURL: string;
  promptCaching: 'off' | '5m' | '1h';
  semanticMediaPurge?: unknown;
  isOAuth: boolean;
  placement: 'system-field' | 'context-prefix';
  contents: IContent[];
}) {
  const callOpts = buildOptions(opts);
  return prepareAnthropicRequest({
    content: callOpts.contents,
    tools: callOpts.tools,
    options: callOpts,
    isOAuth: opts.isOAuth,
    placement: opts.placement,
    providerName: 'anthropic',
    config: undefined,
    getMaxTokensForModel: () => 4096,
    unprefixToolName: (name: string) => name,
    providerConfig: undefined,
    logger: new DebugLogger('test:anthropic-anchor-cache'),
    toolsLogger: new DebugLogger('test:anthropic-anchor-cache:tools'),
    cacheLogger: noopLogger,
  });
}

export function countRequestCacheControls(requestBody: {
  system?: unknown;
  messages: AnthropicMessage[];
}): number {
  let count = 0;
  const system = requestBody.system;
  if (Array.isArray(system)) {
    for (const block of system) {
      if (
        block !== null &&
        typeof block === 'object' &&
        'cache_control' in block
      ) {
        count++;
      }
    }
  }
  count += cacheControlCount(requestBody.messages);
  return count;
}
export const noopLogger: CacheTestLogger = { debug: () => {} };

export const convertOptions = {
  isOAuth: false,
  reasoningEnabled: false,
  config: undefined,
  unprefixToolName: (name: string) => name,
  logger: noopLogger,
};
