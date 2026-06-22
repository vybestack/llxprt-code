/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

/**
 * A single resolved candidate inside a load-balanced compression profile.
 */
export interface CompressionLoadBalancerCandidate {
  profileName: string;
  provider: IProvider;
  runtime: ProviderRuntimeContext;
  config: NonNullable<ProviderRuntimeContext['config']> | undefined;
  resolved: RuntimeGenerateChatOptions['resolved'];
  invocation: NonNullable<RuntimeGenerateChatOptions['invocation']>;
}

/**
 * IProvider adapter that fans out across multiple resolved compression
 * sub-profiles using either round-robin or failover strategy.
 */
export class CompressionLoadBalancingProvider implements IProvider {
  readonly name = 'load-balancer';
  private readonly selectedRoundRobinCandidate?: CompressionLoadBalancerCandidate;

  constructor(
    private readonly strategy: 'round-robin' | 'failover',
    private readonly candidates: readonly CompressionLoadBalancerCandidate[],
    initialIndex: number,
  ) {
    if (candidates.length === 0) {
      throw new Error('Load-balanced compression profile requires subprofiles');
    }
    if (strategy === 'round-robin') {
      this.selectedRoundRobinCandidate =
        this.candidates[initialIndex % this.candidates.length];
    }
  }

  async getModels() {
    return [];
  }

  getDefaultModel(): string {
    return this.candidates[0]?.resolved?.model ?? '';
  }

  getServerTools(): string[] {
    return [];
  }

  async invokeServerTool(toolName: string): Promise<unknown> {
    throw new Error(
      `Server tool '${toolName}' not supported by compression load-balancer provider`,
    );
  }

  generateChatCompletion(
    options: RuntimeGenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  generateChatCompletion(content: IContent[]): AsyncIterableIterator<IContent>;
  async *generateChatCompletion(
    optionsOrContent: RuntimeGenerateChatOptions | IContent[],
  ): AsyncIterableIterator<IContent> {
    const options = Array.isArray(optionsOrContent)
      ? { contents: optionsOrContent }
      : optionsOrContent;

    if (this.strategy === 'failover') {
      yield* this.generateWithFailover(options);
      return;
    }

    yield* this.generateWithCandidate(
      this.selectedRoundRobinCandidate ?? this.candidates[0],
      options,
    );
  }

  private async *generateWithFailover(
    options: RuntimeGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    let lastError: unknown;
    for (const candidate of this.candidates) {
      try {
        const bufferedChunks: IContent[] = [];
        for await (const chunk of this.generateWithCandidate(
          candidate,
          options,
        )) {
          bufferedChunks.push(chunk);
        }
        yield* bufferedChunks;
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async *generateWithCandidate(
    candidate: CompressionLoadBalancerCandidate,
    options: RuntimeGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const candidateOptions: RuntimeGenerateChatOptions = {
      ...options,
      runtime: candidate.runtime,
      settings: candidate.runtime
        .settingsService as RuntimeGenerateChatOptions['settings'],
      config: candidate.config,
      resolved: {
        ...options.resolved,
        ...candidate.resolved,
      },
      invocation: candidate.invocation,
      metadata: {
        ...options.metadata,
        ...(candidate.invocation.metadata as Record<string, unknown>),
        selectedCompressionProfile: candidate.profileName,
      },
    };
    yield* candidate.provider.generateChatCompletion(candidateOptions);
  }
}
