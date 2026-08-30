/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_LINES = 1_000_000;
const MAX_WIDTH = 4_096;
const OUTPUT_CHUNK_CODE_UNITS = 64 * 1024;
const FIRST_PRINTABLE_ASCII = 0x21;
const PRINTABLE_ASCII_COUNT = 0x7e - FIRST_PRINTABLE_ASCII + 1;
const SEED_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const USAGE = `Usage: bun scripts/memory/output-generator.ts --seed <seed> --lines <count> --width <columns>

  --seed <seed>      1-64 ASCII letters, digits, underscores, or hyphens; first character must be alphanumeric
  --lines <count>    positive integer, at most ${MAX_LINES}
  --width <columns>  positive integer, at most ${MAX_WIDTH}`;

interface OutputOptions {
  readonly seed: string;
  readonly lineCount: number;
  readonly lineWidth: number;
}

class OutputParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutputParseError';
  }
}

function expectValue(
  argv: readonly string[],
  index: number,
  option: string,
): string {
  const value = argv[index + 1];
  if (value === undefined) {
    throw new OutputParseError(`missing value for ${option}`);
  }
  if (value.length === 0 || value.startsWith('-')) {
    throw new OutputParseError(`invalid value for ${option}: ${value}`);
  }
  return value;
}

function parsePositiveInteger(
  raw: string,
  option: string,
  maximum: number,
): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new OutputParseError(
      `invalid value for ${option}: ${raw} (expected a positive integer)`,
    );
  }
  if (value > maximum) {
    throw new OutputParseError(
      `invalid value for ${option}: ${raw} (must be <= ${maximum})`,
    );
  }
  return value;
}

function parseArgs(argv: readonly string[]): OutputOptions {
  let seed: string | undefined;
  let lineCount: number | undefined;
  let lineWidth: number | undefined;

  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    if (option === undefined) {
      throw new OutputParseError('missing option');
    }
    if (option !== '--seed' && option !== '--lines' && option !== '--width') {
      throw new OutputParseError(`unknown option: ${option}`);
    }
    const value = expectValue(argv, index, option);
    if (option === '--seed') {
      if (seed !== undefined) {
        throw new OutputParseError('--seed may only be specified once');
      }
      if (!SEED_PATTERN.test(value)) {
        throw new OutputParseError(`invalid value for --seed: ${value}`);
      }
      seed = value;
    } else if (option === '--lines') {
      if (lineCount !== undefined) {
        throw new OutputParseError('--lines may only be specified once');
      }
      lineCount = parsePositiveInteger(value, option, MAX_LINES);
    } else {
      if (lineWidth !== undefined) {
        throw new OutputParseError('--width may only be specified once');
      }
      lineWidth = parsePositiveInteger(value, option, MAX_WIDTH);
    }
  }

  if (seed === undefined) {
    throw new OutputParseError('missing required option --seed');
  }
  if (lineCount === undefined) {
    throw new OutputParseError('missing required option --lines');
  }
  if (lineWidth === undefined) {
    throw new OutputParseError('missing required option --width');
  }
  return { seed, lineCount, lineWidth };
}

function seedHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function createRandomUint32(seed: string): () => number {
  let state = seedHash(seed);
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
}

function generateLine(width: number, randomUint32: () => number): string {
  let line = '';
  for (let column = 0; column < width; column += 1) {
    const codePoint =
      FIRST_PRINTABLE_ASCII + (randomUint32() % PRINTABLE_ASCII_COUNT);
    line += String.fromCharCode(codePoint);
  }
  return line;
}

async function writeChunk(chunk: string): Promise<void> {
  if (!process.stdout.write(chunk)) {
    await once(process.stdout, 'drain');
  }
}

async function writeOutput(options: OutputOptions): Promise<void> {
  const randomUint32 = createRandomUint32(options.seed);
  let output = '';
  for (let line = 0; line < options.lineCount; line += 1) {
    output += `${generateLine(options.lineWidth, randomUint32)}\n`;
    if (output.length >= OUTPUT_CHUNK_CODE_UNITS) {
      await writeChunk(output);
      output = '';
    }
  }
  await writeChunk(`${output}LLXPRT3386_OUTPUT_DONE_${options.seed}\n`);
}

async function main(): Promise<void> {
  let options: OutputOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof OutputParseError) {
      process.stderr.write(`${error.message}\n\n${USAGE}\n`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
  await writeOutput(options);
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
