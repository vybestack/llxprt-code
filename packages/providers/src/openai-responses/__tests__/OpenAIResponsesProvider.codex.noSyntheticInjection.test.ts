/**
 * @license
 * Copyright 2026 Vybestack LLC
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
 * Behavioral regression tests for issue #3131.
 *
 * The Codex (ChatGPT backend) path used to prepend a fabricated
 * `read_file("AGENTS.md")` function_call plus a matching
 * function_call_output to the FRONT of the `input` array on every request,
 * keyed by a randomized synthetic call id. That defeated prompt-prefix
 * caching (the leading bytes changed every turn) and duplicated resolved user
 * memory (it was already carried in `instructions`).
 *
 * These tests assert on the ACTUAL serialized request body captured through a
 * mocked `fetch` — never on internal function calls or spy counts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
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

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const TEST_RUNTIME_ID = 'codex-no-synthetic-test-runtime';
const USER_MEMORY_SENTINEL = 'ZZQ_MEM_SENTINEL_3131_ZZQ';

const originalFetch = global.fetch;
const mockFetch = vi.fn();

function createMockStreamingResponse() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"type":"content.delta","delta":"ok"}\n\n'),
      );
      controller.enqueue(
        encoder.encode(
          'data: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n',
        ),
      );
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function buildCodexProviderWithOAuth(): OpenAIResponsesProvider {
  const oauthManager = {
    getOAuthToken: vi.fn(async () => ({
      access_token: 'codex-token',
      token_type: 'Bearer',
      expires_in: 3600,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'test-refresh',
      scope: 'openid',
      account_id: 'acct_codex_123',
    })),
  };

  return new OpenAIResponsesProvider(
    'codex-api-key',
    CODEX_BASE_URL,
    undefined,
    oauthManager as unknown as object,
  );
}

function buildNonCodexProvider(): OpenAIResponsesProvider {
  return new OpenAIResponsesProvider('test-api-key', OPENAI_BASE_URL);
}

interface CaptureOptions {
  userMemory?: string;
  ephemerals?: Record<string, unknown>;
}

async function captureRequestBody(
  provider: OpenAIResponsesProvider,
  contents: IContent[],
  settings: SettingsService,
  captureOptions: CaptureOptions = {},
): Promise<Record<string, unknown>> {
  const { userMemory, ephemerals = {} } = captureOptions;
  let capturedBody: string | undefined;

  mockFetch.mockImplementation(
    async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      if (init?.body !== null && init?.body !== undefined) {
        capturedBody =
          typeof init.body === 'string'
            ? init.body
            : await new Response(init.body).text();
      }
      return createMockStreamingResponse();
    },
  );

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
    userMemory,
  });

  const options = createProviderCallOptions({
    providerName: provider.name,
    settings,
    config: createRuntimeConfigStub(settings),
    runtime,
    invocation,
    contents,
    ephemeralSettings: ephemerals,
    userMemory,
  });

  for await (const _content of provider.generateChatCompletion(options)) {
    // drain
  }

  if (capturedBody === undefined) {
    throw new Error('Request body was not captured');
  }
  try {
    return JSON.parse(capturedBody) as Record<string, unknown>;
  } catch (error) {
    throw new Error('Captured request body was not valid JSON', {
      cause: error,
    });
  }
}

function inputItems(body: Record<string, unknown>): ResponsesInputItem[] {
  const input = body['input'];
  if (!Array.isArray(input)) {
    throw new Error('Expected request body to contain an "input" array');
  }
  return input as ResponsesInputItem[];
}

function serializeBody(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}

function basicCodexContents(): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'what is 2+2' }],
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: '4' }],
      metadata: { id: 'resp_1', responsesStored: true },
    },
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'and 3+3' }],
    },
  ];
}

/**
 * Shared setup for request capture: install the mock fetch and an isolated
 * provider runtime context. Both describe blocks need identical wiring.
 */
function setupRequestCaptureEnvironment(): void {
  vi.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;

  setActiveProviderRuntimeContext(
    createProviderRuntimeContext({
      settingsService: new SettingsService(),
      runtimeId: TEST_RUNTIME_ID,
    }),
  );
}

function teardownRequestCaptureEnvironment(): void {
  clearActiveProviderRuntimeContext();
  global.fetch = originalFetch;
}

describe('OpenAIResponsesProvider Codex mode does not inject synthetic AGENTS.md read (#3131)', () => {
  beforeEach(setupRequestCaptureEnvironment);

  afterEach(teardownRequestCaptureEnvironment);

  it('AC1: no synthetic read_file/AGENTS.md function_call and no synthetic call id', async () => {
    const provider = buildCodexProviderWithOAuth();
    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.6-sol');

    const body = await captureRequestBody(
      provider,
      basicCodexContents(),
      settings,
    );
    const items = inputItems(body);

    const syntheticReadCalls = items.filter((item) => {
      if (!('type' in item) || item.type !== 'function_call') return false;
      if (item.name !== 'read_file') return false;
      return item.arguments.includes('AGENTS.md');
    });
    expect(syntheticReadCalls).toHaveLength(0);

    const syntheticPrefix = 'call_synthetic_';
    const syntheticCallIds = items.filter((item) => {
      if (!('call_id' in item)) return false;
      return (
        typeof item.call_id === 'string' &&
        item.call_id.startsWith(syntheticPrefix)
      );
    });
    expect(syntheticCallIds).toHaveLength(0);
  });

  it('AC3a: user memory appears exactly once, inside instructions, never in an input item', async () => {
    const provider = buildCodexProviderWithOAuth();
    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.6-sol');

    const body = await captureRequestBody(
      provider,
      basicCodexContents(),
      settings,
      { userMemory: USER_MEMORY_SENTINEL },
    );

    const serialized = serializeBody(body);
    const occurrences = serialized.split(USER_MEMORY_SENTINEL).length - 1;
    expect(occurrences).toBe(1);

    const items = inputItems(body);
    const itemsContainingSentinel = items.filter((item) =>
      JSON.stringify(item).includes(USER_MEMORY_SENTINEL),
    );
    expect(itemsContainingSentinel).toHaveLength(0);

    const instructions = body['instructions'];
    expect(typeof instructions).toBe('string');
    expect(instructions as string).toContain(USER_MEMORY_SENTINEL);
  });

  it('AC3b: with no user memory, no input item contains "File not found: AGENTS.md"', async () => {
    const provider = buildCodexProviderWithOAuth();
    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.6-sol');

    const body = await captureRequestBody(
      provider,
      basicCodexContents(),
      settings,
    );
    const items = inputItems(body);

    const notFoundItems = items.filter((item) =>
      JSON.stringify(item).includes('File not found: AGENTS.md'),
    );
    expect(notFoundItems).toHaveLength(0);
  });

  it('AC4: Codex input is append-only across consecutive turns (leading item stable; turn N+1 strictly extends turn N)', async () => {
    const provider = buildCodexProviderWithOAuth();
    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.6-sol');

    // Turn 1: a single human turn. Codex resends the full history every
    // turn (store=false, no previous_response_id), so this is the baseline.
    const turn1Contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'turn one question' }],
      },
    ];

    // Turn 2: the prior human turn, an assistant turn that produced a
    // reasoning item (the fixed reasoning id keeps the build deterministic),
    // and a new human turn.
    const turn2Contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'turn one question' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'turn one deliberation',
            encryptedContent: 'base64-encrypted-reasoning-turn1',
            providerMetadata: {
              'openai.responses.reasoningId': 'rs_turn1_deterministic',
            },
          },
          { type: 'text', text: 'turn one answer' },
        ],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'turn two question' }],
      },
    ];

    const turn1Body = await captureRequestBody(
      provider,
      turn1Contents,
      settings,
    );
    const turn2Body = await captureRequestBody(
      provider,
      turn2Contents,
      settings,
    );

    const turn1Items = inputItems(turn1Body);
    const turn2Items = inputItems(turn2Body);

    expect(turn1Items.length).toBeGreaterThan(0);
    expect(turn2Items.length).toBeGreaterThan(turn1Items.length);

    // AC4: the leading input item is identical across consecutive turns of
    // the same session.
    expect(turn2Items[0]).toEqual(turn1Items[0]);

    // Turn N+1 must strictly extend turn N (append-only). This invariant is
    // what issue #3134 (Codex WebSocket incremental input delta) depends on
    // to reuse a delta rather than resending the full history each turn.
    expect(turn2Items.slice(0, turn1Items.length)).toEqual(turn1Items);
  });
});

describe('OpenAIResponsesProvider non-Codex mode is unchanged by Codex-only input shaping (#3131)', () => {
  beforeEach(setupRequestCaptureEnvironment);

  afterEach(teardownRequestCaptureEnvironment);

  it('AC5: non-Codex input preserves original ordering and does not hoist reasoning items', async () => {
    const provider = buildNonCodexProvider();
    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'o3');

    // History whose serialization yields a reasoning item interleaved between
    // a user turn and an assistant turn. In Codex mode the reasoning item
    // would be hoisted to index 0; the non-Codex path must leave ordering
    // untouched.
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'first question' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'deliberating',
            encryptedContent: 'base64-encrypted-reasoning',
            providerMetadata: {
              'openai.responses.reasoningId': 'rs_ac5_deterministic',
            },
          },
          { type: 'text', text: 'first answer' },
        ],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'second question' }],
      },
    ];

    const body = await captureRequestBody(provider, contents, settings);
    const items = inputItems(body);

    const types = items.map((item) =>
      'type' in item ? item.type : `role:${(item as { role?: string }).role}`,
    );

    // The reasoning item must NOT be hoisted to the front; the first item is
    // the first user message, preserving natural conversation order.
    expect(types[0]).toBe('role:user');

    const reasoningIndex = types.indexOf('reasoning');
    expect(reasoningIndex).toBeGreaterThan(-1);
    // Reasoning sits after the first user message (its natural interleaved
    // position), proving the Codex hoist did not leak.
    expect(reasoningIndex).toBeGreaterThan(0);

    // The second user message must still come last — original order preserved.
    expect(types[types.length - 1]).toBe('role:user');
  });
});
