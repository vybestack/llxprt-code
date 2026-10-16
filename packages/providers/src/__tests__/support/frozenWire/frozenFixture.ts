/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: storage of the frozen wire corpus.
 *
 * Each format is two files in `__tests__/fixtures/frozen-wire/`:
 *
 * - `<format>.json`: the metadata (format, description, pinnedClock, seeds)
 *   and the table of distinct settings the draws produced. Prettier formats it.
 * - `<format>.cases.tsv`: a header line, then one line per seed:
 *   `seed<TAB>settingsIndex<TAB>bodyBytes<TAB>sha256<TAB>historyMemberBytes`.
 *   Prettier does not touch `.tsv`, so the 5,000 lines stay compact.
 *
 * A history the builders reject is recorded with bodyBytes -1 and the error
 * message as a JSON string in the sha256 column. Bodies are not stored.
 * Regeneration is deliberate only:
 *
 *   FROZEN_WIRE_CORPUS_UPDATE=1 bun test src/__tests__/<format file>
 *
 * from `packages/providers` (refused when CI is set). The corpus is frozen
 * from the builders as they were before #854 replaces them; an implementer
 * never regenerates it.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FrozenSettings } from './frozenCases.js';
import { didThrow, type CaseOutcome } from './frozenSend.js';

export const FROZEN_WIRE_UPDATE_ENV = 'FROZEN_WIRE_CORPUS_UPDATE';

export type FixtureCase = readonly [
  seed: number,
  settings: number,
  length: number,
  sha256OrError: string,
  member: number,
];

export interface FrozenFixture {
  readonly format: string;
  readonly description: string;
  readonly pinnedClock: string;
  readonly seeds: number;
  readonly settings: readonly FrozenSettings[];
  readonly cases: readonly FixtureCase[];
}

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'frozen-wire',
);

export function isFrozenUpdateRequested(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (env[FROZEN_WIRE_UPDATE_ENV] !== '1') return false;
  if (env['CI'] !== undefined && env['CI'] !== '') {
    throw new Error(
      `${FROZEN_WIRE_UPDATE_ENV}=1 must not be used when CI is set: the frozen corpus is only regenerated deliberately by a person`,
    );
  }
  return true;
}

const REPO_ROOT = join(FIXTURE_DIR, '..', '..', '..', '..', '..', '..');

const CASES_HEADER = 'seed\tsettingsIndex\tbodyBytes\tsha256\tmember';

export function fixturePath(name: string): string {
  return join(FIXTURE_DIR, `${name}.json`);
}

export function casesPath(name: string): string {
  return join(FIXTURE_DIR, `${name}.cases.tsv`);
}

/** JSON with the line separators U+2028/U+2029 escaped. */
export function encodeJson(value: unknown, indent?: number): string {
  return JSON.stringify(value, null, indent)
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

/**
 * Rewrites regenerated JSON fixtures the way `npm run format` would, so a
 * regeneration never leaves a formatting diff for CI to reject.
 */
export function formatFixtureFiles(paths: readonly string[]): void {
  execFileSync('npx', ['prettier', '--write', ...paths], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
}

function parseCaseLine(line: string, path: string, row: number): FixtureCase {
  const columns = line.split('\t');
  if (columns.length !== 5) {
    throw new Error(`${path} line ${row}: expected 5 tab-separated columns`);
  }
  const [seed, settings, length, sha, member] = columns;
  const bodyBytes = Number(length);
  const outcome = bodyBytes < 0 ? JSON.parse(sha) : sha;
  return [Number(seed), Number(settings), bodyBytes, outcome, Number(member)];
}

export function readFrozenFixture(name: string): FrozenFixture {
  const path = fixturePath(name);
  const tsv = casesPath(name);
  for (const required of [path, tsv]) {
    if (!existsSync(required)) {
      throw new Error(
        `missing frozen wire fixture ${required}; regenerate deliberately with ${FROZEN_WIRE_UPDATE_ENV}=1`,
      );
    }
  }
  const meta: Omit<FrozenFixture, 'cases'> = JSON.parse(
    readFileSync(path, 'utf8'),
  );
  const [header, ...lines] = readFileSync(tsv, 'utf8').trimEnd().split('\n');
  if (header !== CASES_HEADER) {
    throw new Error(`${tsv}: unexpected header ${JSON.stringify(header)}`);
  }
  const cases = lines.map((line, index) => parseCaseLine(line, tsv, index + 2));
  return { ...meta, cases };
}

export function writeFrozenFixture(fixture: FrozenFixture): void {
  const path = fixturePath(fixture.format);
  mkdirSync(dirname(path), { recursive: true });
  const { cases, ...meta } = fixture;
  writeFileSync(path, `${encodeJson(meta, 2)}\n`);
  const lines = cases.map(([seed, settings, length, outcome, member]) =>
    [
      seed,
      settings,
      length,
      length < 0 ? JSON.stringify(outcome) : outcome,
      member,
    ].join('\t'),
  );
  writeFileSync(
    casesPath(fixture.format),
    `${CASES_HEADER}\n${lines.join('\n')}\n`,
  );
  formatFixtureFiles([path]);
}

/** Collects outcomes while regenerating, deduplicating the settings table. */
export class FixtureBuilder {
  private readonly settingsIndex = new Map<string, number>();
  private readonly settings: FrozenSettings[] = [];
  private readonly cases: FixtureCase[] = [];

  add(seed: number, settings: FrozenSettings, outcome: CaseOutcome): void {
    const key = JSON.stringify(settings);
    let index = this.settingsIndex.get(key);
    if (index === undefined) {
      index = this.settings.length;
      this.settingsIndex.set(key, index);
      this.settings.push(settings);
    }
    this.cases.push(fixtureCaseOf(seed, index, outcome));
  }

  build(
    meta: Pick<FrozenFixture, 'format' | 'description' | 'pinnedClock'>,
    seeds: number,
  ): FrozenFixture {
    const cases = [...this.cases].sort((a, b) => a[0] - b[0]);
    return { ...meta, seeds, settings: this.settings, cases };
  }
}

export function fixtureCaseOf(
  seed: number,
  settings: number,
  outcome: CaseOutcome,
): FixtureCase {
  if (didThrow(outcome)) return [seed, settings, -1, outcome.threw, 0];
  return [seed, settings, outcome.length, outcome.sha256, outcome.member];
}

/** Describes how an outcome differs from the frozen case, if it does. */
export function describeCaseDifference(
  expected: FixtureCase,
  actual: FixtureCase,
): string | undefined {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return undefined;
  const [seed, , length, sha] = expected;
  const [, , gotLength, gotSha, gotMember] = actual;
  return `seed ${seed}: expected ${length} bytes ${sha}, got ${gotLength} bytes ${gotSha} (history member ${gotMember}, expected ${expected[4]})`;
}
