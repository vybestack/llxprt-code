/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { closeSync, openSync, readSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import {
  estimateImageTokens,
  type ImageTokenEstimateInput,
} from '@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js';
import type { ImageDimensions } from '@vybestack/llxprt-code-tools/utils/imageDimensions.js';
import type { O200kDiskSource } from './o200k-disk-source.js';

export interface Gpt56ImageCostsSource {
  readonly source: O200kDiskSource;
  readonly provider: string;
  readonly model: string;
}
interface ImageCostRecord {
  readonly cost: number;
  readonly dimensions?: ImageDimensions;
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function dimensions(value: unknown): value is ImageDimensions {
  return object(value) && finite(value.width) && finite(value.height);
}
function costRecord(value: unknown): value is ImageCostRecord {
  if (!object(value) || !finite(value.cost)) return false;
  if (!Number.isSafeInteger(value.cost) || value.cost <= 0) return false;
  return !('dimensions' in value) || dimensions(value.dimensions);
}
function safeCount(count: number): number {
  if (!Number.isSafeInteger(count))
    throw new RangeError(
      'Image token count exceeds JavaScript integer precision',
    );
  return count;
}
function recordCost(
  line: string,
  source: Gpt56ImageCostsSource,
  input: ImageTokenEstimateInput,
): number {
  const record: unknown = JSON.parse(line);
  if (!costRecord(record))
    throw new TypeError('Invalid disk image cost record');
  if (
    record.cost !==
    estimateImageTokens({
      provider: source.provider,
      model: source.model,
      dimensions: record.dimensions,
    })
  )
    throw new Error('Disk image cost disagrees with its dimensions');
  return estimateImageTokens({ ...input, dimensions: record.dimensions });
}

/** Reads one JSONL scalar/dimension record at a time, never an image list. */
export async function countDiskImageTokens(
  source: Gpt56ImageCostsSource,
  input: ImageTokenEstimateInput,
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  const fd = openSync(source.source.path, 'r');
  try {
    const bytes = Buffer.alloc(65536);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let pending = '';
    let total = 0;
    for (;;) {
      signal?.throwIfAborted();
      const size = readSync(fd, bytes, 0, bytes.length, null);
      signal?.throwIfAborted();
      if (size === 0) break;
      pending += decoder.decode(bytes.subarray(0, size), { stream: true });
      let start = 0;
      let end = pending.indexOf('\n', start);
      while (end !== -1) {
        signal?.throwIfAborted();
        total = safeCount(
          total + recordCost(pending.slice(start, end), source, input),
        );
        start = end + 1;
        end = pending.indexOf('\n', start);
      }
      pending = pending.slice(start);
      await setImmediate();
    }
    pending += decoder.decode();
    if (pending !== '') throw new Error('Incomplete disk image cost record');
    signal?.throwIfAborted();
    return total;
  } finally {
    closeSync(fd);
  }
}
