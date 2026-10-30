/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3984: shared real-collaborator harness for historical-image
 * retirement tests. A real LocalMediaStore, RequestMediaResolver,
 * HistoryService, AnthropicProvider projection and ProviderContentEnforcer are
 * composed behind the production send seam; only the HTTP boundary is a stub.
 */

import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { buildProviderContent } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { AnthropicProvider } from '@vybestack/llxprt-code-providers';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { createHistoryRuntimeFixture } from '../../core/__tests__/history-runtime-fixture.js';
import { preparePromptEnvelopeAfterEnforcement } from '../../core/promptEnvelopeSendSeam.js';
import { ProviderContentEnforcer } from '../providerContentEnforcement.js';

export const MODEL = 'claude-sonnet-4-20250514';
export const BASE_URL = 'https://api.anthropic.com';
export const FIFTEEN_MIB = 15 * 1024 * 1024;

const requestFetch: NetworkFetch = (input, init) =>
  globalThis.fetch(input, init);

const tokenizerFactory: RuntimeTokenizerFactory = {
  getTokenizer: () => undefined,
  estimatePrompt: (request) =>
    request.legacyEstimate().then((count) => ({
      count,
      method: 'exact',
      family: 'legacy-unregistered',
      estimatorVersion: 'test-estimate-v1',
      assetRevision: 'none',
      projectionRevision: request.projectionRevision,
    })),
};

export interface AdmittedImage {
  readonly reference: MediaReferenceBlock;
  readonly base64: string;
  readonly bytes: Uint8Array;
}

export function successfulResponse(): Response {
  return Response.json({
    id: 'msg_retirement',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Image payloads in wire order, wherever they sit in the request body. */
export function collectImageData(value: unknown, found: string[]): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectImageData(item, found);
  } else if (isRecord(value)) {
    const source = value['source'];
    if (
      value['type'] === 'image' &&
      isRecord(source) &&
      typeof source['data'] === 'string'
    ) {
      found.push(source['data']);
    } else {
      for (const nested of Object.values(value)) {
        collectImageData(nested, found);
      }
    }
  }
  return found;
}

/** Text in wire order: text blocks and plain string message content. */
export function collectText(value: unknown, found: string[]): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, found);
  } else if (isRecord(value)) {
    if (value['type'] === 'text' && typeof value['text'] === 'string') {
      found.push(value['text']);
    } else if (typeof value['content'] === 'string') {
      found.push(value['content']);
    } else {
      for (const nested of Object.values(value)) collectText(nested, found);
    }
  }
  return found;
}

/** Number of retirement notes the model would read in this request body. */
export function countRetirementNotes(body: unknown): number {
  return (
    collectText(body, []).join('\n').split('was omitted from this request')
      .length - 1
  );
}

export function imageTurn(
  reference: MediaReferenceBlock,
  label: string,
): IContent {
  return {
    speaker: 'human',
    metadata: { turnId: `turn-${label}` },
    blocks: [{ type: 'text', text: `image ${label}` }, reference],
  };
}

export function aiTurn(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

export async function rejection(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to reject');
}

export interface SentRequest {
  readonly body: string;
  readonly contentLength: string | null;
}

/**
 * One real conversation: media store, resolver, history, provider and a
 * production-seam `send` that runs enforcement, projection and transport.
 */
export class RetirementSession {
  readonly store: LocalMediaStore;
  readonly resolver: RequestMediaResolver;
  readonly history = new HistoryService();
  readonly sent: SentRequest[] = [];
  compressionRuns = 0;
  /** When set, the HTTP boundary fails every request with this error. */
  transportFailure: Error | undefined;
  private readonly unbound = new AnthropicProvider('test-key', BASE_URL);
  private readonly provider: AnthropicProvider;
  private readonly options: ReturnType<typeof createProviderCallOptions>;
  private readonly settings = new SettingsService();
  private readonly originalFetch = globalThis.fetch;
  private compression: (history: HistoryService) => Promise<void> = () =>
    Promise.reject(new Error('compression must not run'));

  constructor(
    private readonly directory: string,
    private readonly requestMediaBudgetBytes: number | undefined,
    quotaBytes: number = 256 * 1024 * 1024,
  ) {
    this.store = new LocalMediaStore({
      rootDirectory: join(this.directory, 'media'),
      quotaBytes,
    });
    this.resolver = new RequestMediaResolver(this.store);
    this.settings.setProviderSetting(this.unbound.name, 'model', MODEL);
    this.settings.setProviderSetting(
      this.unbound.name,
      'streaming',
      'disabled',
    );
    this.settings.setProviderSetting(
      this.unbound.name,
      'prompt-caching',
      'off',
    );
    const runtime = createProviderRuntimeContext({
      runtimeId: 'issue3984-retirement-runtime',
    });
    const invocation = createRuntimeInvocationContext({
      fetch: requestFetch,
      runtimeId: runtime.runtimeId,
      runtimeMetadata: runtime.metadata,
      providerName: this.unbound.name,
      ephemeralsSnapshot: {
        streaming: 'disabled',
        'prompt-caching': 'off',
        retries: 1,
        retrywait: 1,
      },
    });
    this.provider = bindProviderMedia(
      this.unbound,
      this.resolver,
      requestMediaBudgetBytes,
    );
    this.options = createProviderCallOptions({
      providerName: this.unbound.name,
      contents: [],
      settings: this.settings,
      config: createRuntimeConfigStub(this.settings),
      runtime,
      invocation,
      resolved: { model: MODEL, baseURL: BASE_URL, authToken: 'test-key' },
    });
    globalThis.fetch = async (_input, init): Promise<Response> => {
      if (this.transportFailure !== undefined) throw this.transportFailure;
      const body =
        init?.body === null || init?.body === undefined
          ? ''
          : await new Response(init.body).text();
      this.sent.push({
        body,
        contentLength: new Headers(init?.headers).get('content-length'),
      });
      return successfulResponse();
    };
  }

  dispose(): void {
    globalThis.fetch = this.originalFetch;
  }

  /** Runs a real compression callback; the default refuses to run. */
  useCompression(compress: (history: HistoryService) => Promise<void>): void {
    this.compression = compress;
  }

  /**
   * An image whose stored bytes are not in this session's media store, as
   * after store loss: the reference is valid metadata but cannot be read.
   */
  async admitMissing(length: number, fill: number): Promise<AdmittedImage> {
    const elsewhere = new LocalMediaStore({
      rootDirectory: join(this.directory, 'elsewhere'),
      quotaBytes: 64 * 1024 * 1024,
    });
    return this.admit(length, fill, elsewhere);
  }

  async admit(
    length: number,
    fill: number,
    store: LocalMediaStore = this.store,
  ): Promise<AdmittedImage> {
    const bytes = new Uint8Array(length).fill(fill);
    const reference = await store.admit({
      bytes,
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    return { reference, base64: Buffer.from(bytes).toString('base64'), bytes };
  }

  private enforcerFor(
    estimate: (contents: IContent[]) => Promise<number>,
  ): ProviderContentEnforcer {
    const runtimeContext = createHistoryRuntimeFixture({
      state: createAgentRuntimeState({
        runtimeId: 'issue3984-retirement',
        provider: 'anthropic',
        model: MODEL,
        sessionId: 'issue3984-retirement-session',
      }),
      history: this.history,
      policy: {
        compressionThreshold: 0.8,
        contextLimit: 1_000_000,
        preserveThreshold: 0.2,
        telemetry: { enabled: false, target: null },
        'reasoning.includeInContext': true,
      },
    });
    return new ProviderContentEnforcer({
      historyService: this.history,
      runtimeContext,
      generationConfig: { maxOutputTokens: 1000 },
      readCompletionBudgetSetting: () =>
        runtimeContext.readCompletionBudgetSetting(),
      logger: DebugLogger.getLogger('test:issue3984:retirement'),
      ensureDensityOptimized: () => Promise.resolve(),
      performCompression: async () => {
        this.compressionRuns += 1;
        await this.compression(this.history);
        return PerformCompressionResult.COMPRESSED;
      },
      performFallbackCompression: () => Promise.resolve(false),
      getPromptTokenBaseline: () => null,
      resetPromptTokenBaseline: () => undefined,
      restorePromptTokenBaseline: () => undefined,
      estimateFinalizedPromptTokens: estimate,
      requestMediaBudgetBytes: this.requestMediaBudgetBytes,
    });
  }

  /**
   * The production order: enforce history plus pending, project through the
   * real provider, then transmit the exact prepared projection.
   */
  async send(
    pending: IContent[],
    drain: boolean = true,
  ): Promise<{ contents: IContent[] }> {
    const composed = buildProviderContent(
      this.history.getCurated(),
      pending,
      DebugLogger.getLogger('test:issue3984:compose'),
    );
    const { contents, prepared, preparer } =
      await preparePromptEnvelopeAfterEnforcement({
        provider: this.provider,
        contents: composed,
        tokenizerFactory,
        buildOptions: (candidate) => ({ ...this.options, contents: candidate }),
        enforce: (candidate, estimate) =>
          this.enforcerFor(estimate).enforce(
            { contents: candidate, pendingContents: pending },
            'prompt-3984',
            this.provider,
          ),
        fallbackEstimate: () => Promise.resolve(1),
      });
    try {
      if (drain) {
        for await (const _content of this.provider.generateChatCompletion(
          prepared.options,
        )) {
          // Drain the real provider parser.
        }
      }
    } finally {
      await preparer.releaseUnused();
    }
    return { contents };
  }

  /** Commits a human turn and its answer to canonical history. */
  commit(pending: IContent[], answer: string): void {
    for (const content of pending) this.history.add(content);
    this.history.add(aiTurn(answer));
  }

  lastBody(): unknown {
    if (this.sent.length === 0) throw new Error('No request was sent');
    const last = this.sent[this.sent.length - 1];
    return JSON.parse(last.body);
  }
}
