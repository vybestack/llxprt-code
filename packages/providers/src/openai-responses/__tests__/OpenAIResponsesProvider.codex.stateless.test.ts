/**
 * @license
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Issue #3134: Codex statefulness — stop resending full history.
 *
 * The OpenAI Responses API supports server-side statefulness via store=true
 * and previous_response_id. Codex mode previously force-disabled this,
 * resending the entire conversation on every request. These tests verify the
 * new behavior: statefulness is ON BY DEFAULT for Codex, trims history to the
 * delta when a stored parent exists, and falls back to full history when no
 * parent is available or the user explicitly opts out.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResponsesInputItem } from '../OpenAIResponsesTypes.js';
import type { OpenAIResponsesRequest } from '../OpenAIResponsesTypes.js';
import type {
  StreamResponseOptions,
  WebSocketTransport,
} from '../openAIResponsesWebSocketTransport.js';

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const TEST_RUNTIME_ID = 'codex-stateful-test-runtime';

/**
 * In-process WebSocket transport double that records every request sent and
 * yields a deterministic completion. Mirrors what parseResponsesStream would
 * produce when responsesStored is true, so the parent-lookup logic can chain.
 */
class RecordingTransport implements WebSocketTransport {
  readonly sentRequests: OpenAIResponsesRequest[] = [];
  lastOptions: StreamResponseOptions | undefined;

  async *streamResponse(
    request: OpenAIResponsesRequest,
    options: StreamResponseOptions,
  ): AsyncIterableIterator<IContent> {
    this.sentRequests.push(structuredClone(request));
    this.lastOptions = options;
    yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
    yield {
      speaker: 'ai',
      blocks: [],
      metadata: {
        id: 'resp_completed',
        ...(options.responsesStored === true ? { responsesStored: true } : {}),
        stopReason: 'end_turn',
        finishReason: 'completed',
      },
    };
  }

  close(): void {}
}

/**
 * Provider subclass that injects the recording transport so we can observe
 * the exact request the executor builds, without standing up a real WebSocket
 * server or falling back to HTTP.
 */
class TestableCodexProvider extends OpenAIResponsesProvider {
  readonly recordingTransport = new RecordingTransport();

  constructor(oauthManager: object) {
    super('codex-api-key', CODEX_BASE_URL, undefined, oauthManager);
  }

  protected override createWebSocketTransport(): WebSocketTransport {
    return this.recordingTransport;
  }
}

function buildCodexOAuthManager(): object {
  return {
    getOAuthToken: async () => ({
      access_token: 'codex-token',
      token_type: 'Bearer',
      expires_in: 3600,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'test-refresh',
      scope: 'openid',
      account_id: 'acct_codex_123',
    }),
  };
}

async function captureRequestBody(
  provider: TestableCodexProvider,
  contents: IContent[],
  settings: SettingsService,
  ephemerals: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: TEST_RUNTIME_ID,
    config: createRuntimeConfigStub(settings),
  });

  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: provider.name,
    ephemeralsSnapshot: ephemerals,
  });

  const options = createProviderCallOptions({
    providerName: provider.name,
    settings,
    config: createRuntimeConfigStub(settings),
    runtime,
    invocation,
    contents,
    ephemeralSettings: ephemerals,
  });

  for await (const _content of provider.generateChatCompletion(options)) {
    // drain
  }

  const sent = provider.recordingTransport.sentRequests;
  if (sent.length === 0) {
    throw new Error('No request was sent over the WebSocket transport');
  }
  return sent[0] as unknown as Record<string, unknown>;
}

function inputItems(body: Record<string, unknown>): ResponsesInputItem[] {
  const input = body['input'];
  if (!Array.isArray(input)) {
    throw new Error('Expected request body to contain an "input" array');
  }
  return input as ResponsesInputItem[];
}

function extractContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === 'object' && part !== null && 'text' in part) {
          const text = (part as { text: unknown }).text;
          return text === null || text === undefined ? '' : String(text);
        }
        return '';
      })
      .join('');
  }
  return '';
}

function userMessages(items: ResponsesInputItem[]): string[] {
  const messages: string[] = [];
  for (const i of items) {
    if ('role' in i && i.role === 'user') {
      const text = extractContent(i.content);
      if (text) messages.push(text);
    }
  }
  return messages;
}

function assistantMessages(items: ResponsesInputItem[]): string[] {
  const messages: string[] = [];
  for (const i of items) {
    if ('role' in i && i.role === 'assistant') {
      const text = extractContent(i.content);
      if (text) messages.push(text);
    }
  }
  return messages;
}

describe('OpenAIResponsesProvider Codex stateful conversations @issue:3134', () => {
  beforeEach(() => {
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: TEST_RUNTIME_ID,
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('T1: sends previous_response_id and omits the parent turn when a stored parent exists', async () => {
    const provider = new TestableCodexProvider(buildCodexOAuthManager());

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.6-sol');

    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'first question' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'first answer' }],
        metadata: {
          id: 'resp_1',
          responsesStored: true,
          providerBaseURL: CODEX_BASE_URL,
        },
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'second question' }],
      },
    ];

    const body = await captureRequestBody(provider, contents, settings, {});

    expect(body['previous_response_id']).toBe('resp_1');
    expect(body['store']).toBe(false);

    const items = inputItems(body);
    const users = userMessages(items);
    const assistants = assistantMessages(items);

    // The parent turn and everything before it must be omitted.
    expect(users).not.toContain('first question');
    expect(assistants).not.toContain('first answer');
    expect(users).toContain('second question');
  });

  it('T2: sends full history and no previous_response_id when no stored parent exists', async () => {
    const provider = new TestableCodexProvider(buildCodexOAuthManager());

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.6-sol');

    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'first question' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'first answer' }],
        // No responsesStored metadata — not a valid parent.
        metadata: { id: 'resp_1' },
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'second question' }],
      },
    ];

    const body = await captureRequestBody(provider, contents, settings, {});

    expect(body['previous_response_id']).toBeUndefined();
    // The Codex backend REJECTS store=true (400 "Store must be set to false"),
    // so Codex chains via the socket-held parent, never via stored responses.
    expect(body['store']).toBe(false);
    const items = inputItems(body);
    const users = userMessages(items);
    const assistants = assistantMessages(items);

    expect(users).toContain('first question');
    expect(assistants).toContain('first answer');
    expect(users).toContain('second question');
  });

  it('T3: statefulness is active by default with no responses-stateful ephemeral set', async () => {
    const provider = new TestableCodexProvider(buildCodexOAuthManager());

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.6-sol');

    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'first question' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'first answer' }],
        metadata: {
          id: 'resp_1',
          responsesStored: true,
          providerBaseURL: CODEX_BASE_URL,
        },
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'second question' }],
      },
    ];

    // No 'responses-stateful' ephemeral — proves Codex defaults ON (B2).
    const body = await captureRequestBody(provider, contents, settings, {});

    expect(body['previous_response_id']).toBe('resp_1');
    expect(body['store']).toBe(false);

    const items = inputItems(body);
    expect(userMessages(items)).not.toContain('first question');
    expect(userMessages(items)).toContain('second question');
  });

  it('T4: explicit store=false override disables statefulness and strips previous_response_id', async () => {
    const provider = new TestableCodexProvider(buildCodexOAuthManager());

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.6-sol');
    settings.setProviderSetting(provider.name, 'store', false);

    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'first question' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'first answer' }],
        metadata: {
          id: 'resp_1',
          responsesStored: true,
          providerBaseURL: CODEX_BASE_URL,
        },
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'second question' }],
      },
    ];

    const body = await captureRequestBody(provider, contents, settings, {});

    expect(body['previous_response_id']).toBeUndefined();
    expect(body['store']).toBe(false);

    const items = inputItems(body);
    const users = userMessages(items);
    const assistants = assistantMessages(items);

    // Full history must be present — statefulness is disabled.
    expect(users).toContain('first question');
    expect(assistants).toContain('first answer');
    expect(users).toContain('second question');
  });

  it('T5: a completed Codex response stamps metadata.responsesStored + metadata.id so the next turn can chain', async () => {
    // B6 end-to-end: the executor must pass responsesStored=true to the
    // transport so parseResponsesStream stamps metadata.responsesStored +
    // metadata.id on the completion IContent. Without this the B4 parent
    // lookup can never succeed and the feature is inert.
    const provider = new TestableCodexProvider(buildCodexOAuthManager());

    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.6-sol');

    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'question' }],
      },
    ];

    const runtime = createProviderRuntimeContext({
      settingsService: settings,
      runtimeId: TEST_RUNTIME_ID,
      config: createRuntimeConfigStub(settings),
    });

    const invocation = createRuntimeInvocationContext({
      runtime,
      settings,
      providerName: provider.name,
      ephemeralsSnapshot: {},
    });

    const options = createProviderCallOptions({
      providerName: provider.name,
      settings,
      config: createRuntimeConfigStub(settings),
      runtime,
      invocation,
      contents,
      ephemeralSettings: {},
    });

    const output: IContent[] = [];
    for await (const content of provider.generateChatCompletion(options)) {
      output.push(content);
    }

    // The executor must have told the transport that responses are stored.
    expect(provider.recordingTransport.lastOptions?.responsesStored).toBe(true);

    // The completion IContent must carry the metadata stamp.
    const completion = output.find(
      (c) => c.metadata !== undefined && c.blocks.length === 0,
    );
    expect(completion).toBeDefined();
    expect(completion!.metadata!.responsesStored).toBe(true);
    expect(completion!.metadata!.id).toBe('resp_completed');
  });
});
