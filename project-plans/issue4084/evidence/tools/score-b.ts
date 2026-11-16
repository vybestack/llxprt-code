/**
 * Issue #4084 Phase E: score a scenario B answer (final-answer.md) against the
 * ground truth ranking at e3c1782b96, for both readings of the prompt (test
 * files included or left out).
 *
 * Usage: bun project-plans/issue4084/evidence/tools/score-b.ts <answer.md> [--repo <dir>] [--ref <commit>]
 * The repository defaults to the checkout holding this file and the ref to
 * the scenario base, which needs the full history (not a shallow clone).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  computeLongestFunctions,
  SCENARIO_BASE,
  type FunctionLength,
} from '../../../../scripts/issue4084-ground-truth.ts';

const DIR = 'packages/agents/src/core';
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { repo: { type: 'string' }, ref: { type: 'string' } },
});
const REPO = values.repo ?? fileURLToPath(new URL('../../../../', import.meta.url));
const REF = values.ref ?? SCENARIO_BASE;
const answer = readFileSync(positionals[0], 'utf8').replaceAll('`', '').replaceAll('*', '');

interface Row {
  file: string;
  name: string | undefined;
  lines: number;
  raw: string;
}

const rows: Row[] = [];
for (const line of answer.split('\n')) {
  const file = /((?:packages\/agents\/src\/core\/|(?<![\w/])core\/)?[\w./-]+\.tsx?)(?::\d+(?:[–-]\d+)?)?/.exec(line);
  if (!file) continue;
  const rest = line.slice(0, file.index) + ' ' + line.slice(file.index + file[0].length);
  const before = line.slice(0, file.index);
  const numbers = [...rest.matchAll(/\b(\d+)\b/g)].map((m) => Number(m[1]));
  if (numbers.length === 0) continue;
  const names = [...line.matchAll(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)(?:\(\))?/g)].map((m) => m[1]);
  const path = file[1].startsWith('packages/') ? file[1] : file[1].startsWith('core/') ? `packages/agents/src/${file[1]}` : `${DIR}/${file[1]}`;
  rows.push({ file: path, name: names.find((n) => !file[1].includes(n) && !/^(lines?|L|packages)$/.test(n) && !before.includes(`${n}.`)), lines: Math.max(...numbers), raw: line.trim() });
}

function score(includeTests: boolean, namedOnly = false) {
  const ranked = computeLongestFunctions(REPO, DIR, { ref: REF, includeTests, namedOnly, limit: 100000 });
  const top = ranked.slice(0, 10);
  const cutoff = top[9].lines;
  const accepted = ranked.filter((f) => f.lines >= cutoff);
  const results = rows.slice(0, 10).map((row) => {
    const candidates = ranked.filter((f) => f.file === row.file);
    const named = candidates.filter((f) => row.name !== undefined && (f.name === row.name || row.name.endsWith(`.${f.name}`)));
    const match: FunctionLength | undefined = (named.length ? named : candidates).sort((a, b) => Math.abs(a.lines - row.lines) - Math.abs(b.lines - row.lines))[0];
    const inTop = match !== undefined && accepted.includes(match);
    return {
      row: row.raw.slice(0, 160),
      matched: match ? `${match.file.replace(`${DIR}/`, '')}:${match.name}:${match.lines}` : null,
      inTop10: inTop,
      lengthDelta: match ? row.lines - match.lines : null,
    };
  });
  return {
    includeTests,
    namedOnly,
    expectedTop10: top.map((f) => `${f.file.replace(`${DIR}/`, '')}:${f.name}:${f.lines}`),
    tiedAtCutoff: accepted.filter((f) => f.lines === cutoff).length,
    rowsFound: rows.length,
    inTop10: results.filter((r) => r.inTop10).length,
    inTop10ExactLength: results.filter((r) => r.inTop10 && r.lengthDelta === 0).length,
    results,
  };
}

console.log(JSON.stringify({ excludingTests: score(false), all: score(true), namedIncludingTests: score(true, true) }, null, 2));
