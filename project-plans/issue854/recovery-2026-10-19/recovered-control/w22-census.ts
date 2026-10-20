/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { stripAnsi } from '../../../../scripts/lib/junit-report-writer.ts';
import {
  parseJUnitXml,
  type JUnitTestCase,
} from '../../../../scripts/bun-junit-to-json-report.ts';

export const attemptSchema = z
  .object({
    path: z.string(),
    pid: z.number().int(),
    driverPid: z.number().int().optional(),
    backend: z.string().optional(),
    sourceHash: z.string(),
    code: z.number().nullable(),
    signal: z.string().nullable().optional(),
    timedOut: z.boolean().optional(),
    pass: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    skip: z.number().int().nonnegative(),
    junit: z.string(),
    log: z.string(),
    started: z.string().optional(),
    ended: z.string().optional(),
  })
  .passthrough();
export type AttemptInput = z.infer<typeof attemptSchema>;
export interface Counts {
  pass: number;
  fail: number;
  skip: number;
}
export interface Provenance {
  batch: string;
  acceptedOrder: number | null;
  acceptanceReference: string | null;
  references: string[];
  backendProvenance: string;
}
export interface CensusCase extends JUnitTestCase {
  classification: string;
  classificationProvenance: string;
}
export interface Attempt extends AttemptInput, Provenance {
  id: string;
  accepted: boolean;
  state: 'green' | 'red' | 'unverified';
  evidenceStatus: string;
  issues: string[];
  missingXml: boolean;
  counts: Counts | null;
  rawSummary: Counts | null;
  countCorrection: 'terminal-summary-and-exact-case-records' | null;
  rawFailureLines: string[];
  cases: CensusCase[];
  sourceBoundary: {
    sourceHash: string;
    batch: string;
    acceptedOrder: number | null;
    acceptanceReference: string | null;
  };
  supersedes: string[];
  supersededBy?: string;
}

function sameCounts(a: Counts, b: Counts): boolean {
  return a.pass === b.pass && a.fail === b.fail && a.skip === b.skip;
}

function rawCounts(text: string | null): Counts | null {
  if (text === null) return null;
  const terminal =
    /(?:^|\n)((?:[ \t]*\d+ (?:pass|fail|skip|todo|errors?|expect\(\) calls)\r?\n)+)Ran (\d+) tests? across 1 file\.[^\r\n]*\s*$/.exec(
      stripAnsi(text),
    );
  if (!terminal) return null;
  const block = terminal[1] ?? '';
  const read = (label: string): number | null => {
    const matches = [
      ...block.matchAll(new RegExp(`^[ \\t]*(\\d+) ${label}\\r?$`, 'gm')),
    ];
    return matches.length === 1 ? Number(matches[0]?.[1]) : null;
  };
  const pass = read('pass');
  const fail = read('fail');
  if (pass === null || fail === null) return null;
  const counts = {
    pass,
    fail,
    skip: (read('skip') ?? 0) + (read('todo') ?? 0),
  };
  return counts.pass + counts.fail + counts.skip === Number(terminal[2])
    ? counts
    : null;
}

function exactSavedCases(
  input: AttemptInput,
  cases: readonly CensusCase[],
  rawLog: string | null,
): boolean {
  const saved = z
    .array(
      z.object({
        classname: z.string(),
        name: z.string(),
        status: z.string(),
      }),
    )
    .safeParse(input.cases);
  if (!saved.success || saved.data.length !== cases.length || rawLog === null)
    return false;
  const key = (test: {
    classname: string;
    name: string;
    status: string;
  }): string => JSON.stringify([test.classname, test.name, test.status]);
  const keys = new Set(saved.data.map(key));
  const lines = stripAnsi(rawLog).split('\n');
  return (
    keys.size === cases.length &&
    cases.every(
      (test) =>
        test.status === 'passed' &&
        keys.has(key(test)) &&
        lines.some((line) =>
          line.startsWith(
            `(pass) ${test.classname ? `${test.classname} > ` : ''}${test.name} [`,
          ),
        ),
    )
  );
}

export function inspectEvidence(
  input: AttemptInput,
  provenance: Provenance,
  xml: string | null,
  rawLog: string | null,
): Attempt {
  const issues: string[] = [];
  const summary = rawCounts(rawLog);
  let cases: CensusCase[] = [];
  let counts: Counts | null = null;
  let validJUnit = false;
  if (xml === null) issues.push('missing-junit');
  else if (
    XMLValidator.validate(xml) !== true ||
    !/<testsuites\b[^>]*\btests="\d+"/.test(xml)
  )
    issues.push('invalid-or-incomplete-junit');
  else {
    const parsed = parseJUnitXml(xml);
    cases = parsed.suites
      .flatMap((suite) => suite.testCases)
      .map((test) => ({
        ...test,
        classification: 'classification-pending',
        classificationProvenance: 'no-exact-case-contract',
      }));
    counts = {
      pass: cases.filter((test) => test.status === 'passed').length,
      fail: cases.filter((test) => test.status === 'failed').length,
      skip: cases.filter(
        (test) => test.status === 'skipped' || test.status === 'todo',
      ).length,
    };
    if (
      parsed.tests !== cases.length ||
      parsed.failures + parsed.errors !== counts.fail
    )
      issues.push('junit-root-count-mismatch');
    const skipped = /<testsuites\b[^>]*\bskipped="(\d+)"/.exec(xml);
    if (skipped && Number(skipped[1]) !== counts.skip)
      issues.push('junit-root-skip-mismatch');
    validJUnit = issues.length === 0;
  }
  const countCorrection =
    validJUnit &&
    counts &&
    summary &&
    !sameCounts(counts, input) &&
    sameCounts(summary, counts) &&
    input.code === 0 &&
    !input.signal &&
    !input.timedOut &&
    exactSavedCases(input, cases, rawLog)
      ? 'terminal-summary-and-exact-case-records'
      : null;
  if (counts && !sameCounts(counts, input) && countCorrection === null)
    issues.push('result-count-mismatch');
  if (summary && !sameCounts(summary, input) && countCorrection === null)
    issues.push('raw-result-count-mismatch');
  if (summary && counts && !sameCounts(summary, counts))
    issues.push('raw-junit-count-mismatch');
  if (summary === null) issues.push('missing-complete-raw-summary');
  if (!counts && summary && sameCounts(summary, input)) counts = summary;
  const accepted =
    provenance.acceptedOrder !== null && input.backend === 'journal';
  const consistent = validJUnit && issues.length === 0;
  const green =
    consistent &&
    input.code === 0 &&
    !input.signal &&
    !input.timedOut &&
    counts !== null &&
    counts.pass > 0 &&
    counts.fail === 0 &&
    counts.skip === 0;
  const state = green
    ? 'green'
    : consistent && cases.length > 0
      ? 'red'
      : 'unverified';
  return {
    ...input,
    ...provenance,
    id: JSON.stringify([input.path, input.pid, input.junit]),
    accepted,
    state,
    evidenceStatus:
      xml === null
        ? 'missing-record-unverified'
        : state === 'unverified'
          ? 'inconsistent-record-unverified'
          : green
            ? 'verified'
            : 'verified-red',
    missingXml: xml === null,
    issues,
    counts,
    rawSummary: summary,
    countCorrection,
    rawFailureLines:
      rawLog
        ?.split('\n')
        .filter((line) =>
          /\(fail\)|timed out|Unhandled error|ENOSPC|Cannot find module|ERR_PACKAGE_PATH_NOT_EXPORTED/.test(
            line,
          ),
        ) ?? [],
    cases,
    sourceBoundary: {
      sourceHash: input.sourceHash,
      batch: provenance.batch,
      acceptedOrder: provenance.acceptedOrder,
      acceptanceReference: provenance.acceptanceReference,
    },
    supersedes: [],
  };
}

export function reconcile(
  inventory: readonly string[],
  input: readonly Attempt[],
): {
  partition: { green: number; red: number; unverified: number; unrun: number };
  rows: Attempt[];
  attempts: Attempt[];
  pending: string[];
  historicalMissingAttempts: Attempt[];
  latestMissingFiles: Attempt[];
  classifications: Record<string, number>;
} {
  if (new Set(inventory).size !== inventory.length)
    throw new Error('Duplicate inventory paths');
  const byId = new Map<string, Attempt>();
  for (const row of input) {
    const prior = byId.get(row.id);
    const chosen =
      prior && (prior.acceptedOrder ?? -1) > (row.acceptedOrder ?? -1)
        ? prior
        : row;
    byId.set(row.id, {
      ...chosen,
      references: [
        ...new Set([...(prior?.references ?? []), ...row.references]),
      ],
    });
  }
  const grouped = new Map<string, Attempt[]>();
  for (const row of byId.values()) {
    if (row.accepted)
      grouped.set(row.path, [...(grouped.get(row.path) ?? []), row]);
  }
  const rows = inventory.flatMap((path) => {
    const accepted = (grouped.get(path) ?? []).sort(
      (a, b) =>
        (a.acceptedOrder ?? -1) - (b.acceptedOrder ?? -1) ||
        (a.started ?? '').localeCompare(b.started ?? '') ||
        a.id.localeCompare(b.id),
    );
    const selected = accepted.at(-1);
    return selected
      ? [
          {
            ...selected,
            supersedes: accepted.slice(0, -1).map((row) => row.id),
          },
        ]
      : [];
  });
  const selectedIds = new Set(rows.map((row) => row.id));
  const selectedByPath = new Map(rows.map((row) => [row.path, row]));
  const attempts = [...byId.values()].map((row) => ({
    ...row,
    ...(selectedByPath.get(row.path)?.id !== row.id &&
    selectedByPath.has(row.path)
      ? { supersededBy: selectedByPath.get(row.path)?.id }
      : {}),
  }));
  const pending = inventory.filter((path) => !selectedByPath.has(path));
  const classifications: Record<string, number> = {
    'native-history': 0,
    'journal-selected-shared-public': 0,
    'explicit-old': 0,
    'classification-pending': 0,
    unclassified: 0,
  };
  for (const row of rows.filter(
    (row) =>
      row.evidenceStatus === 'verified' ||
      row.evidenceStatus === 'verified-red',
  )) {
    for (const test of row.cases.filter((test) => test.status === 'passed'))
      classifications[test.classification || 'unclassified'] =
        (classifications[test.classification || 'unclassified'] ?? 0) + 1;
  }
  return {
    partition: {
      green: rows.filter((row) => row.state === 'green').length,
      red: rows.filter((row) => row.state === 'red').length,
      unverified: rows.filter((row) => row.state === 'unverified').length,
      unrun: pending.length,
    },
    rows,
    attempts,
    pending,
    classifications,
    historicalMissingAttempts: attempts.filter(
      (row) => row.missingXml && !selectedIds.has(row.id),
    ),
    latestMissingFiles: rows.filter((row) => row.missingXml),
  };
}
