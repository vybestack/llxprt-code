/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MediaBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { UnsupportedMediaEntry } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createScratchDirSync } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import type { PromptKeySink } from '../runtime/prompt-key-tee-writer.js';
import {
  writePromptSegment,
  type ExtraSegmentForm,
} from '../runtime/prompt-segment-writers.js';
import {
  Gpt56SourceProjection,
  type Gpt56SourceSegment,
} from '../tokenizers/gpt56-source-projection.js';
import {
  unsupportedMediaOfRow,
  type MediaCategory,
} from '../utils/mediaUtils.js';
import type {
  ChatBodyOptions,
  ChatMessageItem,
} from './OpenAIChatBodyBuilder.js';

/** The chat protocol carries images only; every other media is a placeholder. */
const isSupportedChatMedia = (
  _block: MediaBlock,
  category: MediaCategory,
): boolean => category === 'image';

/**
 * What a chat projection owns: the estimator-form prompt files of one request
 * and the media the body could not carry. The files are the only thing the
 * estimator reads, so no message array exists between the body being written
 * and the estimate.
 */
export interface ChatPromptEstimate {
  readonly projection: Gpt56SourceProjection;
  readonly unsupportedMedia: readonly UnsupportedMediaEntry[];
  /** Removes the files when the projection was never handed to an owner. */
  discard(): void;
}

function readLedger(path: string): readonly UnsupportedMediaEntry[] {
  const ledger = readFileSync(path, 'utf8');
  return ledger === ''
    ? []
    : ledger
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as UnsupportedMediaEntry);
}

/**
 * Writes the prompt files of a chat body as it is converted: the estimator
 * form of the `messages` array one message at a time and of the `tools` value,
 * and a ledger of the media that is replaced by a placeholder, one small line
 * per block, appended as the rows pass. When a dump was asked for the dump
 * form of the messages is written beside their estimator form in the same
 * pass; the tools are small and a dump reads them from the request.
 */
export class ChatEstimatorFiles {
  readonly #root: string;
  readonly #costs: string;
  readonly #ledger: string;
  readonly #model: string;
  readonly #signal: AbortSignal | undefined;
  readonly #messageForms: readonly ExtraSegmentForm[];
  readonly #segments: Gpt56SourceSegment[] = [];

  private constructor(
    model: string,
    signal: AbortSignal | undefined,
    dump: boolean,
  ) {
    this.#model = model;
    this.#signal = signal;
    this.#messageForms = dump ? ['dump'] : [];
    this.#root = createScratchDirSync('openai-chat-prompt-keys-');
    this.#costs = join(this.#root, 'image-costs.jsonl');
    this.#ledger = join(this.#root, 'unsupported-media.jsonl');
    try {
      writeFileSync(this.#costs, '', { mode: 0o600 });
      writeFileSync(this.#ledger, '', { mode: 0o600 });
    } catch (error) {
      this.discard();
      throw error;
    }
  }

  static create(
    model: string,
    signal: AbortSignal | undefined,
    dump: boolean,
  ): ChatEstimatorFiles {
    return new ChatEstimatorFiles(model, signal, dump);
  }

  /**
   * The media stage with the ledger behind it: each row that leaves the stage
   * has its unsupported media appended before the row is converted.
   */
  listUnsupportedMedia(
    stage: ChatBodyOptions['mediaStage'],
  ): NonNullable<ChatBodyOptions['mediaStage']> {
    const ledger = this.#ledger;
    return async function* (rows) {
      for await (const row of stage?.(rows) ?? rows) {
        const entries = unsupportedMediaOfRow(row, isSupportedChatMedia);
        if (entries.length > 0) {
          appendFileSync(
            ledger,
            entries.map((entry) => `${JSON.stringify(entry)}\n`).join(''),
          );
        }
        yield row;
      }
    };
  }

  /** Runs `fill` against the estimator form of the `messages` array. */
  async writeMessages(
    fill: (sink: PromptKeySink) => Promise<void>,
  ): Promise<void> {
    const written = await writePromptSegment(
      { model: this.#model, signal: this.#signal, forms: this.#messageForms },
      'messages',
      this.#root,
      this.#costs,
      false,
      (sink) => fill(sink),
    );
    this.#segments.push(written.segment);
  }

  async writeTools(tools: unknown): Promise<void> {
    if (tools === undefined) return;
    const written = await writePromptSegment(
      { model: this.#model, signal: this.#signal, forms: [] },
      'tools',
      this.#root,
      this.#costs,
      false,
      (sink) => sink.value(tools),
    );
    this.#segments.push(written.segment);
  }

  /** The dump-form file of the messages, once they were written. */
  dumpMessagesFile(): string {
    const path = this.#segments.find(
      (segment) => segment.promptKey === 'messages',
    )?.dumpSource?.path;
    if (path === undefined) {
      throw new Error('The chat dump form was not written');
    }
    return path;
  }

  /** Hands the finished files to a projection, which owns them from here. */
  seal(): ChatPromptEstimate {
    const projection = new Gpt56SourceProjection({
      protocol: 'openai-chat',
      directory: this.#root,
      segments: this.#segments,
      signal: this.#signal,
      imageCosts: {
        source: { path: this.#costs, encoding: 'utf8' },
        provider: 'openai-responses',
        model: this.#model,
      },
    });
    return {
      projection,
      unsupportedMedia: readLedger(this.#ledger),
      discard: () => this.discard(),
    };
  }

  discard(): void {
    rmSync(this.#root, { recursive: true, force: true });
  }
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
