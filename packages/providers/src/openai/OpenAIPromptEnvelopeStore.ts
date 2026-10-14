/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PreparedOpenAIChatProjection } from './OpenAIPromptProjectionPreparation.js';
import type { RequestContext } from './OpenAIRequestPreparation.js';
import type { ChatPromptEstimate } from './OpenAIChatEstimatorFiles.js';
import type { PreparedResponsesRequestContext } from '../openai-responses/openAIResponsesExecutor.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { ProviderToolset } from '../IProvider.js';
import { diskTextProjection } from '../openai-responses/responses-disk-text-projection.js';
import { finishMediaRequest } from '../utils/request-media-resolution.js';
import { projectOpenAIChatPromptEnvelopeFromSource } from '../runtime/promptEnvelopeProjections.js';

/**
 * Source route: a send normalized with its prompt inputs blanked gets these
 * back, because the prepared request already carries them but the response
 * path still reads the tool declarations and instruction.
 */
export interface OpenAISourceInputs {
  readonly systemInstruction: string | undefined;
  readonly tools: ProviderToolset | undefined;
}

export type PreparedOpenAIPromptEnvelope =
  | {
      readonly protocol: 'openai-chat';
      readonly requestContext: RequestContext;
      readonly mediaRequest: ResolvedMediaRequest;
      readonly sourceInputs?: OpenAISourceInputs;
    }
  | {
      readonly protocol: 'openai-responses';
      readonly requestContext: PreparedResponsesRequestContext;
      readonly sourceInputs?: OpenAISourceInputs;
    };

export class OpenAIPromptEnvelopeStore {
  private readonly prepared = new WeakMap<
    object,
    PreparedOpenAIPromptEnvelope
  >();

  get(token: object | undefined): PreparedOpenAIPromptEnvelope | undefined {
    return token === undefined ? undefined : this.prepared.get(token);
  }

  /**
   * The chat projection of the one prepared request: the estimator reads the
   * sealed prompt-key files written with the body. Unsupported media comes
   * from the ledger written as the rows passed.
   */
  async storeChatProjection(
    prepared: Extract<
      PreparedOpenAIPromptEnvelope,
      { readonly protocol: 'openai-chat' }
    >,
    estimate: ChatPromptEstimate,
  ): Promise<PromptEnvelopeProjection> {
    const transportToken = Object.freeze({});
    this.prepared.set(transportToken, prepared);
    const { mediaRequest, requestContext } = prepared;
    try {
      return projectOpenAIChatPromptEnvelopeFromSource(estimate.projection, {
        model: requestContext.model,
        unsupportedMedia: estimate.unsupportedMedia,
        transportToken,
        releaseIfUnsent: mediaRequest.release,
      });
    } catch (error) {
      this.prepared.delete(transportToken);
      return finishMediaRequest(mediaRequest, { status: 'failed', error });
    }
  }

  /**
   * Source route, Responses: the disk text projection of the one prepared
   * context. Unsupported media comes from the prompt's own ledger, so no row
   * array is read here.
   */
  async storeDiskTextProjection(
    prepared: Extract<
      PreparedOpenAIPromptEnvelope,
      { readonly protocol: 'openai-responses' }
    >,
  ): Promise<PromptEnvelopeProjection> {
    const transportToken = Object.freeze({});
    this.prepared.set(transportToken, prepared);
    const { mediaRequest } = prepared.requestContext;
    try {
      return diskTextProjection(
        prepared.requestContext,
        transportToken,
        mediaRequest.release,
      );
    } catch (error) {
      this.prepared.delete(transportToken);
      return finishMediaRequest(mediaRequest, { status: 'failed', error });
    }
  }
}

interface PrepareOpenAIProjectionInput {
  readonly useResponses: boolean;
  readonly store: OpenAIPromptEnvelopeStore;
  readonly prepareResponses: () => Promise<PreparedResponsesRequestContext>;
  readonly prepareChat: () => Promise<PreparedOpenAIChatProjection>;
  /** Present on the source route: inputs the blanked send must get back. */
  readonly sourceInputs?: OpenAISourceInputs;
}

export async function prepareOpenAIPromptProjection(
  input: PrepareOpenAIProjectionInput,
): Promise<PromptEnvelopeProjection> {
  if (input.useResponses) {
    const requestContext = await input.prepareResponses();
    return input.store.storeDiskTextProjection({
      protocol: 'openai-responses',
      requestContext,
      ...(input.sourceInputs === undefined
        ? {}
        : { sourceInputs: input.sourceInputs }),
    });
  }

  const prepared = await input.prepareChat();
  return input.store.storeChatProjection(
    {
      protocol: 'openai-chat',
      requestContext: prepared.requestContext,
      mediaRequest: prepared.mediaRequest,
      ...(input.sourceInputs === undefined
        ? {}
        : { sourceInputs: input.sourceInputs }),
    },
    prepared.estimate,
  );
}
