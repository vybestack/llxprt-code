/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { prepareRequest } from './OpenAIRequestPreparation.js';
import type { buildResponsesRequestContextForProjection } from '../openai-responses/openAIResponsesExecutor.js';
import type {
  PromptEnvelopeProjection,
  UnsupportedMediaEntry,
} from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import {
  projectOpenAIChatPromptEnvelope,
  projectOpenAIResponsesPromptEnvelope,
} from '../runtime/promptEnvelopeProjections.js';

export type PreparedOpenAIPromptEnvelope =
  | {
      readonly protocol: 'openai-chat';
      readonly requestContext: Awaited<ReturnType<typeof prepareRequest>>;
    }
  | {
      readonly protocol: 'openai-responses';
      readonly requestContext: Awaited<
        ReturnType<typeof buildResponsesRequestContextForProjection>
      >;
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
    return prepared.protocol === 'openai-responses'
      ? projectOpenAIResponsesPromptEnvelope(prepared.requestContext.request, {
          unsupportedMedia,
          transportToken,
        })
      : projectOpenAIChatPromptEnvelope(prepared.requestContext.requestBody, {
          unsupportedMedia,
          transportToken,
        });
  }
}

interface PrepareOpenAIProjectionInput {
  readonly normalized: NormalizedGenerateChatOptions;
  readonly useResponses: boolean;
  readonly store: OpenAIPromptEnvelopeStore;
  readonly prepareResponses: () => Promise<
    Awaited<ReturnType<typeof buildResponsesRequestContextForProjection>>
  >;
  readonly prepareChat: () => Promise<{
    options: NormalizedGenerateChatOptions;
    requestContext: Awaited<ReturnType<typeof prepareRequest>>;
  }>;
  readonly responsesPdfEnabled: boolean;
  readonly collectUnsupported: (
    options: NormalizedGenerateChatOptions,
    supports: (category: string) => boolean,
  ) => readonly UnsupportedMediaEntry[];
}

export async function prepareOpenAIPromptProjection(
  input: PrepareOpenAIProjectionInput,
): Promise<PromptEnvelopeProjection> {
  if (input.useResponses) {
    const requestContext = await input.prepareResponses();
    return input.store.storeProjection(
      { protocol: 'openai-responses', requestContext },
      input.collectUnsupported(
        input.normalized,
        (category) =>
          category === 'image' ||
          (category === 'pdf' && input.responsesPdfEnabled),
      ),
    );
  }

  const prepared = await input.prepareChat();
  return input.store.storeProjection(
    { protocol: 'openai-chat', requestContext: prepared.requestContext },
    input.collectUnsupported(
      prepared.options,
      (category) => category === 'image',
    ),
  );
}
