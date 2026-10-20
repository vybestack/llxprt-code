/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  attemptSchema,
  inspectEvidence,
  reconcile,
  type AttemptInput,
} from './w22-census.ts';
import { runCensus } from './w22-census-runner.ts';

const base: AttemptInput = {
  path: 'a.test.ts',
  pid: 1,
  backend: 'journal',
  sourceHash: 'original',
  code: 0,
  signal: null,
  timedOut: false,
  pass: 1,
  fail: 0,
  skip: 0,
  junit: '/evidence/a.xml',
  log: '/evidence/a.log',
};
const xml = (status = 'passed', name = 'works'): string =>
  `<testsuites tests="1" failures="${status === 'failed' ? 1 : 0}" skipped="${status === 'skipped' ? 1 : 0}"><testsuite name="suite" tests="1" failures="${status === 'failed' ? 1 : 0}" skipped="${status === 'skipped' ? 1 : 0}"><testcase classname="suite" name="${name}">${status === 'passed' ? '' : status === 'failed' ? '<failure message="broken">details</failure>' : '<skipped/>'}</testcase></testsuite></testsuites>`;
const log = (pass = 1, fail = 0, skip = 0): string =>
  `(pass) suite > works [1ms]\n\n ${pass} pass\n ${fail} fail\n ${skip} skip\nRan ${pass + fail + skip} tests across 1 file. [1ms]\n`;

function attempt(
  overrides: Partial<AttemptInput> = {},
  acceptedOrder: number | null = 0,
  text: string | null = xml(),
): ReturnType<typeof inspectEvidence> {
  return inspectEvidence(
    { ...base, ...overrides },
    {
      batch: `batch-${acceptedOrder}`,
      acceptedOrder,
      references: ['/evidence/results.json'],
      acceptanceReference: 'progress.ts',
      backendProvenance: 'result.backend',
    },
    text,
    log(overrides.pass ?? 1, overrides.fail ?? 0, overrides.skip ?? 0),
  );
}

describe('W22 evidence census', () => {
  it('requires nonempty, complete JUnit and matching result and raw summary for green', () => {
    expect(attempt().state).toBe('green');
    for (const row of [
      attempt(
        { pass: 0 },
        0,
        '<testsuites tests="0" failures="0"></testsuites>',
      ),
      attempt({}, 0, xml().replace('</testsuites>', '')),
      attempt({ pass: 2 }),
      attempt({ code: null, timedOut: true }),
      attempt({ signal: 'SIGTERM' }),
      attempt({ pass: 0, skip: 1 }, 0, xml('skipped')),
      inspectEvidence(
        base,
        {
          batch: 'b',
          acceptedOrder: 0,
          references: ['r'],
          acceptanceReference: 'p',
          backendProvenance: 'result.backend',
        },
        xml(),
        log(2),
      ),
    ])
      expect(row.state).not.toBe('green');
    expect(attempt({ pass: 0, fail: 1, code: 1 }, 0, xml('failed')).state).toBe(
      'red',
    );
    const empty = attempt(
      { pass: 0 },
      0,
      '<testsuites tests="0" failures="0"></testsuites>',
    );
    expect(empty.evidenceStatus).toBe('inconsistent-record-unverified');
  });

  it('preserves missing records and raw termination without turning default zeroes into measured counts', () => {
    const missing = inspectEvidence(
      { ...base, pass: 0, code: null, timedOut: true, signal: 'SIGTERM' },
      {
        batch: 'old',
        acceptedOrder: 0,
        references: ['original/results.json'],
        acceptanceReference: 'p',
        backendProvenance: 'result.backend',
      },
      null,
      '(fail) suite > works [180000ms]\n this test timed out after 180000ms.',
    );
    expect(missing.evidenceStatus).toBe('missing-record-unverified');
    expect(missing.counts).toBeNull();
    expect(missing.rawSummary).toBeNull();
    expect(missing.rawFailureLines).toHaveLength(2);
    expect(missing.signal).toBe('SIGTERM');
    expect(missing.references).toContain('original/results.json');
  });

  it('counts nested Bun suites once while validating the root aggregate', () => {
    const nested = xml()
      .replace(
        '<testsuite name="suite"',
        '<testsuite name="file" tests="1" failures="0" skipped="0"><testsuite name="suite"',
      )
      .replace('</testsuites>', '</testsuite></testsuites>');
    expect(attempt({}, 0, nested).state).toBe('green');
    expect(attempt({}, 0, nested).counts?.pass).toBe(1);
    expect(attempt({}, 0, nested.replace('tests="1"', 'tests="2"')).state).toBe(
      'unverified',
    );
  });

  it('keeps a later accepted missing attempt current rather than falling back to an earlier green', () => {
    const first = attempt();
    const latest = attempt(
      {
        pid: 2,
        junit: 'missing.xml',
        sourceHash: 'new',
        pass: 0,
        code: null,
        timedOut: true,
      },
      1,
      null,
    );
    const census = reconcile(['a.test.ts', 'b.test.ts'], [first, latest]);
    expect(census.partition).toEqual({
      green: 0,
      red: 0,
      unverified: 1,
      unrun: 1,
    });
    expect(census.rows[0]?.pid).toBe(2);
    expect(census.latestMissingFiles).toHaveLength(1);
    expect(census.historicalMissingAttempts).toHaveLength(0);
  });

  it('deduplicates references without losing distinct PIDs and excludes controls and outer-old from selection', () => {
    const missing = attempt(
      { pid: 2, junit: 'missing.xml', pass: 0, code: null, timedOut: true },
      0,
      null,
    );
    const repaired = attempt({ pid: 3, sourceHash: 'repaired' }, 1);
    const duplicate = {
      ...missing,
      references: ['stopped-after-failure.json'],
    };
    const census = reconcile(
      ['a.test.ts', 'b.test.ts', 'c.test.ts'],
      [
        missing,
        duplicate,
        repaired,
        attempt({ path: 'b.test.ts' }, null),
        attempt({ path: 'c.test.ts', backend: 'old' }, 2),
      ],
    );
    expect(census.partition).toEqual({
      green: 1,
      red: 0,
      unverified: 0,
      unrun: 2,
    });
    expect(census.attempts).toHaveLength(4);
    expect(census.historicalMissingAttempts[0]?.references).toHaveLength(2);
    expect(census.rows[0]?.supersedes).toHaveLength(1);
    expect(census.rows[0]?.sourceHash).toBe('repaired');
    expect(census.pending).toEqual(['b.test.ts', 'c.test.ts']);
  });

  it('keeps raw-log counts for a complete loader failure but never makes missing JUnit green', () => {
    const row = inspectEvidence(
      { ...base, code: 1, pass: 0, fail: 1 },
      {
        batch: 'loader',
        acceptedOrder: 0,
        references: ['r'],
        acceptanceReference: 'p',
        backendProvenance: 'result.backend',
      },
      null,
      '0 pass\n1 fail\n1 error\nRan 1 test across 1 file. [1ms]',
    );
    expect(row.counts).toEqual({ pass: 0, fail: 1, skip: 0 });
    expect(row.evidenceStatus).toBe('missing-record-unverified');
    expect(row.state).toBe('unverified');
  });
});

describe('W22 shared runner', () => {
  it('discovers historical batches, validates XML, classifies exact cases, and atomically publishes both entrypoint outputs', () => {
    const root = mkdtempSync(
      resolve('tmp/854-notes/p4/w22/continuation-run-c/runner-fixture-'),
    );
    const w22 = join(root, 'tmp/854-notes/p4/w22');
    const run = join(w22, 'run-20261019-a');
    mkdirSync(run, { recursive: true });
    writeFileSync(
      join(run, 'inventory.json'),
      JSON.stringify(
        ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'].map((path) => ({
          path,
        })),
      ),
    );
    function batch(name: string, row: AttemptInput, text: string | null): void {
      const dir = join(run, name);
      mkdirSync(dir, { recursive: true });
      const result = {
        ...row,
        junit: join(dir, 'case.xml'),
        log: join(dir, 'case.log'),
      };
      writeFileSync(join(dir, 'results.json'), JSON.stringify([result]));
      writeFileSync(result.log, log(row.pass, row.fail, row.skip));
      if (text !== null) writeFileSync(result.junit, text);
    }
    batch(
      'package-auto-0000',
      { ...base, pid: 10, code: null, timedOut: true, pass: 0 },
      null,
    );
    batch(
      'finalizer-run-final-journal-a',
      { ...base, pid: 20, sourceHash: 'new' },
      xml(),
    );
    batch(
      'unaccepted-diagnostic-journal',
      { ...base, pid: 30, path: 'b.test.ts' },
      xml(),
    );
    batch(
      'instance-run-final-old-a',
      { ...base, pid: 40, path: 'c.test.ts', backend: 'old' },
      xml(),
    );
    batch(
      'package-resume-g-0000',
      { ...base, pid: 50, path: 'd.test.ts', pass: 2 },
      xml(),
    );
    const known = join(w22, 'instance-run-20261019-a');
    mkdirSync(known, { recursive: true });
    const repairedRows = attemptSchema
      .array()
      .parse(
        JSON.parse(
          readFileSync(
            join(run, 'finalizer-run-final-journal-a/results.json'),
            'utf8',
          ),
        ),
      );
    writeFileSync(
      join(known, 'census-before.json'),
      JSON.stringify({
        rows: [
          {
            ...repairedRows[0],
            cases: [
              {
                classname: 'suite',
                name: 'other',
                classification: 'native-history',
              },
              {
                classname: 'suite',
                name: 'works',
                classification: 'journal-selected-shared-public',
              },
            ],
          },
        ],
      }),
    );
    const result = runCensus(root);
    expect(result.inventory).toBe(4);
    expect(result.partition).toEqual({
      green: 1,
      red: 0,
      unverified: 1,
      unrun: 2,
    });
    expect(result.classifications['native-history']).toBe(0);
    expect(result.classifications['journal-selected-shared-public']).toBe(1);
    expect(result.historicalMissingAttempts).toHaveLength(1);
    expect(result.attempts).toHaveLength(5);
    expect(result.rows[0]?.cases[0]?.classificationProvenance).toContain(
      'census-before.json',
    );
    const published = z
      .object({ partition: z.unknown() })
      .parse(
        JSON.parse(readFileSync(join(run, 'current-progress.json'), 'utf8')),
      );
    expect(published.partition).toEqual(result.partition);
    expect(readFileSync(join(run, 'current-not-run.txt'), 'utf8')).toBe(
      'b.test.ts\nc.test.ts\n',
    );
    expect(readFileSync(join(run, 'current-files-table.md'), 'utf8')).toContain(
      'unverified',
    );
    expect(
      JSON.parse(readFileSync(join(known, 'failure-table.json'), 'utf8')),
    ).toHaveLength(1);
    expect(
      z
        .object({ attempts: z.array(z.unknown()) })
        .parse(
          JSON.parse(
            readFileSync(
              join(w22, 'continuation-run-c/all-attempts.json'),
              'utf8',
            ),
          ),
        ).attempts,
    ).toHaveLength(5);
    expect(
      z
        .object({ generation: z.string() })
        .parse(
          JSON.parse(
            readFileSync(
              join(w22, 'continuation-run-c/publication.json'),
              'utf8',
            ),
          ),
        ).generation,
    ).toBe(result.generation);
    const instance =
      'packages/agents/src/api/__tests__/recording-instance-resume.behavior.test.ts';
    const shell =
      'packages/agents/src/api/__tests__/shell-owner-exit.behavior.test.ts';
    writeFileSync(
      join(run, 'inventory.json'),
      JSON.stringify(
        [
          'a.test.ts',
          'b.test.ts',
          'c.test.ts',
          'd.test.ts',
          instance,
          shell,
        ].map((path) => ({ path })),
      ),
    );
    batch(
      'instance-run-final-journal-a',
      { ...base, pid: 60, path: instance, pass: 2 },
      '<testsuites tests="2" failures="0" skipped="0"><testsuite name="instance" tests="2" failures="0" skipped="0"><testcase classname="original instance" name="adopts"/><testcase classname="native instance" name="adopts"/></testsuite></testsuites>',
    );
    batch(
      'instance-nodefix-final-journal-a',
      { ...base, pid: 70, path: shell },
      xml(),
    );
    const overrides = runCensus(root);
    expect(overrides.partition).toEqual({
      green: 3,
      red: 0,
      unverified: 1,
      unrun: 2,
    });
    expect(overrides.classifications['native-history']).toBe(1);
    expect(overrides.classifications['explicit-old']).toBe(1);
    expect(overrides.classifications['journal-selected-shared-public']).toBe(2);
    expect(
      overrides.rows
        .find((row) => row.path === instance)
        ?.cases.every((test) =>
          test.classificationProvenance.endsWith('progress-g.ts.before-census'),
        ),
    ).toBe(true);
    batch(
      'pending-final-journal-g-a',
      { ...base, pid: 80, sourceHash: 'pending-final' },
      xml(),
    );
    batch(
      'pending-retaining-control-g-a',
      { ...base, pid: 90, code: 1, pass: 0, fail: 1 },
      xml('failed'),
    );
    const pending = join(w22, 'pending-window-run-g');
    mkdirSync(pending, { recursive: true });
    writeFileSync(
      join(pending, 'classification.json'),
      JSON.stringify({
        rows: [
          {
            path: base.path,
            cases: [
              {
                classname: 'suite',
                name: 'works',
                classification: 'native-history',
              },
            ],
          },
        ],
      }),
    );
    const completed = runCensus(root);
    expect(completed.rows.find((row) => row.path === base.path)?.pid).toBe(80);
    expect(
      completed.rows.find((row) => row.path === base.path)?.sourceHash,
    ).toBe('pending-final');
    expect(
      completed.rows.find((row) => row.path === base.path)?.supersedes,
    ).toHaveLength(2);
    expect(completed.classifications['native-history']).toBe(2);
    expect(completed.historicalMissingAttempts).toHaveLength(1);
    expect(completed.attempts).toHaveLength(overrides.attempts.length + 2);
    expect(completed.attempts.find((row) => row.pid === 90)?.accepted).toBe(
      false,
    );
    batch(
      'provider-final-journal-h-a',
      { ...base, pid: 100, sourceHash: 'provider-final' },
      xml('passed', 'provider works'),
    );
    batch(
      'provider-final-old-h-a',
      { ...base, pid: 110, backend: 'old' },
      xml(),
    );
    batch(
      'provider-retaining-control-h-a',
      { ...base, pid: 120, code: 1, pass: 0, fail: 1 },
      xml('failed'),
    );
    const provider = join(w22, 'provider-fallback-run-h');
    mkdirSync(provider, { recursive: true });
    writeFileSync(
      join(provider, 'classification.json'),
      JSON.stringify({
        rows: [
          {
            path: base.path,
            cases: [
              {
                classname: 'suite',
                name: 'provider works',
                classification: 'native-history',
              },
            ],
          },
        ],
      }),
    );
    const acceptedProvider = runCensus(root);
    const selectedProvider = acceptedProvider.rows.find(
      (row) => row.path === base.path,
    );
    expect(selectedProvider?.pid).toBe(100);
    expect(selectedProvider?.sourceHash).toBe('provider-final');
    expect(selectedProvider?.supersedes).toHaveLength(3);
    expect(selectedProvider?.cases[0]?.classification).toBe('native-history');
    expect(selectedProvider?.cases[0]?.classificationProvenance).toContain(
      'provider-fallback-run-h/classification.json',
    );
    expect(acceptedProvider.historicalMissingAttempts).toHaveLength(1);
    expect(acceptedProvider.attempts).toHaveLength(
      completed.attempts.length + 3,
    );
    for (const pid of [110, 120])
      expect(
        acceptedProvider.attempts.find((row) => row.pid === pid)?.accepted,
      ).toBe(false);
    batch(
      'attempt-final-journal-i-a',
      { ...base, pid: 130, sourceHash: 'attempt-final' },
      xml('passed', 'attempt works'),
    );
    batch(
      'attempt-final-old-i-a',
      { ...base, pid: 140, backend: 'old', sourceHash: 'attempt-final' },
      xml('passed', 'attempt works'),
    );
    batch(
      'attempt-unknown-i-a',
      { ...base, pid: 160, backend: 'unknown', sourceHash: 'attempt-final' },
      xml('passed', 'attempt works'),
    );
    batch(
      'attempt-initial-journal-i-a',
      { ...base, pid: 170, sourceHash: 'attempt-before' },
      xml('passed', 'attempt works'),
    );
    batch(
      'attempt-retaining-control-i-a',
      { ...base, pid: 150, code: 1, pass: 0, fail: 1 },
      xml('failed'),
    );
    const attempt = join(w22, 'attempt-value-run-i');
    mkdirSync(attempt, { recursive: true });
    writeFileSync(
      join(attempt, 'classification.json'),
      JSON.stringify({
        rows: [
          {
            path: base.path,
            sourceHash: 'attempt-final',
            cases: [
              {
                classname: 'suite',
                name: 'attempt works',
                classification: 'native-history',
              },
            ],
          },
        ],
      }),
    );
    const acceptedAttempt = runCensus(root);
    const selectedAttempt = acceptedAttempt.rows.find(
      (row) => row.path === base.path,
    );
    expect(selectedAttempt?.pid).toBe(130);
    expect(selectedAttempt?.sourceHash).toBe('attempt-final');
    expect(selectedAttempt?.supersedes).toHaveLength(4);
    expect(selectedAttempt?.cases[0]?.classification).toBe('native-history');
    expect(selectedAttempt?.cases[0]?.classificationProvenance).toContain(
      'attempt-value-run-i/classification.json',
    );
    expect(acceptedAttempt.attempts).toHaveLength(
      acceptedProvider.attempts.length + 5,
    );
    for (const pid of [140, 150, 160, 170])
      expect(
        acceptedAttempt.attempts.find((row) => row.pid === pid)?.accepted,
      ).toBe(false);
    for (const pid of [140, 160, 170])
      expect(
        acceptedAttempt.attempts.find((row) => row.pid === pid)?.cases[0]
          ?.classification,
      ).toBe('classification-pending');
    writeFileSync(
      join(attempt, 'classification.json'),
      JSON.stringify({
        rows: [
          {
            path: base.path,
            sourceHash: 'unmatched-source',
            cases: [
              {
                classname: 'suite',
                name: 'attempt works',
                classification: 'native-history',
              },
            ],
          },
        ],
      }),
    );
    expect(
      runCensus(root).rows.find((row) => row.pid === 130)?.cases[0]
        ?.classification,
    ).toBe('classification-pending');
    for (const [batchName, pid, backend] of [
      ['density-final-journal-j-a', 180, 'journal'],
      ['density-final-old-j-a', 190, 'old'],
      ['density-initial-journal-j-a', 200, 'journal'],
      ['density-unknown-j-a', 210, 'unknown'],
    ] as const)
      batch(
        batchName,
        { ...base, pid, backend, sourceHash: 'density-final' },
        xml('passed', 'density works'),
      );
    batch(
      'density-retaining-control-j-b',
      { ...base, pid: 220, code: 1, pass: 0, fail: 1 },
      xml('failed'),
    );
    const density = join(w22, 'density-run-j');
    mkdirSync(density, { recursive: true });
    const densityContract = (sourceHash: string): void =>
      writeFileSync(
        join(density, 'classification.json'),
        JSON.stringify({
          rows: [
            {
              path: base.path,
              sourceHash,
              cases: [
                {
                  classname: 'suite',
                  name: 'density works',
                  classification: 'native-history',
                },
              ],
            },
          ],
        }),
      );
    densityContract('density-final');
    const acceptedDensity = runCensus(root);
    expect(
      acceptedDensity.rows.find((row) => row.path === base.path)?.pid,
    ).toBe(180);
    expect(
      acceptedDensity.rows.find((row) => row.pid === 180)?.cases[0]
        ?.classification,
    ).toBe('native-history');
    for (const pid of [190, 200, 210, 220])
      expect(
        acceptedDensity.attempts.find((row) => row.pid === pid)?.accepted,
      ).toBe(false);
    for (const pid of [190, 200, 210])
      expect(
        acceptedDensity.attempts.find((row) => row.pid === pid)?.cases[0]
          ?.classification,
      ).toBe('classification-pending');
    densityContract('density-source-mismatch');
    expect(
      runCensus(root).rows.find((row) => row.pid === 180)?.cases[0]
        ?.classification,
    ).toBe('classification-pending');
    writeFileSync(
      join(run, 'package-resume-g-0000/results.json'),
      JSON.stringify([{ ...base, pid: 'invalid' }]),
    );
    expect(() => runCensus(root)).toThrow();
    writeFileSync(join(run, 'package-resume-g-0000/results.json'), '[]');
    writeFileSync(
      join(w22, 'continuation-run-c/current-progress.before.json'),
      'wrong snapshot',
    );
    expect(() => runCensus(root)).toThrow(
      'Readonly before snapshot checksum mismatch',
    );
  });
});
