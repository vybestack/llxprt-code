/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runCensus } from './w22-census-runner.ts';

it('uses source-bound conservative file rules without promoting them to native coverage', () => {
  const parent = resolve('tmp/854-notes/p4/w22/continuation-run-c');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'classification-fixture-'));
  const w22 = join(root, 'tmp/854-notes/p4/w22');
  const batch = join(w22, 'run-20261019-a/package-resume-g-0000');
  const control = join(
    root,
    'project-plans/issue854/recovery-2026-10-19/recovered-control',
  );
  mkdirSync(batch, { recursive: true });
  mkdirSync(control, { recursive: true });
  const path = 'a.test.ts';
  const cases = [{ classname: 'public', name: 'works', status: 'passed' }];
  const caseHash = createHash('sha256')
    .update(
      JSON.stringify(
        cases.map(({ classname, name, status }) => [classname, name, status]),
      ),
    )
    .digest('hex');
  writeFileSync(
    join(w22, 'run-20261019-a/inventory.json'),
    JSON.stringify([{ path }]),
  );
  const junit = join(batch, 'case.xml');
  const log = join(batch, 'case.log');
  writeFileSync(
    junit,
    '<testsuites tests="1" failures="0"><testsuite name="public" tests="1" failures="0"><testcase classname="public" name="works"/></testsuite></testsuites>',
  );
  writeFileSync(
    log,
    '(pass) public > works [1ms]\n 1 pass\n 0 fail\nRan 1 test across 1 file. [1ms]\n',
  );
  writeFileSync(
    join(batch, 'results.json'),
    JSON.stringify([
      {
        path,
        pid: 1,
        backend: 'journal',
        sourceHash: 'tested',
        code: 0,
        signal: null,
        pass: 1,
        fail: 0,
        skip: 0,
        junit,
        log,
      },
    ]),
  );
  const rules = (sourceHash: string, hash: string, rule: string): void =>
    writeFileSync(
      join(control, 'W22-CASE-RULES.tsv'),
      `path\tsource_sha256\tcases_sha256\trule\tevidence\n${path}\t${sourceHash}\t${hash}\t${rule}\tfixture.ts:12:createIndependentFixture\n`,
    );
  rules('tested', caseHash, 'history-independent');
  expect(runCensus(root).classifications['history-independent']).toBe(1);
  rules('tested', caseHash, 'shared-public-no-native-claim');
  expect(runCensus(root).classifications['shared-public-no-native-claim']).toBe(
    1,
  );
  expect(runCensus(root).classifications['native-history']).toBe(0);
  for (const [hash, cases] of [
    ['wrong-source', caseHash],
    ['tested', 'wrong-cases'],
  ]) {
    rules(hash ?? '', cases ?? '', 'history-independent');
    expect(runCensus(root).classifications['classification-pending']).toBe(1);
  }
  rules('tested', caseHash, 'native-history');
  expect(() => runCensus(root)).toThrow('Unsupported file classification');
  rules('tested', caseHash, 'shared-public-no-native-claim');
  const closure = (
    sourceHash: string,
    counterpartName = 'native works',
    counterpartHash = 'tested-native',
  ): void => {
    writeFileSync(
      join(control, 'W22-NATIVE-CLOSURE.json'),
      JSON.stringify({
        rows: [
          {
            path,
            sourceHash,
            cases: [
              {
                classname: 'public',
                name: 'works',
                classification: 'explicit-old',
                nativeCounterparts: [
                  {
                    batch: 'package-resume-g-0000',
                    path: 'native.test.ts',
                    sourceHash: counterpartHash,
                    classname: 'public',
                    name: counterpartName,
                  },
                ],
              },
            ],
          },
          {
            path: 'native.test.ts',
            sourceHash: 'tested-native',
            cases: [
              {
                classname: 'public',
                name: 'native works',
                classification: 'native-history',
              },
            ],
          },
        ],
      }),
    );
  };
  writeFileSync(
    join(w22, 'run-20261019-a/inventory.json'),
    JSON.stringify([{ path }, { path: 'native.test.ts' }]),
  );
  const nativeXml = join(batch, 'native.xml');
  const nativeLog = join(batch, 'native.log');
  writeFileSync(
    nativeXml,
    '<testsuites tests="1" failures="0"><testsuite name="public" tests="1" failures="0"><testcase classname="public" name="native works"/></testsuite></testsuites>',
  );
  writeFileSync(
    nativeLog,
    '(pass) public > native works [1ms]\n 1 pass\n 0 fail\nRan 1 test across 1 file. [1ms]\n',
  );
  writeFileSync(
    join(batch, 'native-result.json'),
    JSON.stringify({
      path: 'native.test.ts',
      pid: 2,
      backend: 'journal',
      sourceHash: 'tested-native',
      code: 0,
      signal: null,
      pass: 1,
      fail: 0,
      skip: 0,
      junit: nativeXml,
      log: nativeLog,
    }),
  );
  closure('tested');
  expect(runCensus(root).classifications['native-history']).toBe(1);
  expect(runCensus(root).classifications['explicit-old']).toBe(1);
  for (const [name, hash] of [
    ['missing case', 'tested-native'],
    ['native works', 'wrong-source'],
  ]) {
    closure('tested', name, hash);
    expect(runCensus(root).rows.find((row) => row.path === path)?.state).toBe(
      'unverified',
    );
  }
  closure('wrong-source');
  expect(runCensus(root).classifications['explicit-old']).toBe(0);
});
