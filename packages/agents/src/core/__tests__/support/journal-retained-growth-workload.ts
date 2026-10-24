/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createLockedSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { ProviderCuratedStreamOptions } from '@vybestack/llxprt-code-core/services/history/provider-request-options.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OpenAIResponsesProvider } from '@vybestack/llxprt-code-providers';
import { createRuntimeTokenizerFactory } from '@vybestack/llxprt-code-providers/composition/runtimeTokenizerFactory.js';
import { withGpt56DiskSources } from '@vybestack/llxprt-code-providers/tokenizers/gpt56-disk-tokenizer-factory.js';
import type { ChatSession, ChatSessionConfig } from '../../chatSession.js';
import { ROW_BYTES } from './journal-retained-growth-plan.js';
import { mixedText } from './journal-retained-growth-text.js';
import {
  loggingChatSession,
  readLoggingChatStream,
} from './chat-session-logging-fixture.js';

const MODEL = 'gpt-5.6';
/**
 * A turn adds about 2.3k tokens (user, reply, tool exchange). With the default
 * 0.85 compression threshold this limit triggers compression about every 9
 * turns, so the run compresses often without compressing on every send. Every
 * send estimates the whole retained history, so a small limit also keeps the
 * per-turn cost low.
 */
const CONTEXT_LIMIT = 30_000;
const INSTRUCTIONS = 'Answer from the conversation history.';

/** The model reply for a given request number; distinct text per turn. */
function responseText(request: number): string {
  return mixedText(request * 2 + 1, ROW_BYTES);
}

export type WorkloadMode = 'normal' | 'trap' | 'release-trap';

/**
 * Deliberate retention for the trap: keeps every request row the real send
 * path reads once retention is switched on, which the worker does only after
 * the baseline is taken. The normal run never constructs this class.
 */
class RetainingHistory extends HistoryService {
  readonly retained: IContent[] = [];
  retaining = false;
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
    const retaining = () => this.retaining;
    return {
      count: snapshot.count,
      pending: snapshot.pending,
      isPending: (index) => snapshot.isPending(index),
      readAt: (index, signal) => snapshot.readAt(index, signal),
      async *openReader(signal): AsyncGenerator<IContent, void, unknown> {
        for await (const row of snapshot.openReader(signal)) {
          if (retaining()) retained.push(row);
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
      const text = responseText(requests);
      const usage = {
        input_tokens: Math.ceil(Buffer.byteLength(body) / 4),
        output_tokens: 200,
        total_tokens: Math.ceil(Buffer.byteLength(body) / 4) + 200,
      };
      return new Response(
        `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: `resp_${requests}`, status: 'completed', output: [], usage } })}\n\ndata: [DONE]\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  return { server, requestCount: () => requests };
}

async function createConfig(
  root: string,
  baseURL: string,
  contextLimit: number,
): Promise<{
  config: Config;
  settings: SettingsService;
  tokenizerFactory: RuntimeTokenizerFactory;
}> {
  const settings = new SettingsService();
  settings.setProviderSetting('openai-responses', 'model', MODEL);
  settings.setProviderSetting('openai-responses', 'base-url', baseURL);
  settings.setProviderSetting('openai-responses', 'auth-key', 'test-key');
  settings.set('prompt-caching', 'off');
  settings.set('retries', 1);
  settings.set('retrywait', 0);
  settings.set('context-limit', contextLimit);
  settings.set('maxOutputTokens', 128);
  settings.set('compression.strategy', 'high-density');
  const config = new Config({
    cwd: root,
    targetDir: root,
    sessionId: randomUUID(),
    model: MODEL,
    debugMode: false,
    trustedFolder: true,
    telemetry: { enabled: false },
  });
  const nativeFactory = createRuntimeTokenizerFactory();
  await nativeFactory.prepareTokenizer?.('openai-responses', MODEL);
  return {
    config,
    settings,
    tokenizerFactory: withGpt56DiskSources(nativeFactory, root),
  };
}

export interface Workload {
  readonly chat: ChatSession;
  readonly history: HistoryService;
  readonly retainedRows: () => number;
  readonly requestCount: () => number;
  /** Starts keeping every request row; a no-op for the normal workload. */
  startRetaining(): void;
  /** Stops keeping request rows and drops those held; a no-op for normal. */
  releaseRetained(): void;
  setContextLimit(limit: number): void;
  runTurn(turn: number): Promise<void>;
  dispose(): Promise<void>;
}

function turnMessage(turn: number): IContent {
  return {
    speaker: 'human',
    blocks: [
      {
        type: 'text',
        text: `turn ${turn} question: ${mixedText(turn * 2, ROW_BYTES)}`,
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

function retentionControls(
  history: HistoryService,
): Pick<Workload, 'startRetaining' | 'releaseRetained'> {
  return {
    startRetaining() {
      if (history instanceof RetainingHistory) history.retaining = true;
    },
    releaseRetained() {
      if (!(history instanceof RetainingHistory)) return;
      history.retaining = false;
      history.retained.length = 0;
    },
  };
}

interface WorkloadRuntimeInput {
  readonly config: Config;
  readonly settings: SettingsService;
  readonly settingsOwner: SessionSettingsOwner;
  readonly tokenizerFactory: RuntimeTokenizerFactory;
  readonly history: HistoryService;
  readonly provider: OpenAIResponsesProvider;
  readonly baseURL: string;
  readonly contextLimit: number;
}

function workloadRuntime(
  input: WorkloadRuntimeInput,
): ReturnType<typeof createAgentRuntimeContext> {
  const {
    config,
    settings,
    settingsOwner,
    tokenizerFactory,
    history,
    provider,
    baseURL,
    contextLimit,
  } = input;
  const runtimeId = randomUUID();
  const providerRuntime = createProviderRuntimeContext({
    settingsService: settings,
    config,
    runtimeId,
  });
  return createAgentRuntimeContext({
    promptEstimator: tokenizerFactory,
    readRuntimeSettings: () => settingsOwner.readRuntimePolicy(),
    prepareProviderInvocation: (name, parameters, signal) =>
      settingsOwner.prepareProviderInvocation(
        runtimeId,
        name,
        parameters,
        signal,
      ),
    state: {
      runtimeId,
      sessionId: config.getSessionId(),
      provider: provider.name,
      model: MODEL,
      updatedAt: Date.now(),
      baseUrl: baseURL,
    },
    history,
    settings: { contextLimit },
    providerRuntime,
    provider: { getActiveProvider: () => provider, setActiveProvider() {} },
    tools: { listToolNames: () => [], getToolMetadata: () => undefined },
    telemetry: {
      logApiRequest() {},
      logApiResponse() {},
      logApiError() {},
    },
  });
}

export async function createWorkload(
  root: string,
  mode: WorkloadMode,
  contextLimit = CONTEXT_LIMIT,
): Promise<Workload> {
  const http = startProviderServer();
  const baseURL = `http://127.0.0.1:${http.server.port}/v1`;
  const { config, settings, tokenizerFactory } = await createConfig(
    root,
    baseURL,
    contextLimit,
  );
  const settingsOwner = new SessionSettingsOwner(settings);
  const recording = await createLockedSessionRecorder({
    sessionId: config.getSessionId(),
    projectHash: basename(root),
    chatsDir: join(root, 'chats'),
    workspaceDirs: [root],
    provider: 'openai-responses',
    model: MODEL,
  });
  const history =
    mode === 'normal'
      ? new HistoryService({ recording })
      : new RetainingHistory({ recording });
  const provider = new OpenAIResponsesProvider('test-key', baseURL);
  const runtime = workloadRuntime({
    config,
    settings,
    settingsOwner,
    tokenizerFactory,
    history,
    provider,
    baseURL,
    contextLimit,
  });
  const generation: ChatSessionConfig = { systemInstruction: INSTRUCTIONS };
  const chat = loggingChatSession(runtime, provider, generation);
  return {
    chat,
    history,
    retainedRows: () =>
      history instanceof RetainingHistory ? history.retained.length : 0,
    requestCount: http.requestCount,
    ...retentionControls(history),
    setContextLimit(limit) {
      settings.set('context-limit', limit);
    },
    async runTurn(turn) {
      if (turn > 1) addToolExchange(history, turn);
      const output = await readLoggingChatStream(
        chat,
        { message: turnMessage(turn) },
        `retained-growth-${turn}`,
      );
      if (output !== responseText(turn))
        throw new Error(`Turn ${turn} returned unexpected text`);
    },
    async dispose() {
      await history.dispose();
      await recording.dispose();
      await http.server.stop(true);
      await settingsOwner.dispose();
      await config.dispose();
    },
  };
}
