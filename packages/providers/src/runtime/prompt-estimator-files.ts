/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { UnsupportedMediaEntry } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createScratchDirSync } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import type { PromptKeySink } from './prompt-key-tee-writer.js';
import {
  writePromptSegment,
  type ExtraSegmentForm,
} from './prompt-segment-writers.js';
import {
  Gpt56SourceProjection,
  type Gpt56SourceProjectionOptions,
  type Gpt56SourceSegment,
} from '../tokenizers/gpt56-source-projection.js';
import {
  unsupportedMediaOfRow,
  type MediaCategory,
} from '../utils/mediaUtils.js';

/**
 * What an estimated request owns: the estimator-form prompt files of one
 * request and the media its body could not carry. The files are the only
 * thing the estimator reads, so no message array exists between the body being
 * written and the estimate.
 */
export interface PromptEstimate {
  readonly projection: Gpt56SourceProjection;
  readonly unsupportedMedia: readonly UnsupportedMediaEntry[];
  /** Removes the files when the projection was never handed to an owner. */
  discard(): void;
}

export interface PromptEstimatorFilesOptions {
  readonly protocol: Gpt56SourceProjectionOptions['protocol'];
  /** Prefix of the request-scoped scratch directory. */
  readonly scratchPrefix: string;
  readonly model: string;
  readonly signal: AbortSignal | undefined;
  /** Write the dump form of `messages` beside its estimator form. */
  readonly dump: boolean;
  /** Which media the protocol carries; the rest is listed as unsupported. */
  readonly isSupportedMedia: (
    block: MediaBlock,
    category: MediaCategory,
  ) => boolean;
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
 * Writes the prompt files of a body as it is converted: the estimator form of
 * the `messages` array one message at a time, of the `system` and `tools`
 * values, and a ledger of the media that is replaced by a placeholder, one
 * small line per block, appended as the rows pass. When a dump was asked for
 * the dump form of the messages is written beside their estimator form in the
 * same pass; `system` and `tools` are small and a dump reads them from the
 * request.
 */
export class PromptEstimatorFiles {
  readonly #options: PromptEstimatorFilesOptions;
  readonly #root: string;
  readonly #costs: string;
  readonly #ledger: string;
  readonly #messageForms: readonly ExtraSegmentForm[];
  readonly #segments: Gpt56SourceSegment[] = [];

  constructor(options: PromptEstimatorFilesOptions) {
    this.#options = options;
    this.#messageForms = options.dump ? ['dump'] : [];
    this.#root = createScratchDirSync(options.scratchPrefix);
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

  /** Appends the unsupported media of one resolved row to the ledger. */
  recordUnsupportedMedia(row: IContent): void {
    const entries = unsupportedMediaOfRow(row, this.#options.isSupportedMedia);
    if (entries.length === 0) return;
    appendFileSync(
      this.#ledger,
      entries.map((entry) => `${JSON.stringify(entry)}\n`).join(''),
    );
  }

  /**
   * The media stage with the ledger behind it: each row that leaves the stage
   * has its unsupported media appended before the row is converted.
   */
  listUnsupportedMedia(
    stage:
      | ((rows: AsyncIterable<IContent>) => AsyncIterable<IContent>)
      | undefined,
  ): (rows: AsyncIterable<IContent>) => AsyncIterable<IContent> {
    const record = (row: IContent): void => this.recordUnsupportedMedia(row);
    return async function* (rows) {
      for await (const row of stage?.(rows) ?? rows) {
        record(row);
        yield row;
      }
    };
  }

  /** Runs `fill` against the estimator form of the `messages` array. */
  async writeMessages(
    fill: (sink: PromptKeySink) => Promise<void>,
  ): Promise<void> {
    const written = await writePromptSegment(
      {
        model: this.#options.model,
        signal: this.#options.signal,
        forms: this.#messageForms,
      },
      'messages',
      this.#root,
      this.#costs,
      false,
      (sink) => fill(sink),
    );
    this.#segments.push(written.segment);
  }

  /**
   * The estimator form of the `system` value, which stands before the
   * messages in the request. A string is a raw string segment (UTF-16 text),
   * anything else a JSON document.
   */
  async writeSystem(system: unknown): Promise<void> {
    if (system === undefined) return;
    const rawString = typeof system === 'string';
    const written = await writePromptSegment(
      this.#smallKeyOptions(),
      'system',
      this.#root,
      this.#costs,
      rawString,
      (sink, writers) => {
        if (typeof system === 'string')
          for (const writer of writers) writer.string(system, false);
        else sink.value(system);
      },
    );
    this.#segments.push(written.segment);
  }

  async writeTools(tools: unknown): Promise<void> {
    if (tools === undefined) return;
    const written = await writePromptSegment(
      this.#smallKeyOptions(),
      'tools',
      this.#root,
      this.#costs,
      false,
      (sink) => sink.value(tools),
    );
    this.#segments.push(written.segment);
  }

  #smallKeyOptions(): {
    model: string;
    signal: AbortSignal | undefined;
    forms: readonly ExtraSegmentForm[];
  } {
    return {
      model: this.#options.model,
      signal: this.#options.signal,
      forms: [],
    };
  }

  /** The dump-form file of the messages, once they were written. */
  dumpMessagesFile(): string {
    const path = this.#segments.find(
      (segment) => segment.promptKey === 'messages',
    )?.dumpSource?.path;
    if (path === undefined) {
      throw new Error('The dump form of the messages was not written');
    }
    return path;
  }

  /** Hands the finished files to a projection, which owns them from here. */
  seal(): PromptEstimate {
    const { protocol, model, signal } = this.#options;
    const projection = new Gpt56SourceProjection({
      protocol,
      directory: this.#root,
      segments: this.#segments,
      signal,
      imageCosts: {
        source: { path: this.#costs, encoding: 'utf8' },
        provider: 'openai-responses',
        model,
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
