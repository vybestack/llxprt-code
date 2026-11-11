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
import { tmpdir } from 'node:os';
import { withGpt56DiskSources } from '@vybestack/llxprt-code-providers/tokenizers/gpt56-disk-tokenizer-factory.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';

import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RuntimeCompressionGuardInfo } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';

import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { AnthropicProvider } from '@vybestack/llxprt-code-providers';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import {
  collectRequestRows,
  retirementSource,
  enforceRetirementSource,
  type RetirementSourceInput,
} from './retirement-source-fixture.js';
import { DEFAULT_REQUEST_MEDIA_BUDGET_BYTES } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { createSourcePromptEnvelopePreparer } from '../../core/promptEnvelopeSendSeam.js';
export const MODEL = 'claude-sonnet-4-20250514';
export const BASE_URL = 'https://api.anthropic.com';
export const FIFTEEN_MIB = 15 * 1024 * 1024;

const requestFetch: NetworkFetch = (input, init) =>
  globalThis.fetch(input, init);

const baseTokenizerFactory: RuntimeTokenizerFactory = {
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

const tokenizerFactory = withGpt56DiskSources(baseTokenizerFactory, tmpdir());

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
    if (
      (value['type'] === 'text' || value['type'] === 'input_text') &&
      typeof value['text'] === 'string'
    ) {
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

/** How a test describes the request envelope to the production send seam. */
export interface DeclaredRequest {
  /** The pending region the envelope declares; undefined is unrecoverable. */
  readonly pending: IContent[] | undefined;
  /** The user's original turn, carried when the boundary is unrecoverable. */
  readonly protectedContents?: IContent[];
  /** The request as a BeforeModel hook left it; composed from history if absent. */
  readonly contents?: IContent[];
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
  /** Context window in tokens the enforcer holds requests to. */
  contextLimit = 1_000_000;
  private readonly unbound = new AnthropicProvider('test-key', BASE_URL);
  private readonly provider: AnthropicProvider;
  private readonly options: ReturnType<typeof createProviderCallOptions>;
  private readonly settings = new SettingsService();
  private readonly originalFetch = globalThis.fetch;
  private compression: (
    history: HistoryService,
  ) => Promise<void | PerformCompressionResult> = () =>
    Promise.reject(new Error('compression must not run'));
  estimateOverride: ((rows: IContent[]) => Promise<number>) | undefined;
  private compressionOutcome = PerformCompressionResult.COMPRESSED;
  private fallback: (
    history: HistoryService,
    applyResult: (newHistory: IContent[]) => Promise<void>,
  ) => Promise<boolean> = () => Promise.resolve(false);

  constructor(
    private readonly directory: string,
    requestMediaBudgetBytes: number | undefined,
    quotaBytes: number = 256 * 1024 * 1024,
    /** Budget the enforcer retires against; defaults to the provider's. */
    private readonly enforcerBudgetBytes:
      | number
      | undefined = requestMediaBudgetBytes,
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
    const transport: NetworkFetch = async (_input, init): Promise<Response> => {
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
    globalThis.fetch = Object.assign(transport, {
      preconnect: this.originalFetch.preconnect,
    });
  }

  async dispose(): Promise<void> {
    globalThis.fetch = this.originalFetch;
    await this.history.dispose();
    await this.store.close();
  }

  /** Runs a real compression callback; the default refuses to run. */
  useCompression(
    compress: (
      history: HistoryService,
    ) => Promise<void | PerformCompressionResult>,
  ): void {
    this.compression = compress;
  }

  /**
   * A truncation fallback: it receives the history and the commit callback the
   * enforcer supplies, and reports whether it succeeded. The default declines.
   */
  useFallback(
    fallback: (
      history: HistoryService,
      applyResult: (newHistory: IContent[]) => Promise<void>,
    ) => Promise<boolean>,
  ): void {
    this.fallback = fallback;
  }

  /**
   * The result the compression workflow reports without running (for example
   * a cooldown skip). Defaults to COMPRESSED after running the callback.
   */
  useCompressionOutcome(outcome: PerformCompressionResult): void {
    this.compressionOutcome = outcome;
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

  private sourceInput(
    pending: IContent[],
    declared: DeclaredRequest,
  ): RetirementSourceInput {
    return {
      history: this.history,
      directory: this.directory,
      pending,
      protectedContents: declared.protectedContents ?? declared.pending ?? [],
      contents: declared.contents,
      recoverable: declared.pending !== undefined,
      budget: this.enforcerBudgetBytes ?? DEFAULT_REQUEST_MEDIA_BUDGET_BYTES,
      contextLimit: this.contextLimit,
      model: MODEL,
      compress: async () => {
        this.compressionRuns++;
        if (this.compressionOutcome !== PerformCompressionResult.COMPRESSED)
          return this.compressionOutcome;
        const outcome = await this.compression(this.history);
        return typeof outcome === 'string'
          ? outcome
          : PerformCompressionResult.COMPRESSED;
      },
      fallback: (apply) => this.fallback(this.history, apply),
    };
  }

  private sourceOptions(source: Parameters<typeof enforceRetirementSource>[1]) {
    return {
      ...this.options,
      requestRows: source,
      contentCount: source.count,
      contents: { [Symbol.asyncIterator]: () => source.openReader() },
    };
  }

  async send(
    pending: IContent[],
    drain = true,
    declared: DeclaredRequest = { pending },
  ): Promise<{ contents: IContent[] }> {
    const input = this.sourceInput(pending, declared);
    const source = await retirementSource(input);
    const preparer = createSourcePromptEnvelopePreparer(
      this.provider,
      (rows) => this.sourceOptions(rows),
      undefined,
      undefined,
      tokenizerFactory,
    );
    preparer.own(source);
    try {
      const override = this.estimateOverride;
      const selected = await enforceRetirementSource(
        input,
        source,
        override === undefined
          ? async (rows) => (await preparer.prepare(rows)).estimatedPromptTokens
          : async (rows) => override(await collectRequestRows(rows)),
        (owned) => preparer.own(owned),
      );
      const prepared = await preparer.prepare(selected);
      const contents = await collectRequestRows(prepared.source);
      if (drain)
        for await (const _row of this.provider.generateChatCompletion(
          prepared.options,
        )) {
          void _row;
        }
      return { contents };
    } finally {
      await preparer.releaseUnused();
    }
  }

  async recomposeViaCallback(
    pending: IContent[],
    guard?: RuntimeCompressionGuardInfo,
    original?: IContent[],
    estimate?: (contents: IContent[]) => Promise<number>,
  ): Promise<IContent[]> {
    const input = this.sourceInput(pending, { pending, contents: original });
    const source = await retirementSource(input);
    const preparer = createSourcePromptEnvelopePreparer(
      this.provider,
      (rows) => this.sourceOptions(rows),
      undefined,
      undefined,
      tokenizerFactory,
    );
    preparer.own(source);
    try {
      const rows = await enforceRetirementSource(
        input,
        source,
        async (candidate) =>
          estimate === undefined
            ? (await preparer.prepare(candidate)).estimatedPromptTokens
            : estimate(await collectRequestRows(candidate)),
        (owned) => preparer.own(owned),
        guard,
      );
      await preparer.prepare(rows);
      return await collectRequestRows(rows);
    } finally {
      await preparer.releaseUnused();
    }
  }

  async compose(pending: IContent[]): Promise<IContent[]> {
    const source =
      await this.history.prepareCuratedForProviderSnapshot(pending);
    try {
      return await collectRequestRows(source);
    } finally {
      await source.close();
    }
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
