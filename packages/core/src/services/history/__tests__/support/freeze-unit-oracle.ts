/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { open } from 'node:fs/promises';
import { UNIT_CASE_COUNT, unitCase } from './normalization-cases.js';
import { oldUnits } from './normalization-oracle.js';

const file = new URL('../fixtures/normalization-units.jsonl', import.meta.url);
const output = await open(file, 'wx');
try {
  for (let seed = 0; seed < UNIT_CASE_COUNT; seed++) {
    await output.write(
      JSON.stringify({ seed, ...(await oldUnits(unitCase(seed))) }) + '\n',
    );
  }
} finally {
  await output.close();
}
