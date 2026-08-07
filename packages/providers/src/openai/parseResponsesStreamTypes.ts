/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type ResponsesApiError = {
  message?: string;
  type?: string;
  code?: string;
  param?: string | null;
};

export type ResponsesEvent = {
  type: string;
  sequence_number?: number;
  output_index?: number;
  delta?: string;
  text?: string;
  content_index?: number;
  summary_index?: number;
  // Real OpenAI ResponseErrorEvent carries these at the top level (not nested
  // under error). See node_modules/openai/resources/responses/responses.d.ts.
  message?: string;
  code?: string;
  param?: string | null;
  item?: {
    id: string;
    type: string;
    status?: string;
    arguments?: string;
    call_id?: string;
    name?: string;
    summary?: Array<{ type: string; text?: string }>;
    content?: Array<{ type: string; text?: string }>;
    encrypted_content?: string;
  };
  item_id?: string;
  arguments?: string;
  error?: ResponsesApiError;
  response?: {
    id: string;
    object: string;
    model: string;
    status: string;
    error?: ResponsesApiError;
    incomplete_details?: { reason?: string };
    usage?: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      input_tokens_details?: {
        cached_tokens?: number;
      };
    };
  };
};

export type FunctionCallState = {
  id: string;
  call_id?: string;
  name: string;
  arguments: string;
};

export type ReasoningDeltaSource =
  | 'reasoning_text'
  | 'reasoning_summary_text'
  | 'output_item';

export type DispatchState = {
  hasEmittedVisibleThinking: boolean;
  reasoningText: string;
  reasoningSummaryText: string;
  nextReasoningStreamIndex: number;
  currentReasoningStreamId?: string;
  visibleReasoningSource?: ReasoningDeltaSource;
  lastEmittedReasoningDelta?: string;
};

export type DispatchResult = DispatchState & {
  lastLoggedType: string | undefined;
  /**
   * The `type` of the event that was successfully parsed and dispatched in
   * this step, independent of the deduplicated `lastLoggedType`. `undefined`
   * when the event was malformed JSON and therefore not dispatched.
   *
   * Used to record accepted-terminal state monotonically per data line so
   * that a nonterminal event following a terminal one in the same reader
   * chunk cannot mask the terminal (issue #3049).
   */
  dispatchedEventType: string | undefined;
};
