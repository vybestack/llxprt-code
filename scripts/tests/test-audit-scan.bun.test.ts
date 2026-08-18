/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral contract for scripts/test-audit/scan.ts (issue #3240).
 *
 * The fixture (scripts/test-audit/fixtures/smells.fixture.ts) contains one
 * known site per HIGH-tier flag plus one clean negative-control test. The
 * scanner must flag every smell, attribute it to the right test, and stay
 * silent on the clean test. Keeping the fixture non-executable is part of
 * the contract: these tests must never run.
 */
import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import {
  existsSync,
  rmSync,
  readFileSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { basename } from 'node:path';
import { tmpdir } from 'node:os';
import {
  scanFile,
  runScan,
  collectTestFiles,
  type Finding,
  type ScanStats,
} from '../test-audit/scan.ts';

const FIXTURE = join(
  import.meta.dir,
  '..',
  'test-audit',
  'fixtures',
  'smells.fixture.ts',
);

interface FixtureResult {
  findings: Finding[];
  stats: ScanStats;
}

function runFixture(): FixtureResult {
  const findings: Finding[] = [];
  const stats: ScanStats = {
    files: 0,
    tests: 0,
    asserts: 0,
    errors: 0,
    errorFiles: [],
  };
  scanFile(FIXTURE, findings, stats, []);
  return { findings, stats };
}

function findOne(
  findings: Finding[],
  flag: string,
  testNameFragment: string,
): Finding {
  const hit = findings.find(
    (f) => f.flag === flag && f.test.includes(testNameFragment),
  );
  expect(hit).toBeDefined();
  if (!hit)
    throw new Error(
      `no ${flag} finding for test containing '${testNameFragment}'`,
    );
  return hit;
}

describe('test-audit scanner: HIGH-tier smells in the fixture', () => {
  it('flags a mock-mirror assertion that echoes the stub literal', () => {
    const { findings } = runFixture();
    const mirror = findOne(
      findings,
      'MOCK_MIRROR',
      'echoes the stub literal back',
    );
    expect(mirror.detail).toContain('EXPECTED_LABEL');
    expect(mirror.area).toBe('scripts');
  });

  it('flags literal-equals-itself and length>=0 as ALWAYS_TRUE', () => {
    const { findings } = runFixture();
    expect(findings.filter((f) => f.flag === 'ALWAYS_TRUE').length).toBe(2);
    expect(
      findOne(findings, 'ALWAYS_TRUE', 'compares a literal to itself').detail,
    ).toContain('stable');
  });

  it('flags expect(x).toBe(x) as SELF_COMPARE', () => {
    const { findings } = runFixture();
    expect(findings.filter((f) => f.flag === 'SELF_COMPARE').length).toBe(1);
  });

  it('flags a test without assertions as NO_ASSERT', () => {
    const { findings } = runFixture();
    expect(findings.filter((f) => f.flag === 'NO_ASSERT').length).toBe(1);
  });

  it('flags an assertion that only runs inside catch as SWALLOWED_ASSERT', () => {
    const { findings } = runFixture();
    expect(findings.filter((f) => f.flag === 'SWALLOWED_ASSERT').length).toBe(
      1,
    );
  });

  it('flags repeated identical assertions as DUP_ASSERT', () => {
    const { findings } = runFixture();
    const dup = findOne(findings, 'DUP_ASSERT', 'duplicates an assertion');
    expect(dup.detail).toContain('2x');
  });
});

describe('test-audit scanner: negative control and stats', () => {
  it('stays silent on a test asserting a derived property', () => {
    const { findings } = runFixture();
    expect(
      findings.filter((f) => f.test.includes('clean negative control')),
    ).toEqual([]);
  });

  it('counts fixture tests and assertions', () => {
    const { stats } = runFixture();
    expect(stats.files).toBe(1);
    expect(stats.errors).toBe(0);
    // 12 it() tests + 1 it.each test (counted as 1 by the scanner's
    // decorator-chain logic) = 13 total.
    expect(stats.tests).toBe(13);
    expect(stats.asserts).toBeGreaterThanOrEqual(10);
  });

  it('attributes every finding to a named test with a line number', () => {
    const { findings } = runFixture();
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.test).toContain('fixture smells');
      expect(f.line).toBeGreaterThan(0);
    }
  });
});

describe('test-audit scanner: new detector coverage', () => {
  it('flags a snapshot-only test as SNAPSHOT_ONLY', () => {
    const { findings } = runFixture();
    const snap = findOne(findings, 'SNAPSHOT_ONLY', 'only asserts a snapshot');
    expect(snap.flag).toBe('SNAPSHOT_ONLY');
    expect(snap.detail).toContain('snapshot');
  });

  it('does not flag a negated ALWAYS_TRUE as a smell', () => {
    const { findings } = runFixture();
    // The negated expectation test should NOT produce an ALWAYS_TRUE finding.
    const negatedAlwaysTrue = findings.filter(
      (f) =>
        f.flag === 'ALWAYS_TRUE' && f.test.includes('negates an expectation'),
    );
    expect(negatedAlwaysTrue).toEqual([]);
  });

  it('detects it.each parametric tests (not zero-test)', () => {
    const { stats, findings } = runFixture();
    // The fixture has 13 tests total (11 it() + 1 it.each + 1 negative
    // control). If the decorator-chain detection regressed and treated
    // it.each as zero tests, the count would drop to 12.
    expect(stats.tests).toBe(13);
    // The it.each test must not be flagged as NO_ASSERT — it has
    // assertions inside its callback.
    const itEachNoAssert = findings.find(
      (f) => f.flag === 'NO_ASSERT' && f.test.includes('it.each case'),
    );
    expect(itEachNoAssert).toBeUndefined();
  });

  it('does not flag a transformed shared-literal assertion with an unrelated plain assertion as MOCK_MIRROR', () => {
    const { findings } = runFixture();
    const falsePositive = findings.find(
      (f) =>
        f.flag === 'MOCK_MIRROR' &&
        f.test.includes('transformed shared-literal'),
    );
    expect(falsePositive).toBeUndefined();
  });
});

describe('test-audit scanner: runScan and collectTestFiles', () => {
  it('collectTestFiles finds .test.ts and .spec.ts files but not .fixture.ts', () => {
    const td = mkdtempSync(join(tmpdir(), 'scan-collect-'));
    try {
      writeFileSync(join(td, 'a.test.ts'), "it('x', () => {});");
      writeFileSync(join(td, 'b.spec.ts'), "it('y', () => {});");
      writeFileSync(join(td, 'c.fixture.ts'), "it('z', () => {});");
      writeFileSync(join(td, 'd.ts'), "it('w', () => {});");
      const files = collectTestFiles(td);
      const names = files.map((f) => basename(f)).sort();
      expect(names).toEqual(['a.test.ts', 'b.spec.ts']);
    } finally {
      rmSync(td, { recursive: true, force: true });
    }
  });

  it('runScan writes findings.tsv and file-stats.tsv to the output dir', () => {
    const td = mkdtempSync(join(tmpdir(), 'scan-runscan-'));
    const outDir = join(td, 'out');
    try {
      // Create a real .test.ts file with a known MOCK_MIRROR smell so
      // runScan processes at least one file and produces a real finding.
      writeFileSync(
        join(td, 'smell.test.ts'),
        [
          "import { it, expect, vi } from 'bun:test';",
          "it('mirror', () => {",
          "  const mock = vi.fn().mockReturnValue('literal');",
          '  const result = mock();',
          "  expect(result).toBe('literal');",
          '});',
        ].join('\n'),
      );
      // runScan resolves roots relative to cwd, so pass the absolute temp dir.
      const result = runScan([td], outDir);
      expect(result.stats.files).toBe(1);
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      expect(existsSync(join(outDir, 'findings.tsv'))).toBe(true);
      expect(existsSync(join(outDir, 'file-stats.tsv'))).toBe(true);
      const tsv = readFileSync(join(outDir, 'findings.tsv'), 'utf8');
      expect(tsv.split('\n')[0]).toBe('file\tline\ttest\tflag\tdetail\tarea');
      // At least one data row beyond the header.
      expect(tsv.trim().split('\n').length).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(td, { recursive: true, force: true });
    }
  });
});
