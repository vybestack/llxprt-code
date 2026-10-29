/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type {
  ResponsesApiError,
  ResponsesEvent,
} from './parseResponsesStreamTypes.js';
const logger = new DebugLogger('llxprt:providers:openai-responses:sse');

// OpenAI's ResponseErrorEvent carries message/code/param at the top level.
// Merge the two shapes so the documented top-level fields win for message/code
// while anything already modelled on the nested error object (notably type)
// still survives. Returns undefined only when neither source has anything.
export function topLevelErrorPayload(
  event: ResponsesEvent,
): ResponsesApiError | undefined {
  const nested = event.error;
  const hasTopLevel =
    event.message !== undefined ||
    event.code !== undefined ||
    event.param !== undefined;
  if (nested === undefined && !hasTopLevel) return undefined;
  return {
    message: event.message ?? nested?.message,
    type: nested?.type ?? event.type,
    code: event.code !== undefined ? event.code : nested?.code,
    // `null` is a meaningful value (no provider code or offending param):
    // preserve it rather than treating it as a fallback trigger.
    param: event.param !== undefined ? event.param : nested?.param,
  };
}

export function getIncompleteReason(
  event: ResponsesEvent,
  terminalReason: string,
): string | undefined {
  return terminalReason === 'incomplete'
    ? event.response?.incomplete_details?.reason
    : undefined;
}

/**
 * Log SSE event details for debugging.
 */
export function logSseEvent(
  event: ResponsesEvent,
  lastLoggedType: string | undefined,
): string | undefined {
  const newLastLoggedType =
    event.type !== lastLoggedType ? event.type : lastLoggedType;

  logger.debug(
    () =>
      `SSE event: type=${event.type}, delta="${event.delta?.slice(0, 50) ?? ''}", text="${event.text?.slice(0, 50) ?? ''}", item_type=${event.item?.type ?? 'none'}, summary_index=${event.summary_index ?? 'none'}, content_index=${event.content_index ?? 'none'}`,
  );
  // Extra debug for any reasoning-related events
  if (event.type.includes('reasoning') || event.item?.type === 'reasoning') {
    logger.debug(() => `REASONING SSE: ${JSON.stringify(event).slice(0, 500)}`);
  }

  // Debug: Log raw reasoning items
  if (event.item?.type === 'reasoning') {
    logger.debug(
      () =>
        `Reasoning item received: summary=${JSON.stringify(event.item?.summary)}, content=${JSON.stringify(event.item?.content)}, encrypted_content_length=${event.item?.encrypted_content?.length ?? 0}`,
    );
  }

  return newLastLoggedType;
}
