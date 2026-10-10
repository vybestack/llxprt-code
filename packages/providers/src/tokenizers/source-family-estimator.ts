/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile } from 'node:fs/promises';
import type {
  RuntimePromptEstimateRequest,
  RuntimePromptEstimateResult,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { ImageDimensions } from '@vybestack/llxprt-code-tools/utils/imageDimensions.js';
import {
  countPromptTokens,
  type ProjectionImageEntry,
  type ProviderFinalizedPromptProjection,
} from '../runtime/promptEnvelopeProjections.js';
import type {
  Gpt56SourceProjection,
  Gpt56SourceSegment,
} from './gpt56-source-projection.js';

/**
 * Estimate a sealed disk prompt through the factory's family registry for
 * models whose tokenizer is not the pinned o200k disk counter (official,
 * Claude-calibrated and legacy families).
 *
 * Those estimators tokenize whole canonical segments, so this reads one
 * segment at a time, hands the registry the same finalized projection shape
 * the array route builds, and returns only the scalar result. The strings are
 * request-local to this call; nothing is returned or retained. Segment
 * boundaries are the same top-level prompt keys the array route sums over, so
 * no extra tokenizer boundary is introduced.
 */
export async function estimateSourceThroughFamilyRegistry(
  request: RuntimePromptEstimateRequest,
  projection: Gpt56SourceProjection,
  factory: RuntimeTokenizerFactory,
  signal?: AbortSignal,
): Promise<RuntimePromptEstimateResult> {
  const release = projection.acquire();
  try {
    const finalized = await readFinalizedProjection(projection, signal);
    signal?.throwIfAborted();
    return await factory.estimatePrompt({
      ...request,
      finalizedProjection: finalized,
      legacyEstimate: () =>
        Promise.resolve(countPromptTokens(finalized.promptText)),
    });
  } finally {
    await release();
  }
}

async function readSegment(
  segment: Gpt56SourceSegment,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const bytes = await readFile(segment.source.path, { signal });
  return bytes.toString(segment.source.encoding ?? 'utf8');
}

async function readFinalizedProjection(
  projection: Gpt56SourceProjection,
  signal?: AbortSignal,
): Promise<ProviderFinalizedPromptProjection> {
  const segments: string[] = [];
  const members: string[] = [];
  for (const segment of projection.promptSegments) {
    const text = await readSegment(segment, signal);
    segments.push(text);
    members.push(
      `${JSON.stringify(segment.promptKey)}:${
        segment.rawString === true ? JSON.stringify(text) : text
      }`,
    );
  }
  const imageEntries = await readImageEntries(projection, signal);
  return Object.freeze({
    kind: 'llxprt-provider-prompt-v3',
    protocol: projection.protocol,
    promptText: members.length === 0 ? '' : `{${members.join(',')}}`,
    promptSegments: Object.freeze(segments),
    ...(imageEntries.length > 0 ? { imageEntries } : {}),
  });
}

async function readImageEntries(
  projection: Gpt56SourceProjection,
  signal?: AbortSignal,
): Promise<readonly ProjectionImageEntry[]> {
  if (projection.imageCosts === undefined) return [];
  const text = await readFile(projection.imageCosts.source.path, {
    encoding: 'utf8',
    signal,
  });
  return Object.freeze(
    text
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const record = JSON.parse(line) as { dimensions?: ImageDimensions };
        return Object.freeze(
          record.dimensions === undefined
            ? {}
            : { dimensions: record.dimensions },
        );
      }),
  );
}
