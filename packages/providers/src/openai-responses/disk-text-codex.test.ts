/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import type { OAuthManager } from '@vybestack/llxprt-code-auth';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { GenerateChatOptions } from '../IProvider.js';
import { activeRequestBodyCount } from '../utils/requestScopedBody.js';
import { requestSelection } from './__tests__/support/request-selection.js';
import { projectionRuntime } from './__tests__/support/projection-ownership-fixture.js';
import {
  SocketHarness,
  completingScript,
} from './__tests__/openAIResponsesWebSocketTransport.test-helpers.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import {
  createCodexResponsesWebSocketTransport,
  type WebSocketTransport,
} from './openAIResponsesWebSocketTransport.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

const codexOAuthManager = {
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

class CodexProvider extends OpenAIResponsesProvider {
  readonly harness = new SocketHarness([completingScript('ok')]);

  constructor() {
    super(
      'codex-api-key',
      'https://chatgpt.com/backend-api/codex',
      undefined,
      codexOAuthManager as unknown as OAuthManager,
      undefined,
      'codex',
    );
  }

  protected override createWebSocketTransport(): WebSocketTransport {
    return createCodexResponsesWebSocketTransport({
      openSocket: this.harness.openSocket,
    });
  }
}

const history: readonly IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'list "files" 雪' }] },
  {
    speaker: 'ai',
    blocks: [
      { type: 'tool_call', id: 'hist_tool_ls', name: 'ls', parameters: {} },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'hist_tool_ls',
        toolName: 'ls',
        result: 'a.txt',
      },
    ],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'thanks' }] },
];

function rowsOf(list: readonly IContent[]): ProviderRequestRows {
  return {
    count: list.length,
    async *openReader(signal?: AbortSignal): AsyncGenerator<IContent, void> {
      for (const row of list) {
        signal?.throwIfAborted();
        yield structuredClone(row);
      }
    },
  };
}

function tmpPromptDirs(): Set<string> {
  return new Set(
    readdirSync(getScratchRoot()).filter((name) =>
      name.startsWith('responses-prompt-keys-'),
    ),
  );
}

describe('Responses source route with Codex over the WebSocket', () => {
  let setup: Awaited<ReturnType<typeof projectionRuntime>>;
  let provider: CodexProvider;

  beforeEach(async () => {
    setup = await projectionRuntime('http://127.0.0.1:1/v1', process.cwd());
    provider = new CodexProvider();
  });

  afterEach(async () => {
    provider.clearState();
    await setup.config.dispose();
  });

  function codexOptions(
    rows: ProviderRequestRows | ReturnType<typeof requestSelection>,
  ): GenerateChatOptions {
    const base = setup.options(rows);
    if (base.settings === undefined) throw new Error('Missing fixture');
    base.settings.setProviderSetting(provider.name, 'model', 'gpt-5.6-sol');
    return base;
  }

  it('sends the same frame and handshake as the array route', async () => {
    const before = tmpPromptDirs();
    const rows = rowsOf(history);
    for await (const _ of provider.generateChatCompletion(codexOptions(rows)));
    const selection = requestSelection({ ...rows, close: () => {} });
    const options = codexOptions(selection);
    const projection = await provider.projectPromptEnvelope(options);
    for await (const _ of provider.generateChatCompletion({
      ...options,
      promptEnvelopeTransportToken: projection.transportToken,
    }));
    const sent = provider.harness.sockets.flatMap((socket) => socket.sent);
    expect(sent).toHaveLength(2);
    expect(JSON.parse(sent[0])).toHaveProperty('type', 'response.create');
    expect(sent[1]).toBe(sent[0]);
    // Both sends ride the one connection opened with the constructor-carried
    // Codex identity.
    expect(provider.harness.headers).toHaveLength(1);
    expect(provider.harness.headers[0]).toHaveProperty(
      'ChatGPT-Account-ID',
      'acct_codex_123',
    );
    expect(provider.harness.headers[0]).toHaveProperty(
      'originator',
      'codex_cli_rs',
    );
    expect(
      [...tmpPromptDirs()].filter((entry) => !before.has(entry)),
    ).toHaveLength(0);
  }, 60000);

  for (const afterFirstChunk of [false, true]) {
    it(`releases the frame source and segments when the consumer returns ${afterFirstChunk ? 'after the first chunk' : 'before the first next'}`, async () => {
      const before = tmpPromptDirs();
      const options = codexOptions(
        requestSelection({ ...rowsOf(history), close: () => {} }),
      );
      const projection = await provider.projectPromptEnvelope(options);
      const stream = provider.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      });
      const first = afterFirstChunk ? await stream.next() : undefined;
      expect(first?.done).toBe(afterFirstChunk ? false : undefined);
      await stream.return?.();
      await projection.releaseIfUnsent?.();
      expect(activeRequestBodyCount()).toBe(0);
      expect(
        [...tmpPromptDirs()].filter((entry) => !before.has(entry)),
      ).toHaveLength(0);
    }, 60000);
  }
});
