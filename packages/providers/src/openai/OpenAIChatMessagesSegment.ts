/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { jsonValueChunks } from '../utils/boundedJsonBody.js';
import type { EnvelopeSink } from '../utils/envelope-writer.js';
import type { PromptKeySink } from '../runtime/prompt-key-tee-writer.js';
import {
  writeChatMessages,
  type ChatBodyOptions,
  type ChatBodyRows,
} from './OpenAIChatBodyBuilder.js';
import { writeEstimateMessage } from './OpenAIChatEstimatorFiles.js';

/**
 * Writes the `messages` array of a chat body: `[`, the system message, each
 * message the rows convert to behind a comma, then the `tail` messages (the
 * continuation request ends with the acknowledged tool calls), `]`. Returns the
 * number of messages written. When `estimate` is given, the same messages are
 * written to it in estimator form, one at a time, with the same punctuation.
 */
export async function writeMessagesSegment(
  sink: EnvelopeSink,
  systemInstruction: string | undefined,
  source: ChatBodyRows,
  bodyOptions: ChatBodyOptions,
  estimate: PromptKeySink | undefined,
  tail: readonly unknown[] = [],
): Promise<number> {
  const systemMessage = { role: 'system', content: systemInstruction ?? '' };
  sink.append('[');
  estimate?.append('[');
  const system = jsonValueChunks(systemMessage);
  if (system === undefined) throw new Error('System message is not JSON');
  for (const chunk of system) sink.append(chunk);
  estimate?.value(systemMessage);
  const converted = await writeChatMessages(source, bodyOptions, {
    message(chunks, item) {
      sink.append(',');
      for (const chunk of chunks) sink.append(chunk);
      if (estimate !== undefined) {
        estimate.append(',');
        writeEstimateMessage(estimate, item);
      }
    },
  });
  for (const message of tail) {
    const chunks = jsonValueChunks(message);
    if (chunks === undefined) throw new Error('Tail message is not JSON');
    sink.append(',');
    for (const chunk of chunks) sink.append(chunk);
    estimate?.append(',');
    estimate?.value(message);
  }
  sink.append(']');
  estimate?.append(']');
  return converted + tail.length + 1;
}
