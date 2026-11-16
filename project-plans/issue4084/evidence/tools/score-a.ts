/**
 * Issue #4084 Phase E: score a scenario A answer (final-answer.md) against
 * the ground truth (field a of ground-truth.json).
 *
 * Every plan ID, package and short hash of the ground truth is located on
 * each line of the answer. Its count is the first number after it (up to the
 * next item on the line), or else the last number before it (tables written
 * "count | id"). A line that lists several items with no numbers and says
 * "each" or "one" gives each item 1 ("1 each: a, b, c"). Unknown plan-like
 * tokens are reported as extra. The parse is heuristic; every score in the
 * evidence README was also checked by reading the answer.
 *
 * Usage: bun project-plans/issue4084/evidence/tools/score-a.ts <answer.md> <ground-truth.json>
 */

import { readFileSync } from 'node:fs';

interface Truth {
  a: {
    total: number;
    byPlanId: Record<string, number>;
    byPackage: Record<string, number>;
    byCommit: Record<string, number>;
  };
}

interface Hit {
  readonly kind: 'plan' | 'package' | 'commit';
  readonly key: string;
  readonly start: number;
  readonly end: number;
}

const [answerFile, truthFile] = process.argv.slice(2);
const answer = readFileSync(answerFile, 'utf8')
  .replaceAll('`', '')
  .replaceAll('*', '');
const truth = (JSON.parse(readFileSync(truthFile, 'utf8')) as Truth).a;
const BASE = 'e3c1782b96d0a968f12a09401c04671cc29cacb9';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const planIds = Object.keys(truth.byPlanId).sort((a, b) => b.length - a.length);
const packageNames = Object.keys(truth.byPackage).map((p) =>
  p.replace('packages/', ''),
);
const fullHashes = Object.keys(truth.byCommit);

function overlaps(hits: Hit[], start: number, end: number): boolean {
  return hits.some((hit) => start < hit.end && end > hit.start);
}

function hitsOn(line: string): Hit[] {
  const hits: Hit[] = [];
  for (const id of planIds)
    for (const m of line.matchAll(
      new RegExp(`(^|[^\\w./-])(${escape(id)})(?=$|[^\\w/-]|\\.(?!\\w))`, 'g'),
    )) {
      const start = m.index + m[1].length;
      if (!overlaps(hits, start, start + id.length))
        hits.push({ kind: 'plan', key: id, start, end: start + id.length });
    }
  for (const m of line.matchAll(/\b(PLAN-[\w.\-/]+)/g))
    if (!overlaps(hits, m.index, m.index + m[1].length))
      hits.push({ kind: 'plan', key: m[1], start: m.index, end: m.index + m[1].length });
  if (!line.includes('.ts'))
    for (const m of line.matchAll(
      new RegExp(`(?:^|[\\s|(])((?:packages\\/)?(${packageNames.join('|')}))(?=$|[\\s|:),])`, 'g'),
    )) {
      const start = m.index + m[0].length - m[1].length;
      if (!overlaps(hits, start, start + m[1].length))
        hits.push({ kind: 'package', key: `packages/${m[2]}`, start, end: start + m[1].length });
    }
  for (const m of line.matchAll(/(?:^|[\s|^,(])\^?([0-9a-f]{7,40})\b/g)) {
    const short = m[1];
    if (BASE.startsWith(short)) continue;
    const full = fullHashes.filter((h) => h.startsWith(short));
    if (full.length === 0 && !/[a-f]/.test(short)) continue;
    const start = m.index + m[0].length - short.length;
    if (!overlaps(hits, start, start + short.length))
      hits.push({ kind: 'commit', key: full.length === 1 ? full[0] : `unknown:${short}`, start, end: start + short.length });
  }
  return hits.sort((a, b) => a.start - b.start);
}

function firstNumber(text: string): number | undefined {
  const m = /(?<![\w.-])(\d+)(?![\w-])/.exec(text);
  return m ? Number(m[1]) : undefined;
}

function lastNumber(text: string): number | undefined {
  const all = [...text.matchAll(/(?<![\w.-])(\d+)(?![\w-])/g)];
  return all.length ? Number(all[all.length - 1][1]) : undefined;
}

const found = {
  plan: new Map<string, number>(),
  package: new Map<string, number>(),
  commit: new Map<string, number>(),
};

for (const line of answer.split('\n')) {
  const hits = hitsOn(line);
  if (hits.length === 0) continue;
  const each = /(\d+)\s+each\b/.exec(line);
  const eachValue = each
    ? Number(each[1])
    : hits.length > 1 && /\b(each|one)\b/i.test(line)
      ? 1
      : undefined;
  hits.forEach((hit, index) => {
    const after = line.slice(hit.end, hits[index + 1]?.start ?? line.length);
    const before = line.slice(hits[index - 1]?.end ?? 0, hit.start);
    const value =
      firstNumber(after) ?? (eachValue === undefined ? lastNumber(before) : eachValue);
    const map = found[hit.kind];
    if (value !== undefined && !map.has(hit.key)) map.set(hit.key, value);
  });
}

function compare(expected: Record<string, number>, got: Map<string, number>) {
  const wrong: string[] = [];
  const missing: string[] = [];
  let exact = 0;
  for (const [key, count] of Object.entries(expected)) {
    const value = got.get(key);
    if (value === undefined) missing.push(`${key} (${count})`);
    else if (value === count) exact += 1;
    else wrong.push(`${key}: expected ${count}, got ${value}`);
  }
  const extra = [...got.keys()].filter((key) => !(key in expected));
  return { expected: Object.keys(expected).length, exact, wrong, missing, extra };
}

const totals = [...answer.matchAll(/total[^\d\n]{0,40}?(\d+)/gi)].map((m) =>
  Number(m[1]),
);
console.log(
  JSON.stringify(
    {
      totalExpected: truth.total,
      totalsMentioned: totals,
      totalCorrect: totals.includes(truth.total),
      planIds: compare(truth.byPlanId, found.plan),
      packages: compare(truth.byPackage, found.package),
      commits: compare(truth.byCommit, found.commit),
    },
    null,
    2,
  ),
);
