/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the Anthropic preserved-head cache-anchor breakpoint
 * (#3070 "caching during compression").
 *
 * Anthropic does not use implicit prefix matching: a cached prefix is only READ
 * at a position where a `cache_control` breakpoint was previously WRITTEN.
 * These tests prove that the message derived from the IContent carrying
 * `metadata.cacheAnchor` receives an anchor breakpoint so the byte-stable
 * compressed head is re-readable after a compression, that the total
 * breakpoint count never exceeds Anthropic's hard limit of 4, and that the
 * module-private marker never leaks onto the wire.
 *
 * The message-level assertions exercise `convertToAnthropicMessages` +
 * `attachPromptCaching` + `attachAnchorCacheControl` as pure functions over a
 * message array (no SDK, no HTTP). The gating/count cases exercise the real
 * `prepareAnthropicRequest` pipeline with a single light boundary mock for the
 * async core-prompt builder, asserting on the returned request-body structure.
 */

import { describe, expect, it, vi } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { convertToAnthropicMessages } from './AnthropicMessageNormalizer.js';
import { attachAnchorCacheControl } from './AnthropicAnchorCache.js';
import { attachPromptCaching } from './AnthropicRequestBuilder.js';
import { prepareAnthropicRequest } from './AnthropicRequestPreparation.js';
import { isAnthropicOAuthBaseURL } from './AnthropicEndpointUtils.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { AnthropicMessage } from './AnthropicMessageNormalizer.js';

// Light boundary mock: prepareAnthropicRequest builds the real system prompt
// asynchronously; stub it so the gating/count tests stay deterministic and
// network-free. This is the only mock — no SDK, no ToolFormatter, no iterators.
void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => 'core-prompt'),
}));

type DebugLogger = { debug: (fn: () => string) => void };
const noopLogger: DebugLogger = { debug: () => {} };

const convertOptions = {
  isOAuth: false,
  reasoningEnabled: false,
  config: undefined,
  unprefixToolName: (name: string) => name,
  logger: noopLogger,
};

function human(text: string, anchored = false): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    ...(anchored ? { metadata: { cacheAnchor: true } } : {}),
  };
}

function ai(text: string, anchored = false): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    ...(anchored ? { metadata: { cacheAnchor: true } } : {}),
  };
}

/**
 * Run the same two-step cache attachment that buildRequestContext performs:
 * rolling-tail first, then the anchor breakpoint.
 */
function applyCaching(
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

function cacheControlCount(messages: AnthropicMessage[]): number {
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

describe('Anthropic anchor cache breakpoint — message-level (#3070)', () => {
  it('places cache_control on the message derived from the anchored content', () => {
    const contents: IContent[] = [
      human('preserved head turn'),
      ai('preserved head reply', true),
      human('post-compression continuation'),
    ];

    const messages = applyCaching(contents);

    // The anchored entry is the AI reply (2nd content → 2nd message). Its
    // derived message must carry a cache_control breakpoint.
    const anchoredMessage = messages[1];
    expect(anchoredMessage.role).toBe('assistant');
    expect(Array.isArray(anchoredMessage.content)).toBe(true);
    const blocks = anchoredMessage.content as Array<Record<string, unknown>>;
    const lastBlock = blocks[blocks.length - 1];
    expect(lastBlock.cache_control).toStrictEqual({
      type: 'ephemeral',
      ttl: '5m',
    });

    // The last message also carries the rolling-tail breakpoint.
    expect(cacheControlCount(messages)).toBe(2);
  });

  it('keeps the anchor breakpoint at the same content boundary across two byte-identical heads', () => {
    // Two successive requests share a byte-identical preserved head; the anchor
    // entry (the AI reply) is the same in both. This is the property that makes
    // the head re-readable from cache after a compression.
    const headContents: IContent[] = [
      human('preserved head turn'),
      ai('preserved head reply', true),
    ];

    const requestOne = applyCaching([
      ...headContents,
      human('continuation one'),
    ]);
    const requestTwo = applyCaching([
      ...headContents,
      ai('more context'),
      human('continuation two'),
    ]);

    // In both requests the anchor breakpoint lands on the message derived from
    // the same anchored content (index 1, the AI reply).
    const anchorOne = requestOne[1];
    const anchorTwo = requestTwo[1];
    expect(anchorOne.role).toBe('assistant');
    expect(anchorTwo.role).toBe('assistant');
    expect(
      (anchorOne.content as Array<Record<string, unknown>>).some(
        (b) => b.cache_control !== undefined,
      ),
    ).toBe(true);
    expect(
      (anchorTwo.content as Array<Record<string, unknown>>).some(
        (b) => b.cache_control !== undefined,
      ),
    ).toBe(true);
  });

  it('produces only system + rolling tail when no entry carries the marker', () => {
    const contents: IContent[] = [human('first'), ai('second'), human('third')];

    const messages = applyCaching(contents);

    // No anchor breakpoint: only the rolling tail on the last message.
    expect(cacheControlCount(messages)).toBe(1);
    const last = messages[messages.length - 1];
    expect(
      (last.content as Array<Record<string, unknown>>).some(
        (b) => b.cache_control !== undefined,
      ),
    ).toBe(true);
    // No non-last message carries a breakpoint.
    for (let i = 0; i < messages.length - 1; i++) {
      const blocks = messages[i].content;
      if (!Array.isArray(blocks)) continue;
      for (const b of blocks) {
        expect((b as Record<string, unknown>).cache_control).toBeUndefined();
      }
    }
  });

  it('skips the anchor when it coincides with the last message (no double breakpoint)', () => {
    // Small history where the anchored entry is also the last message: the
    // rolling-tail breakpoint already covers it, so the anchor is skipped to
    // avoid wasting one of the 4 permitted breakpoints.
    const contents: IContent[] = [
      human('only head turn'),
      ai('only head reply', true),
    ];

    const messages = applyCaching(contents);

    const last = messages[messages.length - 1];
    expect(last.role).toBe('assistant');
    const blocks = last.content as Array<Record<string, unknown>>;
    // Exactly one breakpoint on the last message (the rolling tail), not two.
    expect(blocks.filter((b) => b.cache_control !== undefined)).toHaveLength(1);
  });

  it('does not leak the module-private marker onto the serialized request body', () => {
    const contents: IContent[] = [
      human('head'),
      ai('anchored reply', true),
      human('tail'),
    ];

    const messages = applyCaching(contents);

    // A Symbol-keyed property is invisible to JSON.stringify; verify that and
    // also that no block carries an unexpected key.
    const serialized = JSON.stringify({ messages });
    expect(serialized).not.toContain('anthropicCacheAnchor');
    expect(serialized).not.toContain('Symbol');

    for (const msg of messages) {
      if (!Array.isArray(msg.content)) {
        continue;
      }
      for (const block of msg.content) {
        const keys = Object.keys(block);
        // Every key must be a known Anthropic content-block field.
        for (const key of keys) {
          expect(
            [
              'type',
              'text',
              'id',
              'name',
              'input',
              'tool_use_id',
              'content',
              'is_error',
              'thinking',
              'signature',
              'data',
              'source',
              'title',
              'cache_control',
            ].includes(key),
          ).toBe(true);
        }
      }
    }
  });

  it('places no anchor breakpoint when a transform rebuilt the anchored message (accepted degradation)', () => {
    const contents: IContent[] = [
      human('head'),
      ai('anchored reply', true),
      human('tail'),
    ];

    const messages = convertToAnthropicMessages(contents, {
      ...convertOptions,
    });

    // Simulate a pipeline transform that rebuilt the anchored message object,
    // dropping the identity marker (the accepted-degradation case). Replace the
    // anchored message with a structurally-identical fresh object.
    const rebuiltSecond: AnthropicMessage = {
      role: messages[1].role,
      content: JSON.parse(JSON.stringify(messages[1].content)),
    };
    const rebuilt = [messages[0], rebuiltSecond, messages[2]];

    attachPromptCaching(rebuilt, '5m', noopLogger);
    // Must not throw and must not place an anchor breakpoint.
    expect(() =>
      attachAnchorCacheControl(rebuilt, '5m', noopLogger),
    ).not.toThrow();
    expect(cacheControlCount(rebuilt)).toBe(1);
  });

  it('honors a tool-result entry as the anchor boundary', () => {
    const toolCallId = 'tool_anchor_1';
    const contents: IContent[] = [
      human('do the thing'),
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: toolCallId,
            name: 'read_file',
            parameters: { path: '/tmp/x' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: toolCallId,
            toolName: 'read_file',
            result: 'content',
          },
        ],
        metadata: { cacheAnchor: true },
      },
      // A tool result must be followed by an assistant turn (the summary), so
      // the anchored tool-result message is never the last message and the
      // transform pipeline does not need to merge consecutive user messages.
      ai('summary of what happened so far'),
      human('continuation after the anchored tool result'),
    ];

    const messages = applyCaching(contents);

    // The anchored tool content flushes into a user message carrying the
    // tool_result; that message must carry the anchor breakpoint, and it must
    // NOT be the last message.
    const anchoredToolMessage = messages.find(
      (m) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        m.content.some(
          (b) =>
            (b as { type?: string }).type === 'tool_result' &&
            'cache_control' in b,
        ),
    );
    expect(anchoredToolMessage).toBeDefined();
    expect(anchoredToolMessage).not.toBe(messages[messages.length - 1]);
  });
});

describe('Anthropic anchor cache breakpoint — gating & count via prepareAnthropicRequest (#3070)', () => {
  function buildOptions(opts: {
    baseURL: string;
    promptCaching: 'off' | '5m' | '1h';
    isOAuth: boolean;
    contents: IContent[];
  }) {
    const callOpts = createProviderCallOptions({
      providerName: 'anthropic',
      contents: opts.contents,
      settingsOverrides: {
        provider: { 'prompt-caching': opts.promptCaching },
      },
      resolved: {
        model: 'claude-3-5-sonnet-20241022',
        baseURL: opts.baseURL,
        authToken: 'test-token',
        telemetry: { providerName: 'anthropic' },
      },
    });
    return callOpts;
  }

  async function prepare(opts: {
    baseURL: string;
    promptCaching: 'off' | '5m' | '1h';
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

  function countRequestCacheControls(requestBody: {
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

  const anchoredHead: IContent[] = [
    human('preserved head turn'),
    ai('preserved head reply', true),
    human('post-compression continuation'),
  ];

  it('native base URL + caching on: system + anchor + tail = 3 breakpoints (<= 4)', async () => {
    const ctx = await prepare({
      baseURL: 'https://api.anthropic.com',
      promptCaching: '5m',
      isOAuth: false,
      placement: 'system-field',
      contents: anchoredHead,
    });

    const total = countRequestCacheControls(
      ctx.requestBody as { system?: unknown; messages: AnthropicMessage[] },
    );
    expect(total).toBeLessThanOrEqual(4);
    expect(total).toBe(3);

    // The anchor breakpoint lands on the assistant message derived from the
    // anchored content (message index 1).
    const msgs = ctx.anthropicMessages;
    const anchorMsg = msgs[1];
    expect(anchorMsg.role).toBe('assistant');
    expect(
      (anchorMsg.content as Array<Record<string, unknown>>).some(
        (b) => b.cache_control !== undefined,
      ),
    ).toBe(true);
  });

  it('OAuth <system>-as-message[0] path: total breakpoints never exceed 4', async () => {
    const ctx = await prepare({
      baseURL: 'https://api.anthropic.com',
      promptCaching: '5m',
      isOAuth: true,
      placement: 'context-prefix',
      contents: anchoredHead,
    });

    const total = countRequestCacheControls(
      ctx.requestBody as { system?: unknown; messages: AnthropicMessage[] },
    );
    expect(total).toBeLessThanOrEqual(4);
    // OAuth: <system> message[0] (1) + anchor (1) + rolling tail (1) = 3.
    expect(total).toBe(3);

    // message[0] is the OAuth <system> user message carrying a breakpoint.
    const msgs = ctx.anthropicMessages;
    expect(msgs[0].role).toBe('user');
    expect(
      (msgs[0].content as Array<Record<string, unknown>>).some(
        (b) => b.cache_control !== undefined,
      ),
    ).toBe(true);
  });

  it('places no cache_control when caching is disabled', async () => {
    const ctx = await prepare({
      baseURL: 'https://api.anthropic.com',
      promptCaching: 'off',
      isOAuth: false,
      placement: 'system-field',
      contents: anchoredHead,
    });

    const total = countRequestCacheControls(
      ctx.requestBody as { system?: unknown; messages: AnthropicMessage[] },
    );
    expect(total).toBe(0);
    // No message carries any breakpoint (no anchor, no rolling tail).
    expect(cacheControlCount(ctx.anthropicMessages)).toBe(0);
  });

  it('places no cache_control for a non-native (third-party gateway) base URL', async () => {
    // Sanity: the gate predicate rejects the third-party host.
    expect(isAnthropicOAuthBaseURL('https://api.z.ai/v1')).toBe(false);

    const ctx = await prepare({
      baseURL: 'https://api.z.ai/v1',
      promptCaching: '5m',
      isOAuth: false,
      placement: 'system-field',
      contents: anchoredHead,
    });

    const total = countRequestCacheControls(
      ctx.requestBody as { system?: unknown; messages: AnthropicMessage[] },
    );
    // Third-party gateway: no anchor, no rolling tail, system is a plain string.
    expect(total).toBe(0);
    expect(cacheControlCount(ctx.anthropicMessages)).toBe(0);
  });

  it('produces only system + rolling tail when no entry carries the marker (native + caching on)', async () => {
    const noMarkerHead: IContent[] = [
      human('first'),
      ai('second'),
      human('third'),
    ];

    const ctx = await prepare({
      baseURL: 'https://api.anthropic.com',
      promptCaching: '5m',
      isOAuth: false,
      placement: 'system-field',
      contents: noMarkerHead,
    });

    const total = countRequestCacheControls(
      ctx.requestBody as { system?: unknown; messages: AnthropicMessage[] },
    );
    // system (1) + rolling tail (1) = 2; no anchor breakpoint.
    expect(total).toBe(2);
  });
});
