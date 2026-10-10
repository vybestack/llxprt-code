/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { prepareAnthropicRequest } from './AnthropicRequestPreparation.js';
import { buildAnthropicRequestHeaders } from './AnthropicApiExecution.js';
import { enforcesPreservedThinkingPrefixCheck } from './AnthropicModelData.js';
import { parseAnthropicResponse } from './AnthropicResponseParser.js';
import { processAnthropicStream } from './AnthropicStreamProcessor.js';
import type Anthropic from '@anthropic-ai/sdk';

const PRESERVED_MODELS = [
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
] as const;
const BETA = 'thinking-binding-controls-2026-08-01';

async function buildRequest(model: string, enabled: boolean) {
  const settings = new SettingsService();
  settings.set('reasoning.enabled', enabled);
  const resolved = {
    model,
    baseURL: 'https://api.anthropic.com',
    authToken: 'test-token',
  };
  const call = createProviderCallOptions({
    providerName: 'anthropic',
    settings,
    resolved,
    contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] }],
  });
  const options = {
    ...call,
    metadata: call.metadata ?? {},
    resolved,
    invocation: call.invocation,
  } satisfies NormalizedGenerateChatOptions;
  const logger = new DebugLogger('issue3834:preserved-thinking');
  const context = await prepareAnthropicRequest({
    content: options.contents,
    tools: options.tools,
    options,
    isOAuth: true,
    placement: 'context-prefix',
    providerName: 'anthropic',
    config: parseOutputLimits(options.invocation.ephemerals),
    getMaxTokensForModel: () => 128000,
    unprefixToolName: (name) => name,
    providerConfig: undefined,
    logger,
    toolsLogger: logger,
    cacheLogger: { debug: () => undefined },
  });
  const thinking = context.requestBody['thinking'];
  const headers = buildAnthropicRequestHeaders({
    baseHeaders: {},
    isOAuth: true,
    wantCaching: false,
    ttl: '5m',
    cacheLogger: { debug: () => undefined },
    model,
    thinking,
  });
  return { body: context.requestBody, headers };
}

describe('Anthropic preserved thinking @issue:3834', () => {
  it('binds adaptive thinking and retains OAuth beta values for each enforced model @issue:3834', async () => {
    for (const model of PRESERVED_MODELS) {
      const { body, headers } = await buildRequest(model, true);
      expect(body).toHaveProperty(
        'thinking.block_binding.prefix_mismatch_behavior',
        'drop_block',
      );
      const beta = headers['anthropic-beta'];
      expect(beta).toContain(BETA);
      expect(beta).toContain('oauth-2025-04-20');
      expect(beta).toContain('interleaved-thinking-2025-05-14');
    }
  });

  it('does not bind models outside the enforced set @issue:3834', async () => {
    for (const model of [
      'claude-opus-5',
      'claude-fable-5',
      'claude-sonnet-5',
      'claude-opus-4-8',
    ]) {
      const { body, headers } = await buildRequest(model, true);
      expect(body).not.toHaveProperty('thinking.block_binding');
      expect(headers['anthropic-beta']).not.toContain(BETA);
    }
  });

  it('does not bind Sonnet 5.5 between_tools thinking @issue:3834', async () => {
    const { body, headers } = await buildRequest('claude-sonnet-5-5', false);
    expect(body).toHaveProperty('thinking.type', 'between_tools');
    expect(body).not.toHaveProperty('thinking.block_binding');
    expect(headers['anthropic-beta']).not.toContain(BETA);
  });

  it('does not bind Haiku 5.5 disabled thinking @issue:3834', async () => {
    const { body, headers } = await buildRequest('claude-haiku-5-5', false);
    expect(body).toHaveProperty('thinking.type', 'disabled');
    expect(body).not.toHaveProperty('thinking.block_binding');
    expect(headers['anthropic-beta']).not.toContain(BETA);
  });

  it('accepts only exact preserved-thinking model identifiers @issue:3834', () => {
    for (const nearMiss of [
      'claude-opus-5-5-mini',
      'claude-opus-5-50',
      'claude-haiku-5-50',
      'anthropic/claude-opus-5-5',
      ' claude-opus-5-5',
      'claude-opus-5-5 ',
    ]) {
      expect(enforcesPreservedThinkingPrefixCheck(nearMiss)).toBe(false);
    }
  });

  it('logs transformations from non-streaming responses through the parser @issue:3834', () => {
    const output: string[] = [];
    const logger = new DebugLogger('issue3834:parser-log');
    logger.debug = (message) =>
      output.push(typeof message === 'function' ? message() : message);
    const message = {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
      input_transformations: [
        {
          type: 'thinking_dropped',
          path: 'messages[0]',
          reason: 'prefix_binding_mismatch',
        },
        { type: 'future_type', path: 'messages[1]', reason: 'future_reason' },
      ],
    } as unknown as Anthropic.Message;
    const options = {
      isOAuth: false,
      tools: undefined,
      unprefixToolName: (name: string) => name,
      findToolSchema: () => undefined,
      cacheLogger: logger,
      includeThinkingInResponse: true,
    };
    expect(() => parseAnthropicResponse(message, options)).not.toThrow();
    const transformationLogs = output.filter((line) =>
      line.includes('input transformation'),
    );
    expect(transformationLogs).toHaveLength(2);
    expect(transformationLogs[0]).toContain('messages[0]');
    expect(transformationLogs[0]).toContain('prefix_binding_mismatch');
    expect(transformationLogs[1]).toContain('messages[1]');
    expect(transformationLogs[1]).toContain('future_reason');
  });

  it('logs transformations from streaming message_start events @issue:3834', async () => {
    const output: string[] = [];
    const logger = new DebugLogger('issue3834:stream-log');
    logger.debug = (message) =>
      output.push(typeof message === 'function' ? message() : message);
    const message = {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 },
      input_transformations: [
        {
          type: 'thinking_dropped',
          path: 'messages[2]',
          reason: 'model_binding_mismatch',
        },
        { type: 'future_type', path: 'messages[3]', reason: 'future_reason' },
      ],
    };
    const events =
      async function* (): AsyncGenerator<Anthropic.MessageStreamEvent> {
        yield {
          type: 'message_start',
          message,
        } as unknown as Anthropic.MessageStreamEvent;
        yield { type: 'message_stop' };
      };
    const options = {
      isOAuth: false,
      tools: undefined,
      unprefixToolName: (name: string) => name,
      findToolSchema: () => undefined,
      logger,
      cacheLogger: logger,
      rateLimitLogger: logger,
      includeThinkingInResponse: true,
    };
    for await (const _content of processAnthropicStream(events(), options)) {
      // Consume the real stream path.
    }
    expect(
      output.some(
        (line) =>
          line.includes('messages[2]') &&
          line.includes('model_binding_mismatch'),
      ),
    ).toBe(true);
    expect(
      output.some(
        (line) =>
          line.includes('messages[3]') && line.includes('future_reason'),
      ),
    ).toBe(true);
  });

  it('does not log absent transformations on either response path @issue:3834', async () => {
    const output: string[] = [];
    const logger = new DebugLogger('issue3834:empty-log');
    logger.debug = (message) =>
      output.push(typeof message === 'function' ? message() : message);
    const message = {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Anthropic.Message;
    const parserOptions = {
      isOAuth: false,
      tools: undefined,
      unprefixToolName: (name: string) => name,
      findToolSchema: () => undefined,
      cacheLogger: logger,
      includeThinkingInResponse: true,
    };
    expect(() => parseAnthropicResponse(message, parserOptions)).not.toThrow();
    const streamMessage = { ...message, content: [], stop_reason: null };
    const events =
      async function* (): AsyncGenerator<Anthropic.MessageStreamEvent> {
        yield {
          type: 'message_start',
          message: streamMessage,
        } as unknown as Anthropic.MessageStreamEvent;
        yield { type: 'message_stop' };
      };
    const streamOptions = {
      isOAuth: false,
      tools: undefined,
      unprefixToolName: (name: string) => name,
      findToolSchema: () => undefined,
      logger,
      cacheLogger: logger,
      rateLimitLogger: logger,
      includeThinkingInResponse: true,
    };
    for await (const _content of processAnthropicStream(
      events(),
      streamOptions,
    )) {
      // Consume the real stream path.
    }
    expect(
      output.filter((line) => line.includes('input transformation')),
    ).toHaveLength(0);
  });
});
