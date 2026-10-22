/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { KeyedRowIndex } from '../utils/keyed-row-index.js';
import { KeyedRowToolIdStore } from '../utils/keyed-row-tool-id-store.js';
import { StreamedSegment, writeEnvelope } from '../utils/envelope-writer.js';
import { WireBodySpool } from '../utils/wire-body-spool.js';
import {
  usesToolIdStore,
  type ChatBodyOptions,
  type ChatBodyRows,
} from './OpenAIChatBodyBuilder.js';
import { writeMessagesSegment } from './OpenAIChatMessagesSegment.js';
import {
  buildContinuationTail,
  type ContinuationToolCall,
} from './OpenAIRequestBuilder.js';

import type { ChatHttpBody } from '../utils/chat-http-body.js';

export interface ContinuationBody<Body extends ChatHttpBody = ChatHttpBody> {
  readonly spool: Body;
  release(): void | Promise<void>;
}

/**
 * The request that follows a reply of tool calls and no text (issue #584): the
 * conversation of the first request again, without its reasoning, then the
 * tool calls acknowledged and a user turn asking the model to go on.
 */
export interface ChatContinuation<Body extends ChatHttpBody = ChatHttpBody> {
  build(toolCalls: ContinuationToolCall[]): Promise<ContinuationBody<Body>>;
}

export interface ChatContinuationInput {
  /** The first request's envelope: its `messages` is an empty placeholder. */
  readonly envelope: Readonly<Record<string, unknown>>;
  readonly systemInstruction: string | undefined;
  readonly signal: AbortSignal | undefined;
  /** The rows of the first request; read again, as a second spool. */
  readonly source: ChatBodyRows;
  /** The first request's body options; the id store and reasoning differ. */
  readonly body: Omit<ChatBodyOptions, 'toolIdStore' | 'omitReasoning'>;
}

function releaseContinuation(
  spool: WireBodySpool,
  toolIds: KeyedRowIndex | undefined,
): void {
  try {
    spool.dispose();
  } finally {
    toolIds?.close();
  }
}

/**
 * Builds the continuation as a second spool. Its tool id mapper is a fresh one
 * over a fresh index that observes the rows again, which is what the first
 * request's mapper did, so both requests carry the same ids. Nothing of the
 * first request's body is read back: the rows are converted again with the
 * reasoning left out.
 */
export function createChatContinuation(
  input: ChatContinuationInput,
): ChatContinuation<WireBodySpool> {
  return {
    async build(toolCalls) {
      const spool = WireBodySpool.create('openai-chat-continuation', {
        signal: input.signal,
      });
      let toolIds: KeyedRowIndex | undefined;
      const release = (): void => releaseContinuation(spool, toolIds);
      try {
        if (usesToolIdStore(input.body.toolFormat)) {
          toolIds = KeyedRowIndex.create('tool-ids');
        }
        const bodyOptions: ChatBodyOptions = {
          ...input.body,
          omitReasoning: true,
          ...(toolIds === undefined
            ? {}
            : { toolIdStore: new KeyedRowToolIdStore(toolIds) }),
        };
        const tail = buildContinuationTail(toolCalls, input.body.toolFormat);
        const messages = new StreamedSegment(async (sink) => {
          await writeMessagesSegment(
            sink,
            input.systemInstruction,
            input.source,
            bodyOptions,
            undefined,
            tail,
          );
        });
        await writeEnvelope(spool, {
          ...input.envelope,
          messages,
          stream: true,
        });
        spool.seal();
        return { spool, release };
      } catch (error) {
        release();
        throw error;
      }
    },
  };
}
