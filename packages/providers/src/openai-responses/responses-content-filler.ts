/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  ResponsesExecutorDeps,
  RequestContext,
} from './openAIResponsesExecutor.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SyntheticToolResponseHandler } from '../openai/syntheticToolResponses.js';
import { resolveResponsesRequestShape } from './openAIResponsesRequestState.js';
import { resolveRequestMedia } from '../utils/request-media-resolution.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { buildInput } from './responses-request-fields.js';
import { applyStatefulConversation } from './openAIResponsesStateful.js';

/**
 * Resolves the history array a request build consumes. Lazily-wired requests
 * (issue #854 P05b4) drain the memoized request-scoped source — the first
 * caller materializes it and every later consumer (projection, recovery
 * rebuilds, stateless fallbacks) resolves the SAME array, so a one-shot
 * source is never drained twice.
 */
export async function resolveRequestContents(
  options: NormalizedGenerateChatOptions,
): Promise<IContent[]> {
  const requestContents = options.requestContents;
  return requestContents === undefined
    ? options.contents
    : requestContents.materialize();
}

/**
 * Creates the deferred content stage for a lazily-wired transport (issue
 * #854 P05b4). The request context was built against an empty shell so the
 * history source stays unpulled while the transport call initiates; this
 * stage drains the memoized source and applies every content-derived piece
 * (input, stateful chaining) onto the SAME request object the lease owns.
 */
export function createRequestContentsFiller(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
  invocationEphemerals: Record<string, unknown>,
  context: RequestContext,
): () => Promise<void> {
  let fill: Promise<void> | undefined;
  return () => {
    fill ??= (async () => {
      const patchedContent = SyntheticToolResponseHandler.patchMessageHistory(
        await resolveRequestContents(options),
      );
      const shape = resolveResponsesRequestShape(
        options,
        patchedContent,
        invocationEphemerals,
        deps,
        false,
        false,
      );
      // The shell's media request was registered over an empty history, so
      // resolve media over the drained shape content — the exact semantics
      // buildRequestContext applies eagerly — and chain its release onto the
      // shell's so the request-scoped lease still drops when the transport
      // call settles.
      const mediaRequest = await resolveRequestMedia(
        options.runtime,
        shape.stateful.content,
        getRequestSignal(options),
      );
      context.mediaRequest.registerCleanup(() => mediaRequest.release());
      context.request.input = buildInput(
        options,
        mediaRequest.withContents((contents) => contents),
        invocationEphemerals,
        deps,
        shape.stateful.parentId !== undefined,
      );
      applyStatefulConversation(
        context.request,
        shape.stateful,
        shape.explicitUserStore,
        shape.isCodex,
        deps.logger,
      );
    })();
    return fill;
  };
}
