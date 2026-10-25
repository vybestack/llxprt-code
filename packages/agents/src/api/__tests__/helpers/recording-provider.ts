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

export interface RecordingProviderOptions {
  /** Contributed alias hosts select as the provider name. Defaults to `recording-local`. */
  readonly alias?: string;
  /** Text every answered request streams back. Defaults to `recorded`. */
  readonly responseText?: string;
}

/** The request a model would have received: contents, tools and invocation. */
export type RecordedRequest = NormalizedGenerateChatOptions;

export interface RequestHold {
  /** Resolves with the first request that reaches the held provider. */
  readonly entered: Promise<RecordedRequest>;
  /** Lets every held request, and every later one, answer. */
  readonly release: () => void;
}

/**
 * A provider registered the way a host registers one: as a provider
 * contribution. Pass `contributions` to `AgentConfig.providerContributions`
 * (Route C) or to `prepareAgentPreflight` (Route B), and select `alias` as the
 * provider.
 */
export interface RecordingProvider {
  readonly alias: string;
  readonly contributions: ProviderContributionRegistry;
  /** Every request the provider received, in arrival order. */
  readonly requests: readonly RecordedRequest[];
  /**
   * Holds each request that arrives from now on until `release` is called or
   * the request's own abort signal fires.
   */
  readonly hold: () => RequestHold;
}

interface Gate {
  readonly open: Promise<void>;
  readonly onEntered: (request: RecordedRequest) => void;
}

class RecordingOpenAIProvider extends OpenAIProvider {
  constructor(
    private readonly record: (request: RecordedRequest) => Promise<void>,
    private readonly responseText: string,
  ) {
    super('test-key', 'http://recording-provider.invalid/v1');
  }

  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    await this.record(options);
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: this.responseText }],
    };
  }
}

function waitFor(open: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) return open;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    open.then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export function createRecordingProvider(
  options: RecordingProviderOptions = {},
): RecordingProvider {
  const alias = options.alias ?? 'recording-local';
  const providerId = `${alias}-provider`;
  const responseText = options.responseText ?? 'recorded';
  const requests: RecordedRequest[] = [];
  let gate: Gate | undefined;

  const record = async (request: RecordedRequest): Promise<void> => {
    requests.push(request);
    const current = gate;
    if (current === undefined) return;
    current.onEntered(request);
    await waitFor(current.open, request.invocation.signal);
  };

  const hold = (): RequestHold => {
    let release!: () => void;
    let enter!: (request: RecordedRequest) => void;
    const open = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<RecordedRequest>((resolve) => {
      enter = resolve;
    });
    gate = { open, onEntered: enter };
    return { entered, release };
  };

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
              const provider = new RecordingOpenAIProvider(
                record,
                responseText,
              );
              bindProviderAliasIdentity(provider, entry.alias);
              return provider;
            },
            builtinAliases: [
              {
                alias,
                config: {
                  baseProvider: providerId,
                  'base-url': 'http://recording-provider.invalid/v1',
                  'requires-auth': false,
                  defaultModel: 'recording-default',
                  staticModels: [
                    { id: 'recording-default', name: 'Recording default' },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
  ]);

  return { alias, contributions, requests, hold };
}
