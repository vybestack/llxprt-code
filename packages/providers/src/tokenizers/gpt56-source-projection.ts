/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { rm } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import type { ImageTokenEstimateInput } from '@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js';
import {
  countDiskImageTokens,
  type Gpt56ImageCostsSource,
} from './gpt56-source-image-costs.js';
import type { O200kDiskSource } from './o200k-disk-source.js';

export interface Gpt56SourceLease {
  (): Promise<void>;
  countImageTokens(
    input: ImageTokenEstimateInput,
    signal?: AbortSignal,
  ): Promise<number>;
}

function ownedSource(
  directory: string,
  source: O200kDiskSource,
): O200kDiskSource {
  const path = resolve(source.path);
  const local = relative(directory, path);
  if (!local || local === '..' || local.startsWith(`..${sep}`))
    throw new TypeError('Segment must belong to its source directory');
  return Object.freeze({ path, encoding: source.encoding ?? 'utf8' });
}

export interface Gpt56SourceSegment {
  readonly promptKey: 'instructions' | 'input' | 'tools' | 'messages';
  readonly source: O200kDiskSource;
}

export interface Gpt56SourceProjectionOptions {
  readonly protocol: 'openai-responses' | 'openai-chat';
  readonly directory: string;
  readonly segments: readonly Gpt56SourceSegment[];
  readonly imageCosts?: Gpt56ImageCostsSource;
  readonly signal?: AbortSignal;
}

/**
 * Takes exclusive ownership of a sealed directory of complete prompt-key
 * segments. Callers must finish writes before construction and must not mutate
 * or remove files after transfer. Disposal waits for all estimator leases.
 * This opt-in contract is not produced by any provider projection route.
 */
export class Gpt56SourceProjection {
  readonly kind = 'llxprt-gpt56-source-prompt-v1';
  readonly protocol: Gpt56SourceProjectionOptions['protocol'];
  readonly promptSegments: readonly Gpt56SourceSegment[];
  readonly imageCosts: Gpt56ImageCostsSource | undefined;
  readonly signal: AbortSignal | undefined;
  readonly #directory: string;
  #leases = 0;
  #disposal: Promise<void> | undefined;
  #resolveDisposal: (() => void) | undefined;
  #rejectDisposal: ((error: unknown) => void) | undefined;

  constructor(options: Gpt56SourceProjectionOptions) {
    this.protocol = options.protocol;
    this.signal = options.signal;
    this.#directory = resolve(options.directory);
    const keys = new Set<string>();
    const allowed =
      options.protocol === 'openai-responses'
        ? ['instructions', 'input', 'tools']
        : ['messages', 'tools'];
    this.promptSegments = Object.freeze(
      options.segments.map((segment) => {
        if (!allowed.includes(segment.promptKey))
          throw new TypeError('Invalid prompt key for source protocol');
        if (keys.has(segment.promptKey))
          throw new TypeError('Duplicate prompt key');
        keys.add(segment.promptKey);
        return Object.freeze({
          promptKey: segment.promptKey,
          source: ownedSource(this.#directory, segment.source),
        });
      }),
    );
    if (options.imageCosts?.source.encoding === 'utf16le')
      throw new TypeError('Disk image costs require UTF-8 JSONL');
    this.imageCosts =
      options.imageCosts === undefined
        ? undefined
        : Object.freeze({
            source: ownedSource(this.#directory, options.imageCosts.source),
            provider: options.imageCosts.provider,
            model: options.imageCosts.model,
          });
    Object.freeze(this);
  }

  acquire(): Gpt56SourceLease {
    if (this.#disposal) throw new Error('Source projection is disposed');
    this.#leases++;
    let released = false;
    let readers = 0;
    let drained: Promise<void> | undefined;
    let resolveDrain: (() => void) | undefined;
    const release = async (): Promise<void> => {
      if (released) throw new Error('Source lease already released');
      released = true;
      if (readers !== 0) await drained;
      this.#leases--;
      if (this.#disposal && this.#leases === 0) {
        await this.#remove();
        await this.#disposal;
      }
    };
    const countImageTokens = async (
      input: ImageTokenEstimateInput,
      signal?: AbortSignal,
    ): Promise<number> => {
      if (released) throw new Error('Source lease already released');
      signal?.throwIfAborted();
      if (this.imageCosts === undefined) return 0;
      if (readers++ === 0)
        drained = new Promise<void>((resolve) => {
          resolveDrain = resolve;
        });
      try {
        return await countDiskImageTokens(this.imageCosts, input, signal);
      } finally {
        if (--readers === 0) resolveDrain?.();
      }
    };
    return Object.freeze(Object.assign(release, { countImageTokens }));
  }

  dispose(): Promise<void> {
    if (!this.#disposal) {
      this.#disposal = new Promise<void>((resolveDisposal, rejectDisposal) => {
        this.#resolveDisposal = resolveDisposal;
        this.#rejectDisposal = rejectDisposal;
      });
      if (this.#leases === 0) void this.#remove();
    }
    return this.#disposal;
  }

  async #remove(): Promise<void> {
    try {
      await rm(this.#directory, { recursive: true, force: true });
      this.#resolveDisposal?.();
    } catch (error) {
      this.#rejectDisposal?.(error);
    }
  }
}
