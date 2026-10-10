/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { ProviderCuratedStreamOptions } from '@vybestack/llxprt-code-core/services/history/provider-curated-stream.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OpenAIResponsesProvider } from '@vybestack/llxprt-code-providers';
import { createRuntimeTokenizerFactory } from '@vybestack/llxprt-code-providers/composition/runtimeTokenizerFactory.js';
import { withGpt56DiskSources } from '@vybestack/llxprt-code-providers/tokenizers/gpt56-disk-tokenizer-factory.js';
import type { ChatSession, ChatSessionConfig } from '../../chatSession.js';
import {
  loggingChatSession,
  readLoggingChatStream,
} from './chat-session-logging-fixture.js';

const MODEL = 'gpt-5.6';
const CONTEXT_LIMIT = 5_000;
const INSTRUCTIONS = 'Answer from the conversation history.';
const RESPONSE_TEXT = `${'assistant reply '.repeat(40)}done`;

export type WorkloadMode = 'normal' | 'trap';

/**
 * Deliberate retention for the trap: keeps every request row the real send
 * path reads. The normal run never constructs this class.
 */
class RetainingHistory extends HistoryService {
  readonly retained: IContent[] = [];
  override async prepareCuratedForProviderSnapshot(
    pending: readonly IContent[] = [],
    options: ProviderCuratedStreamOptions = {},
    override?: Iterable<IContent> | AsyncIterable<IContent>,
  ): Promise<ProviderRequestSnapshot> {
    const snapshot = await super.prepareCuratedForProviderSnapshot(
      pending,
      options,
      override,
    );
    const retained = this.retained;
    return {
      count: snapshot.count,
      pending: snapshot.pending,
      isPending: (index) => snapshot.isPending(index),
      async *openReader(signal): AsyncGenerator<IContent, void, unknown> {
        for await (const row of snapshot.openReader(signal)) {
          retained.push(row);
          yield row;
        }
      },
      close: () => snapshot.close(),
    };
  }
}

/** Local server speaking the OpenAI Responses SSE protocol. */
function startProviderServer(): {
  server: Bun.Server<undefined>;
  requestCount(): number;
} {
  let requests = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      const body = await request.text();
      requests += 1;
      const usage = {
        input_tokens: Math.ceil(Buffer.byteLength(body) / 4),
        output_tokens: 200,
        total_tokens: Math.ceil(Buffer.byteLength(body) / 4) + 200,
      };
      return new Response(
        `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: RESPONSE_TEXT })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: `resp_${requests}`, status: 'completed', output: [], usage } })}\n\ndata: [DONE]\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  return { server, requestCount: () => requests };
}

async function createConfig(
  root: string,
  baseURL: string,
): Promise<{ config: Config; settings: SettingsService }> {
  const settings = new SettingsService();
  settings.setProviderSetting('openai-responses', 'model', MODEL);
  settings.setProviderSetting('openai-responses', 'base-url', baseURL);
  settings.setProviderSetting('openai-responses', 'auth-key', 'test-key');
  settings.set('prompt-caching', 'off');
  settings.set('retries', 1);
  settings.set('retrywait', 0);
  settings.set('context-limit', CONTEXT_LIMIT);
  settings.set('maxOutputTokens', 128);
  settings.set('compression.strategy', 'high-density');
  const config = new Config({
    cwd: root,
    targetDir: root,
    sessionId: randomUUID(),
    model: MODEL,
    debugMode: false,
    settingsService: settings,
    trustedFolder: true,
    telemetry: { enabled: false },
  });
  const nativeFactory = createRuntimeTokenizerFactory();
  await nativeFactory.prepareTokenizer?.('openai-responses', MODEL);
  config.setTokenizerFactory(withGpt56DiskSources(nativeFactory, root));
  return { config, settings };
}

export interface Workload {
  readonly chat: ChatSession;
  readonly history: HistoryService;
  readonly retainedRows: () => number;
  readonly requestCount: () => number;
  runTurn(turn: number): Promise<void>;
  dispose(): Promise<void>;
}

function turnMessage(turn: number): IContent {
  return {
    speaker: 'human',
    blocks: [
      {
        type: 'text',
        text: `turn ${turn} question: ${`detail-${turn % 7} `.repeat(100)}`,
      },
    ],
  };
}

/** Tool call and result rows, as the scheduler records them between sends. */
function addToolExchange(history: HistoryService, turn: number): void {
  const callId = `call-${turn}`;
  history.add({
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: callId,
        name: 'lookup',
        parameters: { query: `turn ${turn}` },
      },
    ],
  });
  history.add({
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName: 'lookup',
        result: `result ${turn} ${'payload '.repeat(80)}`,
      },
    ],
  });
}

export async function createWorkload(
  root: string,
  mode: WorkloadMode,
): Promise<Workload> {
  const http = startProviderServer();
  const baseURL = `http://127.0.0.1:${http.server.port}/v1`;
  const { config, settings } = await createConfig(root, baseURL);
  const recording = await SessionRecordingService.createLocked({
    sessionId: config.getSessionId(),
    projectHash: basename(root),
    chatsDir: join(root, 'chats'),
    workspaceDirs: [root],
    provider: 'openai-responses',
    model: MODEL,
  });
  const history =
    mode === 'trap'
      ? new RetainingHistory({ recording })
      : new HistoryService({ recording });
  const provider = new OpenAIResponsesProvider('test-key', baseURL);
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
  const generation: ChatSessionConfig = { systemInstruction: INSTRUCTIONS };
  const chat = loggingChatSession(runtime, provider, generation);
  return {
    chat,
    history,
    retainedRows: () =>
      history instanceof RetainingHistory ? history.retained.length : 0,
    requestCount: http.requestCount,
    async runTurn(turn) {
      if (turn > 1) addToolExchange(history, turn);
      const output = await readLoggingChatStream(
        chat,
        { message: turnMessage(turn) },
        `retained-growth-${turn}`,
      );
      if (output !== RESPONSE_TEXT)
        throw new Error(`Turn ${turn} returned unexpected text`);
    },
    async dispose() {
      history.dispose();
      await recording.dispose();
      await http.server.stop(true);
      await config.dispose();
    },
  };
}
