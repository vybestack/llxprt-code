/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { MediaBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { PromptKeySink } from '../runtime/prompt-key-tee-writer.js';
import {
  PromptEstimatorFiles,
  type PromptEstimate,
} from '../runtime/prompt-estimator-files.js';
import type { MediaCategory } from '../utils/mediaUtils.js';
import type { ChatMessageItem } from './OpenAIChatBodyBuilder.js';
import type { NativeChatEstimateProjection } from './native-chat-estimate.js';

/** The chat protocol carries images only; every other media is a placeholder. */
const isSupportedChatMedia = (
  _block: MediaBlock,
  category: MediaCategory,
): boolean => category === 'image';

/** What a chat projection owns: its prompt files and the media it dropped. */
export interface ChatPromptEstimate extends Omit<PromptEstimate, 'projection'> {
  readonly projection:
    | PromptEstimate['projection']
    | NativeChatEstimateProjection;
}

/** The prompt files of a chat body (`messages` and `tools`). */
export type ChatEstimatorFiles = PromptEstimatorFiles;

export function createChatEstimatorFiles(
  model: string,
  signal: AbortSignal | undefined,
  dump: boolean,
): ChatEstimatorFiles {
  return new PromptEstimatorFiles({
    protocol: 'openai-chat',
    scratchPrefix: 'openai-chat-prompt-keys-',
    model,
    signal,
    dump,
    isSupportedMedia: isSupportedChatMedia,
  });
}

/**
 * One message of the body in estimator form. A tool-media message is written
 * part by part from scratch, so its parts are never held together.
 */
export function writeEstimateMessage(
  sink: PromptKeySink,
  item: ChatMessageItem,
): void {
  if (item.kind === 'message') {
    sink.value(item.message);
    return;
  }
  sink.append('{"role":"user","content":[');
  let first = true;
  for (const part of item.parts()) {
    if (!first) sink.append(',');
    first = false;
    sink.value(part);
  }
  sink.append(']}');
}
