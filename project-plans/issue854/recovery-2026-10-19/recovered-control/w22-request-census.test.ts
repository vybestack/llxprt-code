/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runCensus } from './w22-census-runner.ts';

it('accepts only completed final journal request batches and source-matched case classifications', () => {
  const evidence = resolve('tmp/854-notes/p4/w22/continuation-run-c');
  mkdirSync(evidence, { recursive: true });
  const root = mkdtempSync(join(evidence, 'census-fixture-'));
  const w22 = join(root, 'tmp/854-notes/p4/w22');
  const run = join(w22, 'run-20261019-a');
  mkdirSync(run, { recursive: true });
  const path =
    'packages/agents/src/compression/__tests__/middleout-disk.test.ts';
  writeFileSync(join(run, 'inventory.json'), JSON.stringify([{ path }]));
  for (const [batch, pid, backend] of [
    ['density-final-journal-j-a', 1, 'journal'],
    ['request-middle-final-journal-k-b', 2, 'journal'],
    ['request-middle-final-old-k-b', 3, 'old'],
    ['request-initial-journal-k-a', 4, 'journal'],
    ['request-unknown-k-b', 5, 'unknown'],
  ] as const) {
    const directory = join(run, batch);
    mkdirSync(directory, { recursive: true });
    const junit = join(directory, 'case.xml');
    const log = join(directory, 'case.log');
    writeFileSync(
      junit,
      '<testsuites tests="1" failures="0" skipped="0"><testsuite name="suite" tests="1" failures="0" skipped="0"><testcase classname="suite" name="request bytes"/></testsuite></testsuites>',
    );
    writeFileSync(
      log,
      '(pass) suite > request bytes [1ms]\n 1 pass\n 0 fail\n 0 skip\nRan 1 test across 1 file. [1ms]\n',
    );
    writeFileSync(
      join(directory, 'results.json'),
      JSON.stringify([
        {
          path,
          pid,
          backend,
          sourceHash: 'request-final',
          code: 0,
          signal: null,
          timedOut: false,
          pass: 1,
          fail: 0,
          skip: 0,
          junit,
          log,
        },
      ]),
    );
  }
  const contracts = join(w22, 'request-publication-run-k');
  mkdirSync(contracts, { recursive: true });
  const classify = (sourceHash: string): void =>
    writeFileSync(
      join(contracts, 'classification.json'),
      JSON.stringify({
        rows: [
          {
            path,
            sourceHash,
            cases: [
              {
                classname: 'suite',
                name: 'request bytes',
                classification: 'native-history',
              },
            ],
          },
        ],
      }),
    );
  classify('request-final');
  const result = runCensus(root);
  expect(result.rows[0]?.pid).toBe(2);
  expect(result.partition).toStrictEqual({
    green: 1,
    red: 0,
    unverified: 0,
    unrun: 0,
  });
  expect(result.rows[0]?.cases[0]?.classification).toBe('native-history');
  expect(result.rows[0]?.cases[0]?.classificationProvenance).toContain(
    'request-publication-run-k/classification.json',
  );
  for (const pid of [3, 4, 5]) {
    const attempt = result.attempts.find((row) => row.pid === pid);
    expect(attempt?.accepted).toBe(false);
    expect(attempt?.cases[0]?.classification).toBe('classification-pending');
  }
  classify('different-source');
  expect(runCensus(root).rows[0]?.cases[0]?.classification).toBe(
    'classification-pending',
  );
});
