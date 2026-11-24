/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  OpenAIProvider,
  type NormalizedGenerateChatOptions,
} from '@vybestack/llxprt-code-providers';
import { bindProviderAliasIdentity } from '@vybestack/llxprt-code-providers/composition/aliasProviderFactory.js';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';

/** The parts of a provider request the scripted attempts record. */
export interface ScriptedRequest {
  readonly contents: readonly IContent[];
  readonly tools?: unknown;
  readonly systemInstruction?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly invocation?: {
    readonly signal?: AbortSignal;
    readonly ephemerals?: unknown;
    readonly modelBehavior?: unknown;
    readonly modelParams?: unknown;
    readonly customHeaders?: unknown;
    readonly providerDefaults?: unknown;
  };
  readonly promptEnvelopeTransportToken?: unknown;
  readonly resolved?: {
    readonly model?: string;
    readonly temperature?: number;
    readonly maxTokens?: number;
    readonly streaming?: boolean;
  };
}

/**
 * One request the contributed provider received. The provider's stream is a
 * plain async generator that never looks at an AbortSignal, so it behaves like
 * a transport that ignores cancellation: it advances only when the test calls
 * `emit` or `finish`.
 */
export interface StallingAttempt {
  readonly index: number;
  /** The request exactly as the provider received it. */
  readonly request: ScriptedRequest;
  /** Request data fixed when the request arrived, without functions or signals. */
  readonly data: unknown;
  /** The cancellation signals this attempt was handed. */
  readonly signals: readonly AbortSignal[];
  /** Whether each of those signals was already aborted when the request arrived. */
  readonly abortedOnArrival: readonly boolean[];
  /** Streams a text chunk. */
  emit(text: string): void;
  /** Streams a chunk the way a provider sends it, metadata included. */
  emitContent(content: IContent): void;
  /** Ends the stream, as a late EOF when the agent has already moved on. */
  finish(): void;
  /** Settles when the provider has delivered EOF to its consumer. */
  readonly ended: Promise<void>;
}

export interface StallingProvider {
  readonly alias: string;
  readonly contributions: ProviderContributionRegistry;
  readonly attempts: readonly StallingAttempt[];
  /** Runs synchronously when a request arrives; a scenario scripts the attempt here. */
  onAttempt: ((attempt: StallingAttempt) => void) | undefined;
  /** Resolves with request `index` as soon as it reaches the provider. */
  attemptAt(index: number): Promise<StallingAttempt>;
  /** Ends every attempt still open so no generator outlives the scenario. */
  releaseAll(): void;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * The request data a resend must repeat exactly, as JSON fixed when the
 * request arrived. Per-attempt plumbing (signals, observers, timestamps,
 * lifecycle recorders, the one-shot transport token) is deliberately not part
 * of it.
 */
function requestData(request: ScriptedRequest): unknown {
  const metadata = request.metadata ?? {};
  const invocation = request.invocation;
  return JSON.parse(
    JSON.stringify({
      contents: request.contents,
      tools: request.tools,
      systemInstruction: request.systemInstruction,
      resolved: {
        model: request.resolved?.model,
        temperature: request.resolved?.temperature,
        maxTokens: request.resolved?.maxTokens,
        streaming: request.resolved?.streaming,
      },
      metadata: {
        logicalRequestId: metadata['__logicalRequestId'],
        conversationLogEmptyTools: metadata['conversationLogEmptyTools'],
        historyLength: metadata['historyLength'],
        provider: metadata['_provider'],
        runtimeId: metadata['_runtimeId'],
      },
      invocation: {
        ephemerals: invocation?.ephemerals,
        modelBehavior: invocation?.modelBehavior,
        modelParams: invocation?.modelParams,
        customHeaders: invocation?.customHeaders,
        providerDefaults: invocation?.providerDefaults,
      },
    }),
  );
}

function requestSignals(request: ScriptedRequest): AbortSignal[] {
  const signals: AbortSignal[] = [];
  const transport: unknown = request.metadata?.['abortSignal'];
  if (transport instanceof AbortSignal) signals.push(transport);
  if (request.invocation?.signal instanceof AbortSignal)
    signals.push(request.invocation.signal);
  return signals;
}

export class AttemptScript implements StallingAttempt {
  readonly data: unknown;
  readonly signals: readonly AbortSignal[];
  readonly abortedOnArrival: readonly boolean[];
  readonly ended: Promise<void>;
  private readonly queued: IContent[] = [];
  private finished = false;
  private wake: (() => void) | undefined;
  private readonly endedGate = deferred<void>();

  constructor(
    readonly index: number,
    readonly request: ScriptedRequest,
  ) {
    this.data = requestData(request);
    this.signals = requestSignals(request);
    this.abortedOnArrival = this.signals.map((signal) => signal.aborted);
    this.ended = this.endedGate.promise;
  }

  emit(text: string): void {
    this.emitContent({ speaker: 'ai', blocks: [{ type: 'text', text }] });
  }

  emitContent(content: IContent): void {
    this.queued.push(content);
    this.wake?.();
  }

  finish(): void {
    this.finished = true;
    this.wake?.();
  }

  async *stream(): AsyncIterableIterator<IContent> {
    for (;;) {
      const next = this.queued.shift();
      if (next !== undefined) {
        yield next;
      } else if (this.finished) {
        break;
      } else {
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        this.wake = undefined;
      }
    }
    this.endedGate.resolve();
  }
}

class StallingOpenAIProvider extends OpenAIProvider {
  constructor(private readonly script: ProviderState) {
    super('test-key', 'http://stalling-provider.invalid/v1');
  }

  protected override generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    return this.script.begin(options).stream();
  }
}

export class ProviderState {
  readonly attempts: AttemptScript[] = [];
  onAttempt: ((attempt: StallingAttempt) => void) | undefined;
  private readonly arrivals = new Map<number, Deferred<StallingAttempt>>();

  begin(options: ScriptedRequest): AttemptScript {
    const attempt = new AttemptScript(this.attempts.length, options);
    this.attempts.push(attempt);
    this.arrival(attempt.index).resolve(attempt);
    this.onAttempt?.(attempt);
    return attempt;
  }

  /** Ends every attempt still open so no generator outlives the scenario. */
  releaseAll(): void {
    for (const attempt of this.attempts) attempt.finish();
  }

  /** Resolves with request `index` as soon as it reaches the provider. */
  attemptAt(index: number): Promise<StallingAttempt> {
    return this.arrival(index).promise;
  }

  arrival(index: number): Deferred<StallingAttempt> {
    let gate = this.arrivals.get(index);
    if (gate === undefined) {
      gate = deferred<StallingAttempt>();
      this.arrivals.set(index, gate);
    }
    return gate;
  }
}

export function createStallingProvider(alias: string): StallingProvider {
  const providerId = `${alias}-provider`;
  const state = new ProviderState();
  const contributions = buildProviderContributionRegistry([
    {
      specifier: `memory:${providerId}`,
      manifest: {
        apiVersion: 1,
        id: providerId,
        providers: [
          {
            providerId,
            createProvider: (entry) => {
              const provider = new StallingOpenAIProvider(state);
              bindProviderAliasIdentity(provider, entry.alias);
              return provider;
            },
            builtinAliases: [
              {
                alias,
                config: {
                  baseProvider: providerId,
                  'base-url': 'http://stalling-provider.invalid/v1',
                  'requires-auth': false,
                  defaultModel: 'primary-model',
                  staticModels: [{ id: 'primary-model', name: 'Primary' }],
                },
              },
            ],
          },
        ],
      },
    },
  ]);
  return {
    alias,
    contributions,
    attempts: state.attempts,
    get onAttempt() {
      return state.onAttempt;
    },
    set onAttempt(script) {
      state.onAttempt = script;
    },
    attemptAt: (index) => state.attemptAt(index),
    releaseAll: () => state.releaseAll(),
  };
}
