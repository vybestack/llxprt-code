/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResponsesInputBuildContext } from '../openai-responses/OpenAIResponsesInputBuilder.js';
import { requestScopedContents } from '../utils/requestScopedBody.js';
import {
  Gpt56SourceProjection,
  type Gpt56SourceSegment,
} from '../tokenizers/gpt56-source-projection.js';
import type { O200kDiskSource } from '../tokenizers/o200k-disk-source.js';
import { PROJECTION_REVISION } from './promptEnvelopeProjections.js';
import { PromptKeyDiskWriter } from './prompt-key-disk-writer.js';
import { PromptKeyTeeWriter } from './prompt-key-tee-writer.js';
import {
  ResponsesSourceInput,
  type HistoryDangling,
} from './responses-source-input.js';
import {
  cancellableSerialization,
  withSerializationCleanup,
  type ResponsesSerialization,
} from './responses-serialization-lifecycle.js';

export interface ResponsesSourceOptions {
  readonly model: string;
  readonly instructions?: string;
  readonly tools?: unknown;
  readonly contents: AsyncIterable<IContent>;
  readonly context: ResponsesInputBuildContext;
  /** Request-override `input` replaces the rows entirely, as in the array route. */
  readonly inputOverride?: { readonly value: unknown };
  /** Set when `contents` starts after a stateful parent (see HistoryDangling). */
  readonly historyDangling?: HistoryDangling;
  readonly signal?: AbortSignal;
  readonly stateful?: {
    readonly statefulParentUsed: boolean;
    readonly retainedBaselineTokens?: number;
    readonly incrementalContents: AsyncIterable<IContent>;
    readonly fullHistoryContents?: AsyncIterable<IContent>;
  };
}

export interface ResponsesSourcePrompt {
  readonly model: string;
  readonly protocol: 'openai-responses';
  readonly method: 'responses/v1';
  readonly projectionRevision: number;
  readonly projection: Pick<
    Gpt56SourceProjection,
    'protocol' | 'promptSegments' | 'acquire' | 'dispose'
  >;
  toEstimatorProjection(): Gpt56SourceProjection;
  /** JSONL scalar costs and dimensions share the prompt-segment lease. */
  readonly imageCostsSource: O200kDiskSource;
  readonly unsupportedMediaSource: O200kDiskSource;
  readonly imageCount: number;
  readonly accounting?: {
    readonly statefulParentUsed: boolean;
    readonly retainedBaselineTokens?: number;
    readonly incremental?: ResponsesSourcePrompt;
    readonly fullHistory?: ResponsesSourcePrompt;
  };
  dispose(): Promise<void>;
}

async function segment(
  options: ResponsesSourceOptions,
  key: Gpt56SourceSegment['promptKey'],
  root: string,
  costs: string,
): Promise<{ segment: Gpt56SourceSegment; imageCount: number }> {
  const path = join(root, key);
  const wirePath = join(root, `${key}.wire`);
  const rawString =
    key === 'instructions' ||
    (key === 'tools' && typeof options.tools === 'string');
  const encoding = rawString ? 'utf16le' : 'utf8';
  const writer = new PromptKeyDiskWriter(
    path,
    costs,
    options.model,
    options.signal,
    encoding,
  );
  let wire: PromptKeyDiskWriter;
  try {
    wire = new PromptKeyDiskWriter(
      wirePath,
      costs,
      options.model,
      options.signal,
      encoding,
      true,
    );
  } catch (error) {
    writer.close();
    throw error;
  }
  return withSerializationCleanup(
    async () => {
      const sink = new PromptKeyTeeWriter([writer, wire]);
      if (key === 'input' && options.inputOverride !== undefined) {
        sink.value(options.inputOverride.value);
      } else if (key === 'input') {
        const owner = requestScopedContents(options.contents, options.signal);
        await withSerializationCleanup(
          () =>
            new ResponsesSourceInput(
              sink,
              options.context,
              join(root, 'unsupported-media.jsonl'),
              options.signal,
              options.historyDangling,
            ).write(owner),
          () => owner.dispose(),
        );
      } else if (key === 'instructions') {
        writer.string(options.instructions ?? '', false);
        wire.string(options.instructions ?? '', false);
      } else if (typeof options.tools === 'string') {
        writer.string(options.tools, false);
        wire.string(options.tools, false);
      } else sink.value(options.tools);
      return {
        segment: {
          promptKey: key,
          source: { path, encoding },
          wireSource: { path: wirePath, encoding },
          ...(rawString ? { rawString: true as const } : {}),
        },
        imageCount: writer.imageCount,
      };
    },
    () => {
      try {
        writer.close();
      } finally {
        wire.close();
      }
    },
  );
}

function omitKey(
  key: Gpt56SourceSegment['promptKey'],
  options: ResponsesSourceOptions,
  inputOnly: boolean,
): boolean {
  if (inputOnly) return key !== 'input';
  if (key === 'instructions') return options.instructions === undefined;
  return key === 'tools' && options.tools === undefined;
}

async function prompt(
  options: ResponsesSourceOptions,
  inputOnly: boolean,
): Promise<ResponsesSourcePrompt> {
  options.signal?.throwIfAborted();
  const root = mkdtempSync(join(tmpdir(), 'responses-prompt-keys-'));
  const costs = join(root, 'image-costs.jsonl');
  try {
    writeFileSync(costs, '', { mode: 0o600 });
    writeFileSync(join(root, 'unsupported-media.jsonl'), '', { mode: 0o600 });
    const segments: Gpt56SourceSegment[] = [];
    let imageCount = 0;
    for (const key of ['instructions', 'input', 'tools'] as const) {
      if (omitKey(key, options, inputOnly)) continue;
      const written = await segment(options, key, root, costs);
      segments.push(written.segment);
      imageCount += written.imageCount;
    }
    const projection = new Gpt56SourceProjection({
      protocol: 'openai-responses',
      directory: root,
      signal: options.signal,
      segments,
      imageCosts: {
        source: { path: costs, encoding: 'utf8' },
        provider: 'openai-responses',
        model: options.model,
      },
    });
    const unsupported =
      statSync(join(root, 'unsupported-media.jsonl')).size !== 0;
    return Object.freeze({
      model: options.model,
      protocol: 'openai-responses',
      method: 'responses/v1',
      projectionRevision: PROJECTION_REVISION,
      projection: Object.freeze({
        protocol: projection.protocol,
        promptSegments: projection.promptSegments,
        acquire: () => projection.acquire(),
        dispose: () => projection.dispose(),
      }),
      toEstimatorProjection: (): Gpt56SourceProjection => {
        if (unsupported)
          throw new Error(
            'Source estimator cannot enforce disk unsupported media',
          );
        return projection;
      },
      imageCostsSource: Object.freeze({ path: costs, encoding: 'utf8' }),
      unsupportedMediaSource: Object.freeze({
        path: join(root, 'unsupported-media.jsonl'),
        encoding: 'utf8',
      }),
      imageCount,
      dispose: () => projection.dispose(),
    });
  } catch (error) {
    return withSerializationCleanup<ResponsesSourcePrompt>(
      () => Promise.reject(error),
      () => rmSync(root, { recursive: true, force: true }),
    );
  }
}

/** Opt-in foundation only. Does not change provider projections or sends. */
export function serializeResponsesPromptEnvelope(
  options: ResponsesSourceOptions,
): ResponsesSerialization<ResponsesSourcePrompt> {
  return cancellableSerialization(
    () => buildResponsesPromptEnvelope(options),
    (value) => value.dispose(),
    options.signal,
  );
}

async function buildResponsesPromptEnvelope(
  options: ResponsesSourceOptions,
): Promise<ResponsesSourcePrompt> {
  if (options.model.trim() === '')
    throw new Error('Prompt source requires a non-empty model');
  const stateful = options.stateful;
  if (
    stateful?.statefulParentUsed === true &&
    stateful.retainedBaselineTokens === undefined &&
    stateful.fullHistoryContents === undefined
  )
    throw new Error(
      'OpenAI Responses projection without observed parent usage requires a full-history request',
    );
  const base = await prompt(options, false);
  let incremental: ResponsesSourcePrompt | undefined;
  let fullHistory: ResponsesSourcePrompt | undefined;
  try {
    if (stateful?.statefulParentUsed !== true)
      return stateful === undefined
        ? base
        : Object.freeze({
            ...base,
            accounting: Object.freeze({ statefulParentUsed: false }),
          });
    incremental = await prompt(
      { ...options, contents: stateful.incrementalContents },
      stateful.retainedBaselineTokens !== undefined,
    );
    if (
      stateful.retainedBaselineTokens === undefined &&
      stateful.fullHistoryContents !== undefined
    )
      fullHistory = await prompt(
        {
          ...options,
          contents: stateful.fullHistoryContents,
          historyDangling: undefined,
        },
        false,
      );
    const ownedIncremental = incremental;
    const ownedFullHistory = fullHistory;
    return Object.freeze({
      ...base,
      accounting: Object.freeze({
        statefulParentUsed: true,
        retainedBaselineTokens: stateful.retainedBaselineTokens,
        incremental,
        fullHistory,
      }),
      dispose: (): Promise<void> =>
        disposePrompts([base, ownedIncremental, ownedFullHistory]),
    });
  } catch (error) {
    return withSerializationCleanup<ResponsesSourcePrompt>(
      () => Promise.reject(error),
      () => disposePrompts([base, incremental, fullHistory]),
    );
  }
}

async function disposePrompts(
  prompts: ReadonlyArray<ResponsesSourcePrompt | undefined>,
): Promise<void> {
  const settled = await Promise.allSettled(
    prompts.map((value) => value?.dispose()),
  );
  const failures = settled.flatMap<unknown>((outcome) =>
    outcome.status === 'rejected' ? [outcome.reason] : [],
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Prompt projection cleanup failed');
}
