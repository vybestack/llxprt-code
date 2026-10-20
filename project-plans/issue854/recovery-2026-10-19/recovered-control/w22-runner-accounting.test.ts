/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { inspectEvidence, type AttemptInput } from './w22-census.ts';

const cases = [
  { classname: 'outer', name: 'before child', status: 'passed' },
  { classname: 'outer', name: 'after child', status: 'passed' },
];
const input: AttemptInput = {
  path: 'runner.test.ts',
  pid: 42,
  backend: 'journal',
  sourceHash: 'tested-source',
  code: 0,
  signal: null,
  timedOut: false,
  pass: 2,
  fail: 0,
  skip: 0,
  junit: 'outer.xml',
  log: 'outer.log',
};
const provenance = {
  batch: 'accepted',
  acceptedOrder: 0,
  references: ['original-results.json'],
  acceptanceReference: 'completed-run',
  backendProvenance: 'result.backend',
};
const xml =
  '<testsuites tests="2" failures="0" skipped="0"><testsuite name="outer" tests="2" failures="0"><testcase classname="outer" name="before child"/><testcase classname="outer" name="after child"/></testsuite></testsuites>';
const child =
  'bun test v1.3.14\n(pass) child\n\n 1 pass\n 0 fail\nRan 1 test across 1 file. [1ms]\n';
const outer = `(pass) outer > before child [1ms]\n${child}(pass) outer > after child [1ms]\n\n 2 pass\n 0 fail\n 2 expect() calls\nRan 2 tests across 1 file. [2ms]\n`;

function inspect(
  log: string | null,
  overrides: Partial<AttemptInput> = {},
): ReturnType<typeof inspectEvidence> {
  return inspectEvidence({ ...input, ...overrides }, provenance, xml, log);
}

describe('W22 nested runner stdout accounting', () => {
  it('uses the complete terminal outer summary rather than a nested child summary', () => {
    const result = inspect(outer);
    expect(result.state).toBe('green');
    expect(result.rawSummary).toEqual({ pass: 2, fail: 0, skip: 0 });
    expect(
      result.cases.map(({ classname, name }) => ({ classname, name })),
    ).toEqual(cases.map(({ classname, name }) => ({ classname, name })));
  });

  it('reconciles an incorrect saved aggregate only with agreeing raw names, saved cases and XML', () => {
    const result = inspect(outer, { pass: 1, cases });
    expect(result.state).toBe('green');
    expect(result.counts).toEqual({ pass: 2, fail: 0, skip: 0 });
    expect(result.pass).toBe(1);
    expect(result.countCorrection).toBe(
      'terminal-summary-and-exact-case-records',
    );
    expect(result.references).toEqual(['original-results.json']);
  });

  it('rejects incorrect saved aggregates without independent exact case and raw-name agreement', () => {
    for (const overrides of [
      { pass: 1 },
      { pass: 1, cases: cases.slice(0, 1) },
      { pass: 1, cases: [cases[0], { ...cases[1], name: 'wrong case' }] },
      { pass: 1, cases, code: 1 },
      { pass: 1, cases, signal: 'SIGTERM' },
      { pass: 1, cases, timedOut: true },
    ])
      expect(inspect(outer, overrides).state).not.toBe('green');
    expect(
      inspect(outer.replace('(pass) outer > after child [1ms]\n', ''), {
        pass: 1,
        cases,
      }).state,
    ).toBe('unverified');
  });

  it('never borrows a complete child summary for a partial or missing outer summary', () => {
    for (const log of [
      null,
      outer.slice(0, outer.lastIndexOf('Ran 2')),
      outer.replace(' 0 fail\n 2 expect()', ' 2 expect()'),
      outer.replace('Ran 2 tests', 'Ran 3 tests'),
      `${outer}(pass) later outer case\n 3 pass\n`,
      child,
    ])
      expect(inspect(log, { cases }).state).not.toBe('green');
  });
});
