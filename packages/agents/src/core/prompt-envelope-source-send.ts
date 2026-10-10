/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  ProviderRequestRows,
  ProviderRequestSelection,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';
import { retryWithBackoff } from '@vybestack/llxprt-code-core/utils/retry.js';
import { raceWithAbort } from '@vybestack/llxprt-code-providers/utils/abortSignal.js';
import {
  extractSystemInstructionText,
  resolveUserMemory,
} from './streamRequestHelpers.js';
import {
  prepareAtSendSeam,
  type PromptEnvelopeEstimate,
} from './promptEnvelopeSendSeam.js';

/** An immutable disk selection whose enclosing owner transfers to this seam. */
export type PromptEnvelopeSource = ProviderRequestSelection;

export interface SourceProviderChatOptions extends RuntimeGenerateChatOptions {
  readonly requestRows: ProviderRequestSelection;
  readonly contentCount: number;
}

export interface PreparedSourcePromptEnvelopeSend {
  readonly source: PromptEnvelopeSource;
  /** Null when the provider has no projection; the fallback count is used. */
  readonly estimate: PromptEnvelopeEstimate | null;
  readonly estimatedPromptTokens: number;
  readonly options: SourceProviderChatOptions;
  releaseIfUnsent(): Promise<void>;
}

type SourceOptionsBuilder = (
  source: PromptEnvelopeSource,
) => SourceProviderChatOptions;

/** Contents-only estimate for providers that cannot project an envelope. */
type SourceFallbackEstimate = (
  source: PromptEnvelopeSource,
  signal?: AbortSignal,
) => Promise<number>;

function sourceContents(
  rows: ProviderRequestRows,
  signal?: AbortSignal,
): AsyncIterable<IContent> {
  return { [Symbol.asyncIterator]: () => rows.openReader(signal) };
}

export function buildSourceProviderChatOptions(
  source: PromptEnvelopeSource,
  tools: ToolDeclaration[] | undefined,
  runtimeContext: ProviderRuntimeContext & {
    settingsService: NonNullable<RuntimeGenerateChatOptions['settings']>;
  },
  invocation: RuntimeGenerateChatOptions['invocation'],
  requestContext: Record<string, unknown> | undefined,
  systemInstruction: unknown,
  systemPromptAssembler?: RuntimeGenerateChatOptions['systemPromptAssembler'],
): SourceProviderChatOptions {
  return {
    contents: sourceContents(source, invocation?.signal),
    requestRows: source,
    contentCount: source.count,
    tools,
    config: runtimeContext.config,
    runtime: runtimeContext,
    invocation,
    settings: runtimeContext.settingsService,
    metadata: {
      ...runtimeContext.metadata,
      _retryRequestContext: requestContext,
    },
    userMemory: resolveUserMemory(runtimeContext.config),
    systemInstruction: extractSystemInstructionText(systemInstruction),
    ...(systemPromptAssembler === undefined ? {} : { systemPromptAssembler }),
  };
}

async function discharge(
  actions: Array<() => void | Promise<void>>,
): Promise<void> {
  const failures: unknown[] = [];
  for (const action of actions) {
    try {
      await action();
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Source prompt cleanup failed');
}

export class SourcePromptEnvelopePreparer {
  private readonly sources = new Set<PromptEnvelopeSource>();
  private current: PreparedSourcePromptEnvelopeSend | undefined;

  constructor(
    private readonly provider: RuntimeProvider,
    private readonly buildOptions: SourceOptionsBuilder,
    private readonly signal?: AbortSignal,
    private readonly fallbackEstimate?: SourceFallbackEstimate,
  ) {}

  own(source: PromptEnvelopeSource): void {
    this.sources.add(source);
  }

  async discardProjection(): Promise<void> {
    const prepared = this.current;
    this.current = undefined;
    await prepared?.releaseIfUnsent();
  }

  async prepare(
    source: PromptEnvelopeSource,
  ): Promise<PreparedSourcePromptEnvelopeSend> {
    this.own(source);
    if (this.current?.source === source) return this.current;
    await this.discardProjection();
    const options = this.buildOptions(source);
    if (options.requestRows !== source || options.contentCount !== source.count)
      throw new Error(
        'Source provider options must preserve the disk candidate identity and count',
      );
    const prepared = await prepareAtSendSeam(
      this.provider,
      this.signal === undefined
        ? options
        : bindSourceOptions(options, source, this.signal),
    );
    let estimatedPromptTokens: number;
    if (prepared.estimate !== null) {
      estimatedPromptTokens = prepared.estimate.estimatedPromptTokens;
    } else if (this.fallbackEstimate !== undefined) {
      estimatedPromptTokens = await this.fallbackEstimate(source, this.signal);
    } else {
      await prepared.releaseIfUnsent?.();
      throw new Error(
        'Source-backed prompt preparation requires provider projection',
      );
    }
    let release: Promise<void> | undefined;
    this.current = {
      source,
      estimate: prepared.estimate,
      estimatedPromptTokens,
      options: {
        ...prepared.options,
        requestRows: source,
        contentCount: source.count,
      },
      releaseIfUnsent: () => {
        release ??= Promise.resolve().then(() => prepared.releaseIfUnsent?.());
        return release;
      },
    };
    return this.current;
  }

  async releaseUnused(kept?: PreparedSourcePromptEnvelopeSend): Promise<void> {
    const actions: Array<() => void | Promise<void>> = [];
    if (this.current !== undefined && this.current !== kept) {
      const prepared = this.current;
      this.current = undefined;
      actions.push(() => prepared.releaseIfUnsent());
    }
    for (const source of this.sources) {
      if (source === kept?.source) continue;
      this.sources.delete(source);
      actions.push(() => source.close());
    }
    await discharge(actions);
  }
}

export function createSourcePromptEnvelopePreparer(
  provider: RuntimeProvider,
  buildOptions: SourceOptionsBuilder,
  signal?: AbortSignal,
  fallbackEstimate?: SourceFallbackEstimate,
): SourcePromptEnvelopePreparer {
  return new SourcePromptEnvelopePreparer(
    provider,
    buildOptions,
    signal,
    fallbackEstimate,
  );
}

interface SourceEnforcementInput {
  readonly provider: RuntimeProvider;
  readonly source: PromptEnvelopeSource;
  readonly buildOptions: SourceOptionsBuilder;
  readonly enforce: (
    source: PromptEnvelopeSource,
    estimate: (candidate: PromptEnvelopeSource) => Promise<number>,
  ) => Promise<PromptEnvelopeSource>;
  readonly signal?: AbortSignal;
  readonly fallbackEstimate?: SourceFallbackEstimate;
}

export async function prepareSourcePromptEnvelopeAfterEnforcement(
  input: SourceEnforcementInput,
): Promise<{
  source: PromptEnvelopeSource;
  prepared: PreparedSourcePromptEnvelopeSend;
  preparer: SourcePromptEnvelopePreparer;
}> {
  const preparer = createSourcePromptEnvelopePreparer(
    input.provider,
    input.buildOptions,
    input.signal,
    input.fallbackEstimate,
  );
  preparer.own(input.source);
  try {
    input.signal?.throwIfAborted();
    const source = await input.enforce(input.source, async (candidate) => {
      // A replacement is owned before cancellation can reject its estimate.
      preparer.own(candidate);
      input.signal?.throwIfAborted();
      const prepared = await preparer.prepare(candidate);
      input.signal?.throwIfAborted();
      return prepared.estimatedPromptTokens;
    });
    // Register an unestimated replacement before cancellation can reject it.
    preparer.own(source);
    input.signal?.throwIfAborted();
    const prepared = await preparer.prepare(source);
    input.signal?.throwIfAborted();
    await preparer.releaseUnused(prepared);
    return { source, prepared, preparer };
  } catch (error: unknown) {
    try {
      await preparer.releaseUnused();
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [error, cleanupError],
        'Source prompt preparation and cleanup failed',
      );
    }
    throw error;
  }
}

interface SourceStreamInput extends SourceEnforcementInput {
  readonly onPrepared?: (
    prepared: PreparedSourcePromptEnvelopeSend,
    attemptIndex: number,
  ) => void | Promise<void>;
  readonly send?: (
    prepared: PreparedSourcePromptEnvelopeSend,
    attemptIndex: number,
  ) => AsyncIterableIterator<IContent>;
  readonly shouldRetryOnError: (error: unknown) => boolean;
  /** Runs once after the send has released its source, so callers can drop their own pins. */
  readonly onReleased?: () => void;
}

function bindSourceOptions(
  options: SourceProviderChatOptions,
  source: ProviderRequestRows,
  signal: AbortSignal,
): SourceProviderChatOptions {
  return {
    ...options,
    contents: sourceContents(source, signal),
    ...(options.invocation === undefined
      ? {}
      : { invocation: { ...options.invocation, signal } }),
    metadata: { ...options.metadata, abortSignal: signal },
  };
}

export function bindSourceSignal(
  prepared: PreparedSourcePromptEnvelopeSend,
  signal: AbortSignal,
): PreparedSourcePromptEnvelopeSend {
  return {
    ...prepared,
    options: bindSourceOptions(prepared.options, prepared.source, signal),
  };
}

interface SourceResponseAttempt {
  readonly iterator: AsyncIterableIterator<IContent>;
  readonly first: IteratorResult<IContent>;
}

async function openSourceResponse(
  input: SourceStreamInput,
  preparer: SourcePromptEnvelopePreparer,
  source: PromptEnvelopeSource,
  signal: AbortSignal,
): Promise<SourceResponseAttempt> {
  let attemptIndex = 0;
  let transportStarted = false;
  return retryWithBackoff(
    async () => {
      transportStarted = false;
      signal.throwIfAborted();
      if (attemptIndex > 0) await preparer.discardProjection();
      const prepared = bindSourceSignal(await preparer.prepare(source), signal);
      const index = attemptIndex++;
      let iterator: AsyncIterableIterator<IContent> | undefined;
      try {
        if (input.onPrepared !== undefined) {
          await raceWithAbort(
            Promise.resolve(input.onPrepared(prepared, index)),
            signal,
          );
        }
        signal.throwIfAborted();
        transportStarted = true;
        iterator =
          input.send === undefined
            ? input.provider.generateChatCompletion(prepared.options)
            : input.send(prepared, index);
        const first = await raceWithAbort(iterator.next(), signal);
        return { iterator, first };
      } catch (error: unknown) {
        try {
          await discharge([
            () => prepared.releaseIfUnsent(),
            async () => {
              await iterator?.return?.();
            },
          ]);
        } catch (cleanupError: unknown) {
          throw new AggregateError(
            [error, cleanupError],
            'Source provider attempt and cleanup failed',
          );
        }
        throw error;
      }
    },
    {
      shouldRetryOnError: (error) =>
        transportStarted && input.shouldRetryOnError(error),
      signal,
    },
  );
}

async function* remainingSourceResponses(
  iterator: AsyncIterableIterator<IContent>,
  signal: AbortSignal,
): AsyncGenerator<IContent, void, unknown> {
  for (;;) {
    const next = await raceWithAbort(iterator.next(), signal);
    if (next.done === true) return;
    yield next.value;
  }
}

async function* sourceResponses(
  input: SourceStreamInput,
  preparer: SourcePromptEnvelopePreparer,
  source: PromptEnvelopeSource,
  signal: AbortSignal,
): AsyncGenerator<IContent, void, unknown> {
  let response: SourceResponseAttempt | undefined;
  let failed = false;
  let failure: unknown;
  try {
    response = await openSourceResponse(input, preparer, source, signal);
    if (response.first.done !== true) {
      yield response.first.value;
      yield* remainingSourceResponses(response.iterator, signal);
    }
  } catch (error: unknown) {
    failed = true;
    failure = error;
    throw error;
  } finally {
    await discharge([
      () => {
        if (failed) throw failure;
      },
      async () => {
        await response?.iterator.return?.();
      },
      () => preparer.releaseUnused(),
    ]);
  }
}

interface OwnedSend {
  readonly iterator: AsyncGenerator<IContent, void, unknown>;
  readonly preparer: SourcePromptEnvelopePreparer;
}

/**
 * A consumer may keep this shell after the response completes, so once cleanup
 * has run it drops the generator, preparer and selection it owned.
 */
class OwnedSourceResponse implements AsyncIterableIterator<IContent> {
  private readonly controller = new AbortController();
  private owned: OwnedSend | undefined;
  private cleanup: Promise<void> | undefined;
  private readonly onAbort = (): void => {
    this.controller.abort(this.parent?.reason);
    // Keep cleanup rejection observable by next/return without an unhandled event promise.
    void this.close().catch(() => undefined);
  };

  constructor(
    input: SourceStreamInput,
    preparer: SourcePromptEnvelopePreparer,
    source: PromptEnvelopeSource,
    private readonly parent?: AbortSignal,
    private readonly onReleased?: () => void,
  ) {
    this.owned = {
      iterator: sourceResponses(
        input,
        preparer,
        source,
        this.controller.signal,
      ),
      preparer,
    };
    parent?.addEventListener('abort', this.onAbort, { once: true });
    if (parent?.aborted === true) this.onAbort();
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<IContent> {
    return this;
  }

  private requireOwned(): OwnedSend {
    if (this.owned === undefined)
      throw new Error('Source response used after its send was released');
    return this.owned;
  }

  private close(): Promise<void> {
    if (this.cleanup === undefined) {
      const { iterator, preparer } = this.requireOwned();
      this.cleanup = discharge([
        () => preparer.releaseUnused(),
        async () => {
          await iterator.return();
        },
      ]).finally(() => {
        this.parent?.removeEventListener('abort', this.onAbort);
        this.owned = undefined;
        this.onReleased?.();
      });
    }
    return this.cleanup;
  }

  async next(): Promise<IteratorResult<IContent>> {
    if (this.parent?.aborted === true) {
      await this.close();
      this.parent.throwIfAborted();
    }
    if (this.cleanup !== undefined) {
      await this.cleanup;
      return { done: true, value: undefined };
    }
    try {
      const next = await this.requireOwned().iterator.next();
      if (this.parent?.aborted === true) {
        await this.close();
        this.parent.throwIfAborted();
      }
      if (next.done === true) await this.close();
      return next;
    } catch (error: unknown) {
      try {
        await this.close();
      } catch (cleanupError: unknown) {
        throw new AggregateError(
          [error, cleanupError],
          'Source response and cleanup failed',
        );
      }
      throw error;
    }
  }

  async return(): Promise<IteratorResult<IContent>> {
    this.controller.abort(new Error('Source response consumer returned'));
    await this.close();
    return { done: true, value: undefined };
  }

  async throw(error?: unknown): Promise<IteratorResult<IContent>> {
    this.controller.abort(error);
    await this.close();
    throw error;
  }
}

export async function enforceAndStreamSourcePromptEnvelopeRetries(
  input: SourceStreamInput,
): Promise<AsyncIterableIterator<IContent>> {
  const { source, preparer } =
    await prepareSourcePromptEnvelopeAfterEnforcement(input);
  return new OwnedSourceResponse(
    input,
    preparer,
    source,
    input.signal,
    input.onReleased,
  );
}
