/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runCensus } from './w22-census-runner.ts';

it('accepts observation cases only from completed journal evidence at the classified source', () => {
  const evidence = resolve('tmp/854-notes/p4/w22/core-observation-run-l');
  mkdirSync(evidence, { recursive: true });
  const root = mkdtempSync(join(evidence, 'census-fixture-'));
  const w22 = join(root, 'tmp/854-notes/p4/w22');
  const run = join(w22, 'run-20261019-a');
  mkdirSync(run, { recursive: true });
  const path =
    'packages/agents/src/core/ConversationManager.modelStamp.test.ts';
  writeFileSync(join(run, 'inventory.json'), JSON.stringify([{ path }]));
  const batches: Array<[string, number, string]> = [
    ['observation-final-journal-l-b', 1, 'journal'],
    ['observation-final-old-l-b', 2, 'old'],
    ['observation-final-journal-l-a', 3, 'journal'],
    ['observation-unknown-l-b', 4, 'unknown'],
  ];
  let finalLog = '';
  for (const [batch, pid, backend] of batches) {
    const directory = join(run, batch);
    mkdirSync(directory, { recursive: true });
    const junit = join(directory, 'case.xml');
    const log = join(directory, 'case.log');
    if (pid === 1) finalLog = log;
    writeFileSync(
      junit,
      '<testsuites tests="1" failures="0" skipped="0"><testsuite name="suite" tests="1" failures="0" skipped="0"><testcase classname="suite" name="imported origin"/></testsuite></testsuites>',
    );
    writeFileSync(
      log,
      ' 1 pass\n 0 fail\n 0 skip\nRan 1 test across 1 file.\n',
    );
    writeFileSync(
      join(directory, 'results.json'),
      JSON.stringify([
        {
          path,
          pid,
          backend,
          sourceHash: 'observation-final',
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
  const contracts = join(w22, 'core-observation-run-l');
  mkdirSync(contracts, { recursive: true });
  const classify = (sourceHash: string, name: string): void => {
    writeFileSync(
      join(contracts, 'classification.json'),
      JSON.stringify({
        rows: [
          {
            path,
            sourceHash,
            cases: [
              { classname: 'suite', name, classification: 'native-history' },
            ],
          },
        ],
      }),
    );
  };
  classify('observation-final', 'imported origin');
  const accepted = runCensus(root);
  expect(accepted.rows[0]?.pid).toBe(1);
  expect(accepted.partition).toStrictEqual({
    green: 1,
    red: 0,
    unverified: 0,
    unrun: 0,
  });
  expect(accepted.rows[0]?.cases[0]?.classification).toBe('native-history');
  for (const pid of [2, 3, 4]) {
    const excluded = accepted.attempts.find((row) => row.pid === pid);
    expect(excluded?.accepted).toBe(false);
    expect(excluded?.cases[0]?.classification).toBe('classification-pending');
  }
  for (const [sourceHash, name] of [
    ['other-source', 'imported origin'],
    ['observation-final', 'other-case'],
  ]) {
    classify(sourceHash, name);
    const rejected = runCensus(root);
    expect(rejected.partition).toStrictEqual({
      green: 0,
      red: 0,
      unverified: 1,
      unrun: 0,
    });
    expect(rejected.rows[0]?.cases[0]?.classification).toBe(
      'classification-pending',
    );
  }
  classify('observation-final', 'imported origin');
  writeFileSync(
    finalLog,
    ' 0 pass\n 1 fail\n 0 skip\nRan 1 test across 1 file.\n',
  );
  expect(runCensus(root).partition.green).toBe(0);
});
