/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runCensus } from './w22-census-runner.ts';

function fixture(): {
  root: string;
  path: string;
  classify: (
    sourceHash: string,
    classification: string,
    counterparts?: object[],
  ) => void;
  batch: (
    backend: string,
    sourceHash: string,
    passed?: boolean,
    complete?: boolean,
  ) => void;
} {
  const evidence = resolve('tmp/854-notes/p4/w22/continuation-run-c');
  mkdirSync(evidence, { recursive: true });
  const root = mkdtempSync(join(evidence, 'request-counterparts-fixture-'));
  const w22 = join(root, 'tmp/854-notes/p4/w22');
  const run = join(w22, 'run-20261019-a');
  const path =
    'packages/agents/src/compression/__tests__/middleout-disk.test.ts';
  const nativePath =
    'packages/agents/src/compression/__tests__/native-counterpart.journal.test.ts';
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'inventory.json'), JSON.stringify([{ path }]));
  function record(
    batch: string,
    file: string,
    backend: string,
    sourceHash: string,
    name: string,
    passed: boolean,
    complete: boolean,
  ): void {
    const directory = join(run, batch);
    mkdirSync(directory, { recursive: true });
    const junit = join(directory, 'case.xml');
    const log = join(directory, 'case.log');
    writeFileSync(
      junit,
      `<testsuites tests="1" failures="${passed ? 0 : 1}" skipped="0"><testsuite name="suite" tests="1" failures="${passed ? 0 : 1}" skipped="0"><testcase classname="suite" name="${name}">${passed ? '' : '<failure message="broken"/>'}</testcase></testsuite></testsuites>`,
    );
    writeFileSync(
      log,
      complete
        ? ` ${passed ? 1 : 0} pass\n ${passed ? 0 : 1} fail\n 0 skip\nRan 1 test across 1 file. [1ms]\n`
        : 'interrupted',
    );
    writeFileSync(
      join(directory, 'results.json'),
      JSON.stringify([
        {
          path: file,
          pid: file === path ? 1 : 2,
          backend,
          sourceHash,
          code: passed ? 0 : 1,
          signal: null,
          timedOut: false,
          pass: passed ? 1 : 0,
          fail: passed ? 0 : 1,
          skip: 0,
          junit,
          log,
        },
      ]),
    );
  }
  record(
    'request-middle-final-journal-k-b',
    path,
    'journal',
    'request-final',
    'old request bytes',
    true,
    true,
  );
  const contracts = join(w22, 'request-publication-run-k');
  mkdirSync(contracts, { recursive: true });
  return {
    root,
    path,
    classify: (sourceHash, classification, nativeCounterparts): void => {
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
                  name: 'old request bytes',
                  classification,
                  nativeCounterparts,
                },
              ],
            },
          ],
        }),
      );
    },
    batch: (backend, sourceHash, passed = true, complete = true): void => {
      record(
        'request-related-final-journal-k-b',
        nativePath,
        backend,
        sourceHash,
        'native request bytes',
        passed,
        complete,
      );
    },
  };
}

it('withholds request green status when exact final-source case coverage is unknown', () => {
  const { root, classify } = fixture();
  classify('wrong-source', 'native-history');
  const mismatch = runCensus(root);
  expect(mismatch.rows[0]?.state).toBe('unverified');
  expect(mismatch.rows[0]?.cases[0]?.classification).toBe(
    'classification-pending',
  );
  expect(mismatch.classifications['native-history']).toBe(0);
  classify('request-final', 'classification-pending');
  expect(runCensus(root).rows[0]?.state).toBe('unverified');
  classify('request-final', 'native-history');
  expect(runCensus(root).partition).toStrictEqual({
    green: 1,
    red: 0,
    unverified: 0,
    unrun: 0,
  });
});

it('requires completed exact-source journal counterparts for explicitly old request contracts without enlarging inventory', () => {
  const { root, classify, batch } = fixture();
  classify('request-final', 'explicit-old');
  expect(runCensus(root).rows[0]?.state).toBe('unverified');
  const counterpart = {
    batch: 'request-related-final-journal-k-b',
    path: 'packages/agents/src/compression/__tests__/native-counterpart.journal.test.ts',
    sourceHash: 'native-final',
    classname: 'suite',
    name: 'native request bytes',
  };
  classify('request-final', 'explicit-old', [counterpart]);
  expect(runCensus(root).rows[0]?.state).toBe('unverified');
  batch('old', 'native-final');
  expect(runCensus(root).rows[0]?.state).toBe('unverified');
  batch('journal', 'wrong-source');
  expect(runCensus(root).rows[0]?.state).toBe('unverified');
  batch('journal', 'native-final', false);
  expect(runCensus(root).rows[0]?.state).toBe('unverified');
  batch('journal', 'native-final', true, false);
  expect(runCensus(root).rows[0]?.state).toBe('unverified');
  batch('journal', 'native-final');
  const completed = runCensus(root);
  expect(completed.partition).toStrictEqual({
    green: 1,
    red: 0,
    unverified: 0,
    unrun: 0,
  });
  expect(completed.inventory).toBe(1);
  expect(completed.rows[0]?.cases[0]?.classification).toBe('explicit-old');
  expect(completed.classifications['native-history']).toBe(0);
  classify('request-final', 'explicit-old', [
    {
      batch: 'request-middle-final-journal-k-b',
      path: 'packages/agents/src/compression/__tests__/middleout-disk.test.ts',
      sourceHash: 'request-final',
      classname: 'suite',
      name: 'old request bytes',
    },
  ]);
  expect(runCensus(root).rows[0]?.state).toBe('unverified');
  classify('request-final', 'explicit-old', [
    { ...counterpart, name: 'not the executed case' },
  ]);
  expect(runCensus(root).rows[0]?.state).toBe('unverified');
});
