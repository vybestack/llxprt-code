/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createScratchDirSync } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import {
  Gpt56SourceProjection,
  type Gpt56SourceProjectionOptions,
  type Gpt56SourceSegment,
} from '../../../tokenizers/gpt56-source-projection.js';
import {
  writePromptSegment,
  type SegmentWriterOptions,
  type WrittenSegment,
} from '../../prompt-segment-writers.js';

type Protocol = Gpt56SourceProjectionOptions['protocol'];

/** Prompt-bearing request keys in the order the legacy projection reads them. */
const PROMPT_KEYS: Readonly<
  Record<Protocol, ReadonlyArray<Gpt56SourceSegment['promptKey']>>
> = {
  'openai-responses': ['instructions', 'input', 'tools'],
  'openai-chat': ['messages', 'tools'],
  'anthropic-messages': ['system', 'messages', 'tools'],
};

/**
 * Pricing provider the estimator-form writer records with each image. The
 * projection's image-cost source must name the same one so the reader's
 * consistency check holds; the count itself is re-priced for the request's
 * provider when it is read.
 */
const IMAGE_COST_PROVIDER = 'openai-responses';

function writeKey(
  options: SegmentWriterOptions,
  key: Gpt56SourceSegment['promptKey'],
  root: string,
  costs: string,
  value: unknown,
): Promise<WrittenSegment> {
  // A string value is a raw string segment, as the legacy projection treats it.
  const rawString = typeof value === 'string';
  return writePromptSegment(
    options,
    key,
    root,
    costs,
    rawString,
    (sink, writers) => {
      if (typeof value === 'string')
        for (const writer of writers) writer.string(value, false);
      else sink.value(value);
    },
  );
}

/**
 * Writes the prompt-bearing keys of a finished request body as estimator-form
 * segment files and returns the sealed projection that owns them. This is the
 * segment-file path the spooled chat and Anthropic sends will take; the body
 * here is only the test's way to supply the same content.
 */
export async function projectBodyFromSegments(
  protocol: Protocol,
  body: Readonly<Record<string, unknown>>,
  model: string,
): Promise<Gpt56SourceProjection> {
  const root = createScratchDirSync('prompt-body-segments-');
  try {
    const costs = join(root, 'image-costs.jsonl');
    writeFileSync(costs, '', { mode: 0o600 });
    const segments: Gpt56SourceSegment[] = [];
    for (const key of PROMPT_KEYS[protocol]) {
      const value = body[key];
      if (value === undefined) continue;
      const written = await writeKey({ model }, key, root, costs, value);
      segments.push(written.segment);
    }
    return new Gpt56SourceProjection({
      protocol,
      directory: root,
      segments,
      imageCosts: {
        source: { path: costs, encoding: 'utf8' },
        provider: IMAGE_COST_PROVIDER,
        model,
      },
    });
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
