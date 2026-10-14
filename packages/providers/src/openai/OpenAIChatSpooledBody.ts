/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type OpenAI from 'openai';
import type { WireBodySpool } from '../utils/wire-body-spool.js';

/**
 * The sealed chat body parsed back into one object.
 *
 * This is the isolated place where a chat send still needs the whole body as
 * a value: the dump contexts (D3c) and the continuation request (D4) each read
 * it on demand. The send itself never calls it; it streams the spool, and the
 * token estimator reads its own estimator-form files.
 */
export function readSpooledChatBody(
  spool: WireBodySpool,
): OpenAI.Chat.ChatCompletionCreateParams {
  return JSON.parse(
    spool.readSealed().toString('utf8'),
  ) as OpenAI.Chat.ChatCompletionCreateParams;
}

/** {@link readSpooledChatBody} on first call; later calls return the same body. */
export function lazySpooledChatBody(
  spool: WireBodySpool,
): () => OpenAI.Chat.ChatCompletionCreateParams {
  let body: OpenAI.Chat.ChatCompletionCreateParams | undefined;
  return () => (body ??= readSpooledChatBody(spool));
}
