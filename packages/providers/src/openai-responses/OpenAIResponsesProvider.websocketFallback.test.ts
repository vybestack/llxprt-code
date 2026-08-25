/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import type { WebSocketTransport } from './openAIResponsesWebSocketTransport.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { userTextsOf } from './openAIResponsesWebSocketTransport.test-helpers.js';

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const TEST_RUNTIME_ID = 'codex-ws-fallback-test-runtime';

type WebSocketScript = ReadonlyArray<'fail' | 'ok'>;

/**
 * In-process transport double. Each `streamResponse` invocation consults a
 * shared attempt counter so the same double survives the provider's connection
 * reuse (and a fresh double after `clearState()`), while the script describes
 * per-request behaviour. "fail" throws before yielding any content (a
 * recoverable pre-output blip); "ok" yields a single text chunk.
 */
class ScriptedWebSocketTransport implements WebSocketTransport {
  constructor(
    private readonly script: WebSocketScript,
    private readonly attempts: { count: number },
  ) {}

  async *streamResponse(): AsyncIterableIterator<IContent> {
    this.attempts.count += 1;
    const behavior = this.script[this.attempts.count - 1] ?? 'ok';
    if (behavior === 'fail') {
      throw new TypeError('connect ECONNREFUSED');
    }
    yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ws-ok' }] };
  }

  close(): void {}
}

/**
 * Provider subclass that injects the scripted transport without standing up a
 * real WebSocket server. The provider caches the transport it builds, so the
 * subclass returns a fresh double only when the provider asks for one (after
 * `clearState()` invalidates its cache).
 */
class TestableCodexProvider extends OpenAIResponsesProvider {
  readonly wsAttempts = { count: 0 };

  constructor(
    private readonly script: WebSocketScript,
    oauthManager: object,
  ) {
    super('codex-api-key', CODEX_BASE_URL, undefined, oauthManager);
  }

  protected override createWebSocketTransport(): WebSocketTransport {
    return new ScriptedWebSocketTransport(this.script, this.wsAttempts);
  }
}

function buildOptions(
  provider: OpenAIResponsesProvider,
  settings: SettingsService,
  contents?: IContent[],
): ReturnType<typeof createProviderCallOptions> {
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: TEST_RUNTIME_ID,
    config: createRuntimeConfigStub(settings),
  });
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: provider.name,
    ephemeralsSnapshot: { retries: 1, retrywait: 1 },
  });
  return createProviderCallOptions({
    providerName: provider.name,
    settings,
    config: createRuntimeConfigStub(settings),
    runtime,
    invocation,
    contents:
      contents ??
      ([
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hi' }] },
      ] as IContent[]),
    ephemeralSettings: { retries: 1, retrywait: 1 },
  });
}

function httpSseResponse(): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"response.output_text.delta","delta":"http"}\n\n',
        ),
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
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

interface RequestOutcome {
  readonly text: string;
  readonly fetchCalls: number;
  readonly wsAttempts: number;
}

async function runRequest(
  provider: TestableCodexProvider,
  fetchCalls: { count: number },
): Promise<string> {
  const settings = new SettingsService();
  const chunks: IContent[] = [];
  for await (const chunk of provider.generateChatCompletion(
    buildOptions(provider, settings),
  )) {
    chunks.push(chunk);
  }
  const text = chunks
    .flatMap((c) => c.blocks)
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('');
  void fetchCalls;
  return text;
}

describe('OpenAIResponsesProvider WebSocket sticky-fallback threshold (issue #3034 B1)', () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls: { count: number };

  beforeEach(() => {
    fetchCalls = { count: 0 };
    (globalThis as { fetch: unknown }).fetch = () => {
      fetchCalls.count += 1;
      return Promise.resolve(httpSseResponse());
    };
  });

  afterEach(() => {
    (globalThis as { fetch: unknown }).fetch = originalFetch;
  });

  function codexOAuthManager(): object {
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

  async function runOutcome(
    provider: TestableCodexProvider,
  ): Promise<RequestOutcome> {
    const text = await runRequest(provider, fetchCalls);
    return {
      text,
      fetchCalls: fetchCalls.count,
      wsAttempts: provider.wsAttempts.count,
    };
  }

  it('a single pre-output WebSocket failure serves this request over HTTP but the next request still tries the WebSocket', async () => {
    const provider = new TestableCodexProvider(
      ['fail', 'ok'],
      codexOAuthManager(),
    );

    const first = await runOutcome(provider);
    // The blip was recovered invisibly over HTTP, so the WebSocket was
    // attempted and HTTP carried the response.
    expect(first.wsAttempts).toBe(1);
    expect(first.fetchCalls).toBe(1);
    expect(first.text).toContain('http');

    const second = await runOutcome(provider);
    // The session was NOT permanently demoted: the WebSocket is retried and
    // succeeds without touching HTTP.
    expect(second.wsAttempts).toBe(2);
    expect(second.fetchCalls).toBe(1);
    expect(second.text).toContain('ws-ok');
  });

  it('reaching the consecutive-failure threshold makes HTTP sticky (no further WebSocket attempts)', async () => {
    const provider = new TestableCodexProvider(
      ['fail', 'fail', 'fail', 'fail'],
      codexOAuthManager(),
    );

    const r1 = await runOutcome(provider);
    expect(r1.wsAttempts).toBe(1);
    const r2 = await runOutcome(provider);
    expect(r2.wsAttempts).toBe(2);
    const r3 = await runOutcome(provider);
    expect(r3.wsAttempts).toBe(3);

    // After the 3rd consecutive pre-output failure the session sticks to HTTP.
    const r4 = await runOutcome(provider);
    expect(r4.wsAttempts).toBe(3);
    expect(r4.fetchCalls).toBe(4);
    expect(r4.text).toContain('http');
  });

  it('a successful WebSocket response between failures resets the counter (threshold is about CONSECUTIVE failures)', async () => {
    const provider = new TestableCodexProvider(
      ['fail', 'ok', 'fail', 'fail', 'fail', 'fail'],
      codexOAuthManager(),
    );

    await runOutcome(provider); // 1: fail  (consecutive=1)
    await runOutcome(provider); // 2: ok   (consecutive reset to 0)
    await runOutcome(provider); // 3: fail (consecutive=1)
    await runOutcome(provider); // 4: fail (consecutive=2)
    await runOutcome(provider); // 5: fail (consecutive=3 -> sticky)

    // Without the reset at request 2 the session would have stuck at request 3;
    // because it reset, three MORE consecutive failures were required.
    const r6 = await runOutcome(provider); // 6: sticky -> HTTP
    expect(r6.wsAttempts).toBe(5);
    expect(r6.fetchCalls).toBe(5);
    expect(r6.text).toContain('http');
  });

  it('clearState() restores WebSocket usage after the session was stuck on HTTP', async () => {
    const provider = new TestableCodexProvider(
      ['fail', 'fail', 'fail', 'ok'],
      codexOAuthManager(),
    );

    await runOutcome(provider); // fail
    await runOutcome(provider); // fail
    await runOutcome(provider); // fail -> sticky
    expect(provider.wsAttempts.count).toBe(3);

    provider.clearState();

    // The sticky downgrade and the consecutive counter are both cleared, so the
    // transport selection tries the WebSocket again.
    const after = await runOutcome(provider);
    expect(after.wsAttempts).toBe(4);
    expect(after.text).toContain('ws-ok');
  });

  describe('WebSocket->HTTP demotion drops the parent @issue:3134', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    /**
     * Codex statefulness is bound to the WebSocket connection. Verified against
     * the live backend: `store: true` is rejected outright
     * (400 `{"detail":"Store must be set to false"}`), so nothing is stored
     * server-side and a parent id cannot be resolved over HTTP — sending one
     * there is rejected, wasting a round trip and permanently suppressing
     * statefulness for the session.
     *
     * A demoted request must therefore carry NO parent and the FULL history.
     */
    it('sends full history and no previous_response_id after falling back to HTTP', async () => {
      let capturedBody: string | undefined;
      (globalThis as { fetch: unknown }).fetch = async (
        _input: unknown,
        init?: RequestInit,
      ) => {
        if (init?.body !== undefined && init.body !== null) {
          capturedBody = await new Response(init.body).text();
        }
        return httpSseResponse();
      };

      const provider = new TestableCodexProvider(['fail'], codexOAuthManager());

      const contentsWithParent: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'first question' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'first answer' }],
          metadata: {
            id: 'resp_parent',
            responsesStored: true,
            providerBaseURL: CODEX_BASE_URL,
          },
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'second question' }],
        },
      ];

      const settings = new SettingsService();
      settings.setProviderSetting(provider.name, 'model', 'gpt-5.6-sol');

      const options = buildOptions(provider, settings, contentsWithParent);
      for await (const _chunk of provider.generateChatCompletion(options)) {
        // drain
      }

      if (capturedBody === undefined) {
        throw new Error('HTTP request body was not captured');
      }
      // Prove the WebSocket was genuinely attempted and fell back; otherwise a
      // change that skipped the socket entirely would still satisfy the body
      // assertions below.
      expect(provider.wsAttempts.count).toBe(1);

      const body = JSON.parse(capturedBody) as Record<string, unknown>;
      expect(body['previous_response_id']).toBeUndefined();
      expect(body['store']).toBe(false);

      // Full history, since the HTTP endpoint cannot resolve the parent.
      const users = userTextsOf(body['input']);
      expect(users).toEqual(['first question', 'second question']);
    });
  });
});
