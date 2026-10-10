/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * Issue #854: real end-to-end compression on a non-Responses provider (OpenAI
 * chat) through the CLI runtime wiring. The provider comes from a
 * ProviderManager (so it is wrapped exactly as the CLI wraps it), the
 * tokenizer factory comes from configureProviderRuntimeFactories, and only the
 * HTTP endpoint is local. A low context limit makes the third turn compress:
 * the summary request is sent, history shrinks to the summary, and the next
 * turn's request carries the summary.
 */
import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  OpenAIProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition/index.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  loggingChatSession,
  readLoggingChatStream,
} from './__tests__/support/chat-session-logging-fixture.js';

const root = sourceRootSetup();
const MODEL = 'gpt-4o';
const CONTEXT_LIMIT = 3_000;
const SUMMARY_MARKER = 'DISTINCTIVE-SUMMARY-MARKER-7f3a';
const SUMMARY = `<state_snapshot>${SUMMARY_MARKER} the user asked about the project</state_snapshot>`;
const ANSWER = 'ordinary assistant answer';

interface Captured {
  readonly body: string;
  readonly isSummary: boolean;
}

/** Local OpenAI chat-completions endpoint that recognises the compression prompt. */
function startEndpoint(): {
  server: Bun.Server<undefined>;
  requests: Captured[];
} {
  const requests: Captured[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      const body = await request.text();
      const isSummary = body.includes(
        'conversation history you are about to summarize',
      );
      requests.push({ body, isSummary });
      const text = isSummary ? SUMMARY : ANSWER;
      const usage = {
        prompt_tokens: 40,
        completion_tokens: 10,
        total_tokens: 50,
      };
      if (!/"stream"\s*:\s*true/.test(body))
        return Response.json({
          id: 'chatcmpl-local',
          object: 'chat.completion',
          model: MODEL,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: text },
              finish_reason: 'stop',
            },
          ],
          usage,
        });
      const events = [
        {
          id: 'chatcmpl-local',
          object: 'chat.completion.chunk',
          model: MODEL,
          choices: [{ index: 0, delta: { content: text } }],
        },
        {
          id: 'chatcmpl-local',
          object: 'chat.completion.chunk',
          model: MODEL,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage,
        },
      ];
      return new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') +
          'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  return { server, requests };
}

function question(turn: number): IContent {
  return {
    speaker: 'human',
    blocks: [
      {
        type: 'text',
        text: `turn ${turn} question: ${`detail-${turn} about the project `.repeat(40)}`,
      },
    ],
  };
}

async function historyTexts(history: HistoryService): Promise<string[]> {
  const texts: string[] = [];
  for await (const row of history.getCuratedForProviderStream([]))
    texts.push(
      row.blocks.map((b) => (b.type === 'text' ? b.text : '')).join(''),
    );
  return texts;
}

describe('compression through the CLI runtime wiring on OpenAI chat', () => {
  it('sends the summary request, compresses history, and carries the summary into the next turn', async () => {
    const endpoint = startEndpoint();
    const baseURL = `http://127.0.0.1:${endpoint.server.port}/v1`;
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'model', MODEL);
    settings.setProviderSetting('openai', 'base-url', baseURL);
    settings.setProviderSetting('openai', 'auth-key', 'test-key');
    settings.set('retries', 1);
    settings.set('retrywait', 0);
    settings.set('context-limit', CONTEXT_LIMIT);
    settings.set('maxOutputTokens', 128);
    settings.set('compression-threshold', 0.5);
    settings.set('compression.strategy', 'one-shot');
    const config = new Config({
      cwd: root(),
      targetDir: root(),
      sessionId: randomUUID(),
      model: MODEL,
      debugMode: false,
      settingsService: settings,
      trustedFolder: true,
      telemetry: { enabled: false },
    });
    const manager = new ProviderManager({ settingsService: settings, config });
    configureProviderRuntimeFactories(config, manager);
    manager.registerProvider(new OpenAIProvider('test-key', baseURL));
    manager.setActiveProvider('openai');
    const provider = manager.getActiveProvider();
    if (provider === undefined) throw new Error('Missing active provider');

    const factory = config.getTokenizerFactory();
    if (factory === undefined)
      throw new Error('Missing runtime tokenizer factory');
    const history = new HistoryService();
    history.setTokenizerFactory(factory);
    const providerRuntime = {
      config,
      settingsService: settings,
      runtimeId: randomUUID(),
    };
    const runtime = createAgentRuntimeContext({
      state: {
        runtimeId: providerRuntime.runtimeId,
        sessionId: config.getSessionId(),
        provider: provider.name,
        model: MODEL,
        updatedAt: Date.now(),
        baseUrl: baseURL,
      },
      history,
      settings: { contextLimit: CONTEXT_LIMIT },
      providerRuntime,
      provider: { getActiveProvider: () => provider, setActiveProvider() {} },
      tools: { listToolNames: () => [], getToolMetadata: () => undefined },
      telemetry: {
        logApiRequest() {},
        logApiResponse() {},
        logApiError() {},
      },
    });
    const chat = loggingChatSession(
      runtime,
      provider as unknown as RuntimeProvider,
      { systemInstruction: 'Answer from the conversation history.' },
    );
    try {
      let summaryAt = -1;
      for (let turn = 1; turn <= 8 && summaryAt < 0; turn++) {
        const before = endpoint.requests.length;
        const output = await readLoggingChatStream(
          chat,
          { message: question(turn) },
          `compression-e2e-${turn}`,
        );
        expect(output).toBe(ANSWER);
        if (endpoint.requests.slice(before).some((r) => r.isSummary))
          summaryAt = turn;
      }
      expect(summaryAt).toBeGreaterThan(1);
      const summaryRequests = endpoint.requests.filter((r) => r.isSummary);
      expect(summaryRequests).toHaveLength(1);
      expect(summaryRequests[0].body).toContain('detail-1 about the project');

      const texts = await historyTexts(history);
      expect(texts.some((text) => text.includes(SUMMARY_MARKER))).toBe(true);
      expect(texts.some((text) => text.includes('turn 1 question'))).toBe(
        false,
      );

      const before = endpoint.requests.length;
      await readLoggingChatStream(
        chat,
        { message: question(summaryAt + 1) },
        'compression-e2e-next',
      );
      const next = endpoint.requests.slice(before).filter((r) => !r.isSummary);
      expect(next).toHaveLength(1);
      expect(next[0].body).toContain(SUMMARY_MARKER);
      expect(next[0].body).not.toContain('turn 1 question');
    } finally {
      history.dispose();
      await endpoint.server.stop(true);
      await config.dispose();
    }
  }, 120_000);
});
