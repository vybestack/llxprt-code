/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { join } from 'node:path';
import type { Gpt56SourceSegment } from '../tokenizers/gpt56-source-projection.js';
import { PromptKeyDiskWriter } from './prompt-key-disk-writer.js';
import { PromptKeyTeeWriter } from './prompt-key-tee-writer.js';
import { withSerializationCleanup } from './responses-serialization-lifecycle.js';

/** Forms written next to the estimator form; each is a copy of the key. */
export type ExtraSegmentForm = 'wire' | 'dump';

const ALL_EXTRA_FORMS: readonly ExtraSegmentForm[] = Object.freeze([
  'wire',
  'dump',
] as const);

/** What the writers need from the request: costs are priced per model. */
export interface SegmentWriterOptions {
  readonly model: string;
  readonly signal?: AbortSignal;
  /**
   * The forms to write besides the estimator form. Responses writes both. A
   * send whose body is already a spool writes none, and a dump form is added
   * only when a dump was asked for.
   */
  readonly forms?: readonly ExtraSegmentForm[];
}

export interface WrittenSegment {
  readonly segment: Gpt56SourceSegment;
  readonly imageCount: number;
}

/**
 * Fills one prompt key. `sink` feeds the estimator, wire and dump files in one
 * pass; `writers` are the same files, in that order, for raw string values.
 */
export type SegmentFill = (
  sink: PromptKeyTeeWriter,
  writers: readonly PromptKeyDiskWriter[],
) => Promise<void> | void;

/**
 * The estimator form of one prompt key and the extra forms, written in a
 * single pass. The estimator writer is always first.
 */
export function openSegmentWriters(
  options: SegmentWriterOptions,
  root: string,
  key: Gpt56SourceSegment['promptKey'],
  costs: string,
  encoding: 'utf8' | 'utf16le',
): readonly PromptKeyDiskWriter[] {
  const forms = options.forms ?? ALL_EXTRA_FORMS;
  const opened: PromptKeyDiskWriter[] = [];
  try {
    for (const [suffix, mode] of [
      ['', 'estimator'],
      ...forms.map((form) => [`.${form}`, form] as const),
    ] as const)
      opened.push(
        new PromptKeyDiskWriter(
          join(root, `${key}${suffix}`),
          costs,
          options.model,
          options.signal,
          encoding,
          mode,
        ),
      );
  } catch (error) {
    for (const open of opened) open.close();
    throw error;
  }
  return opened;
}

export function closeAll(writers: readonly PromptKeyDiskWriter[]): void {
  const [first, ...rest] = writers;
  try {
    first.close();
  } finally {
    if (rest.length > 0) closeAll(rest);
  }
}

/**
 * Opens the three forms of `key` under `root`, lets `fill` write them, and
 * closes them whether or not `fill` succeeds. A raw string key is written as
 * UTF-16 text rather than as a JSON document.
 */
export async function writePromptSegment(
  options: SegmentWriterOptions,
  key: Gpt56SourceSegment['promptKey'],
  root: string,
  costs: string,
  rawString: boolean,
  fill: SegmentFill,
): Promise<WrittenSegment> {
  const encoding = rawString ? 'utf16le' : 'utf8';
  const forms = options.forms ?? ALL_EXTRA_FORMS;
  const writers = openSegmentWriters(options, root, key, costs, encoding);
  return withSerializationCleanup(
    async () => {
      await fill(new PromptKeyTeeWriter(writers), writers);
      return {
        segment: {
          promptKey: key,
          source: { path: join(root, key), encoding },
          ...(forms.includes('wire')
            ? { wireSource: { path: join(root, `${key}.wire`), encoding } }
            : {}),
          ...(forms.includes('dump')
            ? { dumpSource: { path: join(root, `${key}.dump`), encoding } }
            : {}),
          ...(rawString ? { rawString: true as const } : {}),
        },
        imageCount: writers[0].imageCount,
      };
    },
    () => closeAll(writers),
  );
}
