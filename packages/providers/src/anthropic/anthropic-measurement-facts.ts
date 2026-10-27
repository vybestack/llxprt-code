/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  estimatePieceFactSchema,
  encodeEstimatePieceFact,
  type EstimatePieceFact,
} from './anthropic-estimate-facts.js';
import { z } from 'zod';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { AnthropicAtom } from './anthropic-unit-facts.js';
import {
  type NativeFactIndexReader,
  NativeFactIndexWriter,
} from '@vybestack/llxprt-code-core/journal/nativeFactIndex.js';
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';

const block = z.object({
  kind: z.enum([
    'text',
    'tool_use',
    'tool_result',
    'image',
    'document',
    'thinking',
    'redacted_thinking',
  ]),
  bytes: z.number().int().nonnegative(),
  blank: z.boolean(),
  anchored: z.boolean(),
  purge: z.boolean().optional(),
  cacheable: z.boolean().optional(),
});
const role = z.enum(['user', 'assistant']);
const atom = z.discriminatedUnion('form', [
  z.object({
    role,
    form: z.literal('string'),
    bytes: z.number().int().nonnegative(),
    blank: z.boolean(),
    anchored: z.boolean(),
    purge: z.boolean().optional(),
  }),
  z.object({ role, form: z.literal('array'), blocks: z.array(block) }),
]);
const measurement = z.object({
  kept: z.array(atom),
  stripped: z.array(atom).optional(),
  estimates: z.array(estimatePieceFactSchema),
  strippedEstimates: z.array(estimatePieceFactSchema).optional(),
  chain: z.boolean(),
  anchored: z.boolean(),
  purge: z.boolean(),
});
export interface AnthropicMeasurementFact {
  readonly kept: readonly AnthropicAtom[];
  readonly stripped?: readonly AnthropicAtom[];
  readonly estimates: readonly EstimatePieceFact[];
  readonly strippedEstimates?: readonly EstimatePieceFact[];
  readonly chain: boolean;
  readonly anchored: boolean;
  readonly purge: boolean;
}
const KEYS_PER_PAGE = 128;
const pageSchema = z.record(z.string(), z.string());
interface MeasurementPage {
  readonly ordinal: number;
  readonly values: Record<string, string | undefined>;
  dirty: boolean;
}
// A page contains only numeric/protocol facts for 32 source rows, never payloads.
const pages = new WeakMap<NativeFactIndexReader, MeasurementPage>();

async function savePage(
  writer: NativeFactIndexWriter,
  page: MeasurementPage,
): Promise<void> {
  if (!page.dirty) return;
  await writer.setBytes(
    ['measurement-page', page.ordinal],
    deflateRawSync(JSON.stringify(page.values), { level: 1 }),
  );
  page.dirty = false;
}

async function pageAt(
  reader: NativeFactIndexReader,
  key: number,
): Promise<MeasurementPage> {
  const ordinal = Math.floor(key / KEYS_PER_PAGE);
  const current = pages.get(reader);
  if (current?.ordinal === ordinal) return current;
  if (current?.dirty === true) {
    if (!(reader instanceof NativeFactIndexWriter))
      throw new JournalFormatError('Dirty Anthropic measurement reader');
    await savePage(reader, current);
  }
  const bytes = await reader.getBytes(['measurement-page', ordinal]);
  const values =
    bytes === undefined
      ? {}
      : pageSchema.parse(JSON.parse(inflateRawSync(bytes).toString('utf8')));
  const page = { ordinal, values, dirty: false };
  pages.set(reader, page);
  return page;
}

export async function writeAnthropicMeasurementFact(
  writer: NativeFactIndexWriter,
  key: number,
  fact: AnthropicMeasurementFact,
): Promise<void> {
  const page = await pageAt(writer, key);
  page.values[key % KEYS_PER_PAGE] = JSON.stringify({
    ...fact,
    estimates: fact.estimates.map(encodeEstimatePieceFact),
    strippedEstimates: fact.strippedEstimates?.map(encodeEstimatePieceFact),
  });
  page.dirty = true;
}

export async function flushAnthropicMeasurementFacts(
  writer: NativeFactIndexWriter,
): Promise<void> {
  const page = pages.get(writer);
  if (page !== undefined) await savePage(writer, page);
}

export async function readAnthropicMeasurementFact(
  reader: NativeFactIndexReader,
  key: number,
): Promise<AnthropicMeasurementFact> {
  const page = await pageAt(reader, key);
  const value = page.values[key % KEYS_PER_PAGE];
  if (value === undefined)
    throw new JournalFormatError('Missing Anthropic atom measurement');
  return measurement.parse(JSON.parse(value));
}
