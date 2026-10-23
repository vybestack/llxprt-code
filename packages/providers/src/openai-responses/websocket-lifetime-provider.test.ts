/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { z } from 'zod';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import {
  createCodexResponsesWebSocketTransport,
  type WebSocketTransport,
} from './openAIResponsesWebSocketTransport.js';
import {
  SocketHarness,
  completingWithId,
  connectionLimitErrorFrame,
  drain,
  frame,
  userTextsOf,
} from './__tests__/openAIResponsesWebSocketTransport.test-helpers.js';

const BASE_URL = 'https://chatgpt.com/backend-api/codex';
const RENEWAL_MS = 55 * 60 * 1000;
const providers: OpenAIResponsesProvider[] = [];
const originalFetch = globalThis.fetch;
let httpRequests = 0;

class SocketBoundaryProvider extends OpenAIResponsesProvider {
  constructor(private readonly harness: SocketHarness) {
    super('test-key', BASE_URL, undefined, undefined, [], 'codex');
    providers.push(this);
  }

  protected override createWebSocketTransport(): WebSocketTransport {
    return createCodexResponsesWebSocketTransport({
      openSocket: this.harness.openSocket,
    });
  }

  protected override async getCodexAccountId(): Promise<string> {
    return 'test-account';
  }

  protected override async getAuthTokenForPrompt(): Promise<string> {
    return 'test-token';
  }
}

function runTurn(
  provider: OpenAIResponsesProvider,
  contents: IContent[],
): Promise<readonly IContent[]> {
  globalThis.fetch = Object.assign(async (): Promise<Response> => {
    httpRequests += 1;
    throw new Error('Unexpected HTTP fallback during healthy renewal');
  }, originalFetch);
  const settings = new SettingsService();
  settings.setProviderSetting(provider.name, 'model', 'gpt-5.6-sol');
  const config = createRuntimeConfigStub(settings);
  const runtime = createProviderRuntimeContext({
    runtimeId: 'lifetime-provider',
  });
  settings.set('retries', 0);
  settings.set('reasoning.includeInResponse', false);
  const invocation = captureProviderInvocation(
    {
      runtimeId: runtime.runtimeId,
      metadata: runtime.metadata,
      globalSettings: settings.getAllGlobalSettings(),
      providerSettings: settings.getProviderSettings(provider.name),
    },
    provider.name,
  );
  return drain(
    provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        settings,
        config,
        runtime,
        invocation,
        contents,
        systemInstruction: 'Test the Responses connection lifecycle.',
      }),
    ),
  );
}

function human(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function answer(messages: readonly IContent[]): IContent {
  const metadata = messages.find((message) => message.metadata)?.metadata;
  if (metadata?.id === undefined)
    throw new Error('Missing successful response id');
  return {
    speaker: 'ai',
    blocks: messages.flatMap((message) => message.blocks),
    metadata,
  };
}

const envelopeSchema = z.object({
  previous_response_id: z.string().optional(),
  input: z.array(z.unknown()),
});

function sent(
  harness: SocketHarness,
  socket: number,
  turn = 0,
): z.infer<typeof envelopeSchema> {
  return envelopeSchema.parse(JSON.parse(harness.sockets[socket].sent[turn]));
}

describe('Codex provider lifetime renewal through the real parser and transport', () => {
  afterEach(() => {
    for (const provider of providers) provider.clearState();
    providers.length = 0;
    globalThis.fetch = originalFetch;
    httpRequests = 0;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  for (const hidden of [false, true]) {
    it(`recovers the documented parentless 400 with hidden reasoning=${hidden}`, async () => {
      const harness = new SocketHarness([
        (socket) => {
          socket.open();
          socket.onSend = () => {
            if (hidden)
              socket.message(
                frame({
                  type: 'response.reasoning_summary_text.delta',
                  delta: 'discarded thought',
                }),
              );
            socket.message(connectionLimitErrorFrame());
          };
        },
        completingWithId('fresh', 'fresh answer'),
      ]);
      const provider = new SocketBoundaryProvider(harness);
      const history = [human('first question')];

      const recovered = await runTurn(provider, history);

      expect(answer(recovered).blocks).toStrictEqual([
        { type: 'text', text: 'fresh answer' },
      ]);
      expect(answer(recovered).metadata?.responsesStored).toBe(true);
      expect(httpRequests).toBe(0);
      await runTurn(provider, [
        ...history,
        answer(recovered),
        human('next question'),
      ]);
      expect(harness.sockets).toHaveLength(2);
      expect(sent(harness, 1, 1).previous_response_id).toBe('fresh');
      expect(userTextsOf(sent(harness, 1, 1).input)).toStrictEqual([
        'next question',
      ]);
    });
  }

  for (const renewal of [
    'server',
    'hidden-server',
    'timer',
    'delayed-timer',
    'idle-server',
  ]) {
    it(`preserves the full conversation and re-establishes stateful chaining after ${renewal}`, async () => {
      vi.useFakeTimers();
      const harness = new SocketHarness([
        completingWithId('old-parent', 'first answer'),
        completingWithId('fresh-parent', 'second answer'),
      ]);
      const provider = new SocketBoundaryProvider(harness);
      const first = await runTurn(provider, [human('first question')]);
      const history = [
        human('first question'),
        answer(first),
        human('second question'),
      ];
      if (renewal === 'server' || renewal === 'hidden-server') {
        harness.sockets[0].onSend = () => {
          if (renewal === 'hidden-server')
            harness.sockets[0].message(
              frame({
                type: 'response.reasoning_summary_text.delta',
                delta: 'discarded thought',
              }),
            );
          harness.sockets[0].message(connectionLimitErrorFrame());
        };
      } else if (renewal === 'timer') {
        await advanceTimersByTimeAsync(RENEWAL_MS);
      } else if (renewal === 'delayed-timer') {
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + RENEWAL_MS);
      } else {
        harness.sockets[0].message(connectionLimitErrorFrame());
      }

      const recovered = await runTurn(provider, history);

      expect(answer(recovered).blocks).toStrictEqual([
        { type: 'text', text: 'second answer' },
      ]);
      expect(harness.sockets).toHaveLength(2);
      const rebuilt = sent(harness, 1);
      expect(rebuilt.previous_response_id).toBeUndefined();
      expect(userTextsOf(rebuilt.input)).toStrictEqual([
        'first question',
        'second question',
      ]);
      expect(JSON.stringify(rebuilt.input)).toContain('first answer');
      expect(httpRequests).toBe(0);
      expect(harness.sockets[0].sent).toHaveLength(
        renewal.endsWith('server') && renewal !== 'idle-server' ? 2 : 1,
      );

      await runTurn(provider, [
        ...history,
        answer(recovered),
        human('third question'),
      ]);
      expect(sent(harness, 1, 1).previous_response_id).toBe('fresh-parent');
      expect(userTextsOf(sent(harness, 1, 1).input)).toStrictEqual([
        'third question',
      ]);
      expect(harness.sockets).toHaveLength(2);
      expect(httpRequests).toBe(0);
    });
  }
});
