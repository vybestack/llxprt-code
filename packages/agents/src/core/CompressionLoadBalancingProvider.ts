/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  buildCompressionSystemInstruction,
  COMPRESSION_LOAD_BALANCER_WRAPPER,
  type CompressionInteractionMode,
} from '../compression/compressionSystemPrompt.js';

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

function requireCandidateModel(
  candidate: CompressionLoadBalancerCandidate,
): string {
  const model = candidate.resolved?.model;
  if (!model?.trim()) {
    throw new Error(
      `Compression subprofile '${candidate.profileName}' has no resolved model`,
    );
  }
  return model;
}

/**
 * IProvider adapter that fans out across multiple resolved compression
 * sub-profiles using either round-robin or failover strategy.
 */
export class CompressionLoadBalancingProvider implements IProvider {
  readonly name = 'load-balancer';
  readonly [COMPRESSION_LOAD_BALANCER_WRAPPER] = true;
  private readonly selectedRoundRobinCandidate?: CompressionLoadBalancerCandidate;

  /**
   * @param strategy - round-robin or failover fan-out strategy.
   * @param candidates - resolved compression sub-profile candidates.
   * @param initialIndex - starting round-robin index.
   * @param interactionMode - the compressed session's interaction mode
   *   (issue #3176, D8). Used to reassemble the system instruction per
   *   candidate so the load-balancer wrapper name (`'load-balancer'`) is
   *   never used as the executing provider template identity.
   */
  constructor(
    private readonly strategy: 'round-robin' | 'failover',
    private readonly candidates: readonly CompressionLoadBalancerCandidate[],
    initialIndex: number,
    private readonly interactionMode: CompressionInteractionMode,
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
    return requireCandidateModel(this.candidates[0]);
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
    // Reassemble the system instruction per candidate using the candidate's
    // CONCRETE provider name and resolved model — not the wrapper's
    // 'load-balancer' name (issue #3176, D5). This runs on every round-robin
    // selection and every failover attempt so each candidate gets its own
    // provider/model-specific template.
    const candidateModel = requireCandidateModel(candidate);
    const systemInstruction = await buildCompressionSystemInstruction(
      candidateModel,
      {
        provider: candidate.provider.name,
        interactionMode: this.interactionMode,
      },
    );

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
      systemInstruction,
      metadata: {
        ...options.metadata,
        ...(candidate.invocation.metadata as Record<string, unknown>),
        selectedCompressionProfile: candidate.profileName,
      },
    };
    yield* candidate.provider.generateChatCompletion(candidateOptions);
  }
}
