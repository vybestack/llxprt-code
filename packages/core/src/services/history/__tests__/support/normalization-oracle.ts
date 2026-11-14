/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { IContent } from '../../IContent.js';
import type { UnitCase } from './normalization-cases.js';

export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const frozenUnit = z.object({
  inputHash: z.string(),
  outputHash: z.string(),
  count: z.number().int(),
  pending: z.array(z.boolean()),
  firstOutputIndex: z.number().int().optional(),
});
const expectations = new Map(
  ['normalization-units.jsonl', 'normalization-custom-units.jsonl'].flatMap(
    (file) =>
      readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8')
        .trimEnd()
        .split('\n')
        .map((line) => {
          const value = frozenUnit.parse(JSON.parse(line));
          return [value.inputHash, value] satisfies [
            string,
            z.infer<typeof frozenUnit>,
          ];
        }),
  ),
);

export function frozenUnits(input: UnitCase): z.infer<typeof frozenUnit> {
  const expected = expectations.get(digest(input));
  if (expected === undefined)
    throw new Error(`Missing frozen normalization expectation: ${input.id}`);
  return expected;
}

export async function collectUnits(
  rows: AsyncIterable<IContent>,
): Promise<IContent[]> {
  const units: IContent[] = [];
  for await (const row of rows) units.push(row);
  return units;
}
