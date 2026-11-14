/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ContinuationToolCall } from './OpenAIRequestBuilder.js';
import type { ChatHttpBody } from '../utils/chat-http-body.js';

export interface ContinuationBody {
  readonly spool: ChatHttpBody;
  release(): void | Promise<void>;
}

/**
 * The request that follows a reply of tool calls and no text (issue #584): the
 * conversation of the first request again, without its reasoning, then the
 * tool calls acknowledged and a user turn asking the model to go on.
 */
export interface ChatContinuation {
  build(toolCalls: ContinuationToolCall[]): Promise<ContinuationBody>;
}
