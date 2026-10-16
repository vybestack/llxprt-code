/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type OpenAI from 'openai';
import type { NormalizedGenerateChatOptions } from '../../../BaseProvider.js';
import { rowsSelection } from '../../../__tests__/support/wireBodyCapture.js';
import { readFileSync } from 'node:fs';
import type { WireBodySpool } from '../../../utils/wire-body-spool.js';
import {
  prepareRequest,
  type RequestContext,
} from '../../OpenAIRequestPreparation.js';

/** The sealed chat body parsed back into one object (tests only). */
export function readSpooledChatBody(
  spool: WireBodySpool,
): OpenAI.Chat.ChatCompletionCreateParams {
  return JSON.parse(
    readFileSync(spool.path, 'utf8'),
  ) as OpenAI.Chat.ChatCompletionCreateParams;
}

export type PreparedRequestBody = Omit<RequestContext, 'spool' | 'release'> & {
  readonly requestBody: OpenAI.Chat.ChatCompletionCreateParams;
  readonly messagesWithSystem: OpenAI.Chat.ChatCompletionMessageParam[];
};

/**
 * `prepareRequest` for tests that assert on the shape of the body: the
 * request is prepared from the call's rows (none unless given), the sealed
 * body is parsed back into an object, and the spool is released.
 */
export async function prepareRequestBody(
  options: NormalizedGenerateChatOptions,
  ...rest: Parameters<typeof prepareRequest> extends [unknown, ...infer Tail]
    ? Tail
    : never
): Promise<PreparedRequestBody> {
  const context = await prepareRequest(
    {
      ...options,
      requestRows: options.requestRows ?? rowsSelection([]),
      contentCount: options.contentCount ?? 0,
    },
    ...rest,
  );
  try {
    const requestBody = readSpooledChatBody(context.spool);
    const { spool: _spool, release: _release, ...scalars } = context;
    return {
      ...scalars,
      requestBody,
      messagesWithSystem: requestBody.messages,
    };
  } finally {
    context.release();
  }
}
