/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runCensus } from './w22-census-runner.ts';

it.each(['fault', 'child', 'retained'] as const)(
  'accepts %s contracts only with exact source, complete cases and a distinct completed native counterpart',
  (family) => {
    const families = {
      fault: {
        native: 'fault-final-journal-m-a',
        old: 'fault-final-old-m-a',
        directory: 'core-fault-run-m',
      },
      child: {
        native: 'child-final-journal-n-e',
        old: 'child-final-old-n-e',
        directory: 'childownership-run-n',
      },
      retained: {
        native: 'retained-final-journal-o-a',
        old: 'retained-final-old-o-a',
        directory: 'retained-run-o',
      },
    };
    const nativeBatch = families[family].native;
    const oldBatch = families[family].old;
    const contractDirectory = families[family].directory;
    const evidence = resolve('tmp/854-notes/p4/w22', contractDirectory);
    mkdirSync(evidence, { recursive: true });
    const root = mkdtempSync(join(evidence, 'census-fixture-'));
    const w22 = join(root, 'tmp/854-notes/p4/w22');
    const run = join(w22, 'run-20261019-a');
    mkdirSync(run, { recursive: true });
    const paths = {
      fault: 'packages/agents/src/core/semantic-purge-array-seam.test.ts',
      child: 'packages/agents/src/core/__tests__/childaccept-body.test.ts',
      retained:
        'packages/agents/src/core/__tests__/journal-retained-growth.test.ts',
    };
    const path = paths[family];
    writeFileSync(join(run, 'inventory.json'), JSON.stringify([{ path }]));
    let finalLog = '';
    const batches: Array<[string, number, string]> = [
      [nativeBatch, 1, 'journal'],
      [oldBatch, 2, 'old'],
      ['fault-diagnostic-journal-m-b', 3, 'journal'],
      ['fault-unknown-m-a', 4, 'unknown'],
    ];
    for (const [batch, pid, backend] of batches) {
      const directory = join(run, batch);
      mkdirSync(directory, { recursive: true });
      const junit = join(directory, 'case.xml');
      const log = join(directory, 'case.log');
      if (pid === 1) finalLog = log;
      writeFileSync(
        junit,
        '<testsuites tests="2" failures="0" skipped="0"><testsuite name="guard" tests="2" failures="0" skipped="0"><testcase classname="guard" name="old materializer"/><testcase classname="guard" name="native materializer"/></testsuite></testsuites>',
      );
      writeFileSync(
        log,
        ' 2 pass\n 0 fail\n 0 skip\nRan 2 tests across 1 file.\n',
      );
      writeFileSync(
        join(directory, 'results.json'),
        JSON.stringify([
          {
            path,
            pid,
            backend,
            sourceHash: 'fault-final',
            code: 0,
            signal: null,
            timedOut: false,
            pass: 2,
            fail: 0,
            skip: 0,
            junit,
            log,
          },
        ]),
      );
    }
    const contracts = join(w22, contractDirectory);
    mkdirSync(contracts, { recursive: true });
    const classify = (
      sourceHash: string,
      name: string,
      counterpartName = 'native materializer',
      counterpartHash = 'fault-final',
      counterpartBatch = nativeBatch,
    ): void => {
      writeFileSync(
        join(contracts, 'classification.json'),
        JSON.stringify({
          rows: [
            {
              path,
              sourceHash,
              cases: [
                {
                  classname: 'guard',
                  name: 'old materializer',
                  classification: 'explicit-old',
                  nativeCounterparts: [
                    {
                      batch: counterpartBatch,
                      path,
                      sourceHash: counterpartHash,
                      classname: 'guard',
                      name: counterpartName,
                    },
                  ],
                },
                { classname: 'guard', name, classification: 'native-history' },
              ],
            },
          ],
        }),
      );
    };
    classify('fault-final', 'native materializer');
    const accepted = runCensus(root);
    expect(accepted.rows[0]?.pid).toBe(1);
    expect(accepted.partition).toStrictEqual({
      green: 1,
      red: 0,
      unverified: 0,
      unrun: 0,
    });
    expect(
      accepted.rows[0]?.cases.map((test) => test.classification),
    ).toStrictEqual(['explicit-old', 'native-history']);
    for (const pid of [2, 3, 4]) {
      const excluded = accepted.attempts.find((row) => row.pid === pid);
      expect(excluded?.accepted).toBe(false);
      expect(excluded?.cases[0]?.classification).toBe('classification-pending');
    }
    for (const [
      hash,
      name,
      counterpartName,
      counterpartHash,
      counterpartBatch,
    ] of [
      [
        'wrong-source',
        'native materializer',
        'native materializer',
        'fault-final',
        nativeBatch,
      ],
      [
        'fault-final',
        'missing-case',
        'native materializer',
        'fault-final',
        nativeBatch,
      ],
      [
        'fault-final',
        'native materializer',
        'old materializer',
        'fault-final',
        nativeBatch,
      ],
      [
        'fault-final',
        'native materializer',
        'missing-native',
        'fault-final',
        nativeBatch,
      ],
      [
        'fault-final',
        'native materializer',
        'native materializer',
        'wrong-source',
        nativeBatch,
      ],
      [
        'fault-final',
        'native materializer',
        'native materializer',
        'fault-final',
        oldBatch,
      ],
    ]) {
      classify(hash, name, counterpartName, counterpartHash, counterpartBatch);
      expect(runCensus(root).partition).toStrictEqual({
        green: 0,
        red: 0,
        unverified: 1,
        unrun: 0,
      });
    }
    classify('fault-final', 'native materializer');
    writeFileSync(
      finalLog,
      ' 1 pass\n 1 fail\n 0 skip\nRan 2 tests across 1 file.\n',
    );
    expect(runCensus(root).partition.green).toBe(0);
    if (family === 'retained') {
      const unrelated =
        'packages/agents/src/core/orchestrator-history-ide.test.ts';
      writeFileSync(
        join(run, 'inventory.json'),
        JSON.stringify([{ path }, { path: unrelated }]),
      );
      const resultsPath = join(run, nativeBatch, 'results.json');
      const results: object[] = JSON.parse(readFileSync(resultsPath, 'utf8'));
      writeFileSync(
        resultsPath,
        JSON.stringify([
          ...results,
          { ...results[0], path: unrelated, pid: 5 },
        ]),
      );
      expect(
        runCensus(root).attempts.find((row) => row.pid === 5)?.accepted,
      ).toBe(false);
    }
  },
);
