/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { validateBeforeModelInput } from '@vybestack/llxprt-code-core/hooks/hookValidators.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { OpenAIResponsesProvider } from '@vybestack/llxprt-code-providers';
import { createRuntimeTokenizerFactory } from '@vybestack/llxprt-code-providers/composition/providerManagerInstance.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import { CompressionHandler } from '../compression/CompressionHandler.js';
import { ConversationManager } from './ConversationManager.js';
import { StreamProcessor } from './StreamProcessor.js';

const rowCount = 64;
const instructions = 'Inspect the supplied rows.';

function rowText(index: number): string {
  return `disk-${index}:"\\\n雪`;
}

function historyRow(index: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: rowText(index) }],
  };
}

class ObservedDiskHistory extends HistoryService {
  pulled = 0;
  activeReaders = 0;
  closedReaders = 0;
  readonly retained: IContent[] = [];
  readonly ownership = new RowOwnership();
  abortDuringRead: AbortController | undefined;

  private async *observedRows(signal?: AbortSignal): AsyncGenerator<IContent> {
    this.activeReaders += 1;
    try {
      for await (const row of super.streamRawHistory(signal)) {
        this.pulled += 1;
        if (process.env.ISSUE854_RETAIN_REQUEST_OWNER === '1') {
          this.ownership.retain(row);
          this.retained.push(row);
        }
        this.abortDuringRead?.abort(new Error('disk request aborted'));
        yield row;
      }
    } finally {
      this.activeReaders -= 1;
      this.closedReaders += 1;
    }
  }

  override async *getCuratedForProviderStream(
    tail: IContent[] = [],
    signal?: AbortSignal,
    historyOverride?: Iterable<IContent> | AsyncIterable<IContent>,
  ): AsyncGenerator<IContent, void, unknown> {
    yield* super.getCuratedForProviderStream(
      tail,
      signal,
      historyOverride ?? this.observedRows(signal),
    );
  }
}

interface Observation {
  beforeBody: number;
  afterFirstPull: number;
  wire: string;
}

interface RuntimeFixture {
  config: Config;
  settings: SettingsService;
  tokenizer: RuntimeTokenizerFactory;
  provider: OpenAIResponsesProvider;
  providerRuntime: ProviderRuntimeContext;
}

interface Fixture extends RuntimeFixture {
  root: string;
  receipt: string;
  history: ObservedDiskHistory;
  processor: StreamProcessor;
  observation: Observation;
  dispose(): Promise<void>;
}

function hookCommand(receipt: string): string {
  const output = JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'BeforeModel',
      llm_request: { model: 'o3-mini' },
    },
  });
  const quote = (value: string): string =>
    `'${value.replaceAll("'", "'\\''")}'`;
  return `/bin/cat > ${quote(receipt)}; printf '%s' ${quote(output)}`;
}

function setupRuntime(
  root: string,
  receipt: string,
  baseURL: string,
): RuntimeFixture {
  const settings = new SettingsService();
  settings.setProviderSetting('openai-responses', 'model', 'o3-mini');
  settings.setProviderSetting('openai-responses', 'base-url', baseURL);
  settings.setProviderSetting('openai-responses', 'auth-key', 'test-key');
  settings.set('prompt-caching', 'off');
  const config = new Config({
    cwd: root,
    targetDir: root,
    sessionId: randomUUID(),
    model: 'o3-mini',
    debugMode: false,
    settingsService: settings,
    enableHooks: true,
    trustedFolder: true,
    hooks: {
      [HookEventName.BeforeModel]: [
        {
          hooks: [
            {
              type: HookType.Command,
              command: hookCommand(receipt),
            },
          ],
        },
      ],
    },
  });
  const tokenizer = createRuntimeTokenizerFactory();
  config.setTokenizerFactory(tokenizer);
  const provider = new OpenAIResponsesProvider('test-key', baseURL);
  const providerRuntime = {
    config,
    settingsService: settings,
    runtimeId: root,
  };
  return { config, settings, tokenizer, provider, providerRuntime };
}

function buildProcessor(
  setup: RuntimeFixture,
  history: ObservedDiskHistory,
): StreamProcessor {
  const { config, provider, providerRuntime } = setup;
  const manager = new TestRuntimeProviderManager(providerRuntime);
  manager.registerProvider(provider);
  config.setProviderManager(manager);
  const view = createAgentRuntimeContext({
    state: createAgentRuntimeState({
      runtimeId: config.getSessionId(),
      sessionId: config.getSessionId(),
      provider: provider.name,
      model: 'o3-mini',
    }),
    history,
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 200000,
      preserveThreshold: 0.2,
      telemetry: { enabled: false, target: null },
    },
    provider: createProviderAdapterFromManager(manager),
    telemetry: createTelemetryAdapterFromConfig(config),
    tools: createToolRegistryViewFromRegistry(),
    providerRuntime,
  });
  const compression = new CompressionHandler(
    view,
    history,
    {},
    () => {
      throw new Error('Unexpected compression in small BODY fixture');
    },
    async () => {},
  );
  return new StreamProcessor(
    view,
    new ConversationManager(history, view),
    compression,
    () => provider,
    () => providerRuntime,
    history,
    { systemInstruction: instructions },
  );
}

async function captureProviderBody(
  init: RequestInit | undefined,
  history: ObservedDiskHistory,
  observation: Observation,
): Promise<Response> {
  observation.beforeBody = history.pulled;
  if (init?.body === undefined || init.body === null)
    throw new Error('Missing HTTP upload');
  const body = new Response(init.body).body;
  if (body === null) throw new Error('Missing HTTP BODY stream');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let next = await reader.read();
  observation.afterFirstPull = history.pulled;
  while (!next.done) {
    observation.wire += decoder.decode(next.value, { stream: true });
    next = await reader.read();
  }
  observation.wire += decoder.decode();
  reader.releaseLock();
  return new Response(
    'data: {"type":"response.output_text.delta","delta":"finished"}\n\ndata: {"type":"response.completed","response":{"id":"resp_agent","status":"completed","output":[]}}\n\ndata: [DONE]\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

async function createFixture(): Promise<Fixture> {
  const root = mkdtempSync(join(process.cwd(), 'tmp/issue854-agent-body-'));
  const receipt = join(root, 'hook-receipt.json');
  const recording = new SessionRecordingService({
    sessionId: randomUUID(),
    projectHash: 'issue854-agent-body',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'openai-responses',
    model: 'o3-mini',
  });
  const history = new ObservedDiskHistory({ recording });
  for (let index = 0; index < rowCount; index += 1)
    history.add(historyRow(index));
  await history.waitForCommit();
  const observation = { beforeBody: -1, afterFirstPull: -1, wire: '' };
  const setup = setupRuntime(root, receipt, 'https://body.invalid/v1');
  return {
    ...setup,
    root,
    receipt,
    history,
    observation,
    processor: buildProcessor(setup, history),
    async dispose(): Promise<void> {
      history.dispose();
      await recording.dispose();
      await setup.config.dispose();
    },
  };
}

function expectedBody(): string {
  return JSON.stringify({
    model: 'o3-mini',
    input: [
      ...Array.from({ length: rowCount }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: rowText(index),
      })),
      { role: 'user', content: 'pending' },
    ],
    stream: true,
    instructions,
  });
}

async function independentEstimate(fixture: Fixture): Promise<number> {
  const rows = Array.from({ length: rowCount }, (_, index) =>
    historyRow(index),
  );
  rows.push({ speaker: 'human', blocks: [{ type: 'text', text: 'pending' }] });
  const contents: AsyncIterable<IContent> = {
    async *[Symbol.asyncIterator](): AsyncGenerator<IContent> {
      yield* rows;
    },
  };
  const projection = await fixture.provider.projectPromptEnvelope({
    contents,
    config: fixture.config,
    runtime: fixture.providerRuntime,
    settings: fixture.settings,
    invocation: createRuntimeInvocationContext({
      runtime: fixture.providerRuntime,
      settings: fixture.settings,
      providerName: fixture.provider.name,
      ephemeralsSnapshot: { 'prompt-caching': 'off' },
    }),
    systemInstruction: instructions,
  });
  try {
    return (
      await estimatePromptEnvelope(
        fixture.provider.name,
        projection,
        fixture.tokenizer,
      )
    ).estimatedPromptTokens;
  } finally {
    await projection.releaseIfUnsent?.();
  }
}

async function runBodyFixture(fixture: Fixture): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    (
      _input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ): Promise<Response> =>
      captureProviderBody(init, fixture.history, fixture.observation),
    { preconnect: originalFetch.preconnect },
  );
  try {
    const stream = await fixture.processor.makeApiCallAndProcessStream(
      { message: [{ type: 'text', text: 'pending' }] },
      'agent-body-demand',
      { speaker: 'human', blocks: [{ type: 'text', text: 'pending' }] },
    );
    for await (const _chunk of stream) void _chunk;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function readHookReceipt(path: string): {
  rowCount: number;
  pendingText: string;
  model: string;
  version: number;
} {
  const input: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!validateBeforeModelInput(input))
    throw new Error('Invalid actual hook receipt');
  const request = input.llm_request;
  const pending = request.contents[request.contents.length - 1].blocks[0];
  if (pending.type !== 'text')
    throw new Error('Missing pending text in actual hook input');
  return {
    rowCount: request.contents.length,
    pendingText: pending.text,
    model: request.model,
    version: request.version,
  };
}

describe('issue854 real StreamProcessor Responses BODY demand', () => {
  it('preserves exact BODY and estimation without predraining disk history', async () => {
    const fixture = await createFixture();
    try {
      await runBodyFixture(fixture);
      const observation = fixture.observation;
      writeFileSync(
        join(fixture.root, 'body-demand.json'),
        JSON.stringify({
          beforeBody: observation.beforeBody,
          afterFirstPull: observation.afterFirstPull,
          activeReaders: fixture.history.activeReaders,
          closedReaders: fixture.history.closedReaders,
        }),
      );
      expect(observation.wire).toBe(expectedBody());
      expect(
        fixture.processor.getPromptEnvelopeEstimate()?.estimatedPromptTokens,
      ).toBe(await independentEstimate(fixture));
      expect(observation.beforeBody).toBeLessThan(rowCount);
      expect(observation.afterFirstPull).toBeLessThan(rowCount);
    } finally {
      await fixture.dispose();
    }
  });

  it('delivers the complete BeforeModel input to the configured external hook', async () => {
    const fixture = await createFixture();
    try {
      await runBodyFixture(fixture);
      expect(readHookReceipt(fixture.receipt)).toStrictEqual({
        rowCount: rowCount + 1,
        pendingText: 'pending',
        model: 'o3-mini',
        version: 2,
      });
    } finally {
      await fixture.dispose();
    }
  });

  it('closes the disk reader when an actual agent request aborts during curation', async () => {
    const fixture = await createFixture();
    const controller = new AbortController();
    fixture.history.abortDuringRead = controller;
    try {
      await expect(
        fixture.processor.makeApiCallAndProcessStream(
          {
            message: [{ type: 'text', text: 'pending' }],
            config: { abortSignal: controller.signal },
          },
          'agent-disk-abort',
          { speaker: 'human', blocks: [{ type: 'text', text: 'pending' }] },
        ),
      ).rejects.toThrow('Aborted');
      expect(controller.signal.aborted).toBe(true);
      expect(fixture.history.activeReaders).toBe(0);
      expect(fixture.history.closedReaders).toBeGreaterThan(0);
      expect(fixture.history.pulled).toBeLessThan(rowCount);
    } finally {
      await fixture.dispose();
    }
  });

  it('rejects an explicitly retained request owner after its disk reader closes', async () => {
    const fixture = await createFixture();
    try {
      await runBodyFixture(fixture);
      expect(fixture.history.activeReaders).toBe(0);
      expect(fixture.history.ownership.snapshot().liveRows).toBe(0);
    } finally {
      await fixture.dispose();
    }
  });
});
