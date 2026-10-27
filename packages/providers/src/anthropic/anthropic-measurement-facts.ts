/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  estimatePieceFactSchema,
  encodeEstimatePieceFact,
  type EstimatePieceFact,
} from './anthropic-estimate-facts.js';
import { z } from 'zod';
import type { AnthropicAtom } from './anthropic-unit-facts.js';
import type {
  NativeFactIndexReader,
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
});
export interface AnthropicMeasurementFact {
  readonly kept: readonly AnthropicAtom[];
  readonly stripped?: readonly AnthropicAtom[];
  readonly estimates: readonly EstimatePieceFact[];
  readonly strippedEstimates?: readonly EstimatePieceFact[];
  readonly chain: boolean;
}
export async function writeAnthropicMeasurementFact(
  writer: NativeFactIndexWriter,
  key: number,
  fact: AnthropicMeasurementFact,
): Promise<void> {
  await writer.setBytes(
    ['measurement', key],
    new TextEncoder().encode(
      JSON.stringify({
        ...fact,
        estimates: fact.estimates.map(encodeEstimatePieceFact),
        strippedEstimates: fact.strippedEstimates?.map(encodeEstimatePieceFact),
      }),
    ),
  );
}
export async function readAnthropicMeasurementFact(
  reader: NativeFactIndexReader,
  key: number,
): Promise<AnthropicMeasurementFact> {
  const value = await reader.getBytes(['measurement', key]);
  if (value === undefined)
    throw new JournalFormatError('Missing Anthropic atom measurement');
  return measurement.parse(JSON.parse(new TextDecoder().decode(value)));
}
