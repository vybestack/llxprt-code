/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type OpenAI from 'openai';
import type { NormalizedGenerateChatOptions } from '../../../BaseProvider.js';
import { rowsSelection } from '../../../__tests__/support/wireBodyCapture.js';
import {
  prepareRequest,
  type RequestContext,
} from '../../OpenAIRequestPreparation.js';

function isChatBody(
  value: unknown,
): value is OpenAI.Chat.ChatCompletionCreateParams {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'model' in value &&
    typeof value.model === 'string' &&
    'messages' in value &&
    Array.isArray(value.messages)
  );
}

export async function readPreparedChatBody(
  spool: RequestContext['spool'],
): Promise<OpenAI.Chat.ChatCompletionCreateParams> {
  const handle = spool.openStream();
  try {
    const bytes = await new Response(handle.stream).arrayBuffer();
    if (bytes.byteLength !== spool.byteLength)
      throw new Error('Prepared Chat body length mismatch');
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isChatBody(value))
      throw new Error('Prepared Chat body has no messages');
    return value;
  } finally {
    await handle.dispose();
  }
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
    const requestBody = await readPreparedChatBody(context.spool);
    const { spool: _spool, release: _release, ...scalars } = context;
    return {
      ...scalars,
      requestBody,
      messagesWithSystem: requestBody.messages,
    };
  } finally {
    await context.release();
  }
}
