/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type OpenAI from 'openai';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { PreparedOpenAIChatProjection } from './OpenAIPromptProjectionPreparation.js';
import type { prepareRequest } from './OpenAIRequestPreparation.js';
import type { buildResponsesRequestContextForProjection } from '../openai-responses/openAIResponsesExecutor.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type {
  PromptEnvelopeProjection,
  UnsupportedMediaEntry,
} from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { MediaBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderToolset } from '../IProvider.js';
import type { RequestScopedBody } from '../utils/requestScopedBody.js';
import {
  projectOpenAIChatPromptEnvelope,
  projectOpenAIChatPromptEnvelopeOnDemand,
  projectOpenAIResponsesPromptEnvelope,
} from '../runtime/promptEnvelopeProjections.js';

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
      readonly requestContext: Awaited<ReturnType<typeof prepareRequest>>;
      readonly mediaRequest: ResolvedMediaRequest;
      /** Source route: the lease of the one prepared chat body. */
      readonly bodyLease?: RequestScopedBody<OpenAI.Chat.ChatCompletionCreateParams>;
      readonly sourceInputs?: OpenAISourceInputs;
    }
  | {
      readonly protocol: 'openai-responses';
      readonly requestContext: Awaited<
        ReturnType<typeof buildResponsesRequestContextForProjection>
      >;
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

  storeProjection(
    prepared: PreparedOpenAIPromptEnvelope,
    unsupportedMedia: readonly UnsupportedMediaEntry[] = [],
  ): PromptEnvelopeProjection {
    const transportToken = Object.freeze({});
    this.prepared.set(transportToken, prepared);
    if (prepared.protocol === 'openai-responses') {
      return {
        ...projectOpenAIResponsesPromptEnvelope(
          prepared.requestContext.request,
          {
            unsupportedMedia,
            transportToken,
          },
          prepared.requestContext.projectionContext,
        ),
        releaseIfUnsent: prepared.requestContext.mediaRequest.release,
      };
    }
    const { bodyLease } = prepared;
    if (bodyLease !== undefined) {
      return projectOpenAIChatPromptEnvelopeOnDemand(() => bodyLease.value, {
        unsupportedMedia,
        transportToken,
        releaseIfUnsent: prepared.mediaRequest.release,
      });
    }
    return {
      ...projectOpenAIChatPromptEnvelope(prepared.requestContext.requestBody, {
        unsupportedMedia,
        transportToken,
      }),
      releaseIfUnsent: prepared.mediaRequest.release,
    };
  }
}

interface PrepareOpenAIProjectionInput {
  readonly normalized: NormalizedGenerateChatOptions;
  readonly useResponses: boolean;
  readonly store: OpenAIPromptEnvelopeStore;
  readonly prepareResponses: () => Promise<
    Awaited<ReturnType<typeof buildResponsesRequestContextForProjection>>
  >;
  readonly prepareChat: () => Promise<PreparedOpenAIChatProjection>;
  /** Present on the source route: inputs the blanked send must get back. */
  readonly sourceInputs?: OpenAISourceInputs;
  readonly responsesPdfEnabled: boolean;
  readonly collectUnsupported: (
    options: NormalizedGenerateChatOptions,
    supports: (block: MediaBlock, category: string) => boolean,
  ) => readonly UnsupportedMediaEntry[];
}

export async function prepareOpenAIPromptProjection(
  input: PrepareOpenAIProjectionInput,
): Promise<PromptEnvelopeProjection> {
  if (input.useResponses) {
    const requestContext = await input.prepareResponses();
    return input.store.storeProjection(
      {
        protocol: 'openai-responses',
        requestContext,
        ...(input.sourceInputs === undefined
          ? {}
          : { sourceInputs: input.sourceInputs }),
      },
      input.collectUnsupported(
        input.normalized,
        (_block, category) =>
          category === 'image' ||
          (category === 'pdf' && input.responsesPdfEnabled),
      ),
    );
  }

  const prepared = await input.prepareChat();
  const sourceRoute = input.sourceInputs !== undefined;
  return input.store.storeProjection(
    {
      protocol: 'openai-chat',
      requestContext: prepared.requestContext,
      mediaRequest: prepared.mediaRequest,
      ...(sourceRoute
        ? { bodyLease: prepared.bodyLease, sourceInputs: input.sourceInputs }
        : {}),
    },
    prepared.unsupportedMedia,
  );
}
