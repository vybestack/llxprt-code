/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The CLI Bun runner must execute EVERY unit test file in the workspace: the
 * migration explicitly rejects a manifest or allow-list, because a filtered run
 * hides failures instead of reporting them. These tests pin the discovery
 * contract so a future change cannot quietly drop files from the run.
 */

import { describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  discoverTestFiles,
  escapeXml,
  exitCodeForRun,
  failureExcerpt,
  isTestFile,
  fileTimeoutForFile,
  parseCaseCounts,
  parsePartitionIdentity,
  selectPartition,
  stripAnsi,
  timeoutForFile,
  toPathArgument,
} from '../run-bun-tests.js';
import type { PartitionIdentity } from '../run-bun-tests.js';

describe('isTestFile', () => {
  it('selects every test and spec extension the workspace uses', () => {
    expect(isTestFile('config.test.ts')).toBe(true);
    expect(isTestFile('App.test.tsx')).toBe(true);
    expect(isTestFile('useThing.spec.ts')).toBe(true);
    expect(isTestFile('Dialog.spec.tsx')).toBe(true);
  });

  it('selects integration tests too, so no file is left unrun', () => {
    expect(isTestFile('security.integration.test.ts')).toBe(true);
    expect(isTestFile('wiring.integration.spec.tsx')).toBe(true);
  });

  it('rejects files that are not tests', () => {
    expect(isTestFile('config.ts')).toBe(false);
    expect(isTestFile('types.d.ts')).toBe(false);
    expect(isTestFile('test-helpers.ts')).toBe(false);
    expect(isTestFile('README.md')).toBe(false);
  });
});

describe('exitCodeForRun', () => {
  it('fails when test files fail or the JUnit artifact cannot be written', () => {
    expect(exitCodeForRun(0, false)).toBe(0);
    expect(exitCodeForRun(1, false)).toBe(1);
    expect(exitCodeForRun(0, true)).toBe(1);
  });
});

describe('parseCaseCounts', () => {
  it('reads the per-file tallies from a Bun summary', () => {
    const output = [
      'bun test v1.3.14',
      '(pass) something > works [0.1ms]',
      '',
      ' 12 pass',
      ' 2 skip',
      ' 1 fail',
      ' 30 expect() calls',
      'Ran 15 tests across 1 file. [1.2s]',
    ].join(String.fromCharCode(10));

    expect(parseCaseCounts(output)).toEqual({
      pass: 12,
      fail: 1,
      skip: 2,
      todo: 0,
    });
  });

  it('reports zeroes when a file produced no summary', () => {
    expect(parseCaseCounts('crashed before reporting')).toEqual({
      pass: 0,
      fail: 0,
      skip: 0,
      todo: 0,
    });
  });

  it('does not mistake the expect() call total for a case count', () => {
    expect(parseCaseCounts(' 30 expect() calls').pass).toBe(0);
  });
});

describe('discoverTestFiles', () => {
  it('walks every test root and skips build and dependency directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'cli-runner-discovery-'));
    try {
      const write = (relativePath: string): void => {
        const absolute = join(root, relativePath);
        mkdirSync(join(absolute, '..'), { recursive: true });
        writeFileSync(absolute, '');
      };

      write('src/a.test.ts');
      write('src/nested/deep/b.spec.tsx');
      write('test/c.test.tsx');
      write('test-bun/d.test.ts');
      write('test-utils/e.spec.ts');
      write('src/g.ts');
      write('src/node_modules/h.test.ts');
      write('src/dist/i.test.ts');
      write('src/coverage/j.test.ts');
      write('src/.hidden/k.test.ts');
      write('docs/l.test.ts');

      expect(discoverTestFiles(root)).toEqual([
        'src/a.test.ts',
        'src/nested/deep/b.spec.tsx',
        'test-bun/d.test.ts',
        'test-utils/e.spec.ts',
        'test/c.test.tsx',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns paths relative to the workspace root', () => {
    const root = mkdtempSync(join(tmpdir(), 'cli-runner-relative-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'src', 'only.test.ts'), '');

      for (const file of discoverTestFiles(root)) {
        expect(file.startsWith('/')).toBe(false);
        expect(file).toBe('src/only.test.ts');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('escapeXml', () => {
  it('escapes XML metacharacters', () => {
    expect(escapeXml('<a href="x">&</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('strips control characters that XML 1.0 forbids', () => {
    const withControls = `before${String.fromCharCode(1)}mid${String.fromCharCode(
      0x1b,
    )}[31mafter`;
    const escaped = escapeXml(withControls);
    expect(escaped).not.toContain(String.fromCharCode(1));
    expect(escaped).not.toContain(String.fromCharCode(0x1b));
    expect(escaped).toContain('before');
    expect(escaped).toContain('after');
  });

  it('keeps tab, newline and carriage return', () => {
    expect(escapeXml('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });
});

describe('timeoutForFile', () => {
  it('gives an integration test a larger budget than a unit test', () => {
    const unit = timeoutForFile('src/ui/hooks/useKeypress.test.tsx');
    const integration = timeoutForFile(
      'src/integration-tests/cli-args.integration.test.ts',
    );
    expect(integration).toBeGreaterThan(unit);
  });

  it('applies the integration budget to a .spec integration file too', () => {
    expect(timeoutForFile('src/foo.integration.spec.ts')).toBe(
      timeoutForFile('src/bar.integration.test.ts'),
    );
  });

  it('does not treat a file merely mentioning integration as one', () => {
    expect(timeoutForFile('src/integrationWiring.test.ts')).toBe(
      timeoutForFile('src/plain.test.ts'),
    );
  });
});

describe('fileTimeoutForFile', () => {
  it('gives an integration file a larger whole-file budget', () => {
    expect(
      fileTimeoutForFile('src/integration-tests/cli-args.integration.test.ts'),
    ).toBeGreaterThan(fileTimeoutForFile('src/ui/hooks/useKeypress.test.tsx'));
  });

  it('admits a file whose cases each cost a CI-speed CLI spawn', () => {
    // 20 cases at roughly ten seconds per spawn is the observed CI shape.
    const observedCiCost = 20 * 10_000;
    expect(
      fileTimeoutForFile('src/integration-tests/cli-args.integration.test.ts'),
    ).toBeGreaterThan(observedCiCost);
  });
});

describe('bun-suffixed test discovery', () => {
  it('treats a .bun.ts suite as a test file', () => {
    expect(isTestFile('settingsStorage.bun.ts')).toBe(true);
  });

  it('treats a .bun.tsx suite as a test file', () => {
    expect(isTestFile('useAgentEventStream.bun.tsx')).toBe(true);
  });

  it('does not treat the workspace preload as a test file', () => {
    expect(isTestFile('bun-test-setup.ts')).toBe(false);
  });
});

describe('toPathArgument', () => {
  it('makes a workspace-relative file explicit so bun treats it as a path', () => {
    expect(toPathArgument('test-bun/settingsStorage.bun.ts')).toBe(
      './test-bun/settingsStorage.bun.ts',
    );
  });

  it('leaves an already-relative path alone', () => {
    expect(toPathArgument('./src/a.test.ts')).toBe('./src/a.test.ts');
  });

  it('leaves an absolute path alone', () => {
    expect(toPathArgument('/tmp/a.test.ts')).toBe('/tmp/a.test.ts');
  });
});

describe('parseCaseCounts', () => {
  it('reads counts from output that carries colour codes', () => {
    const esc = String.fromCharCode(27);
    const coloured = [
      `${esc}[32m 6 pass${esc}[0m`,
      `${esc}[31m 2 fail${esc}[0m`,
      ' 1 skip',
      ' 0 todo',
    ].join('\n');

    expect(parseCaseCounts(coloured)).toEqual({
      pass: 6,
      fail: 2,
      skip: 1,
      todo: 0,
    });
  });

  it('strips CSI sequences', () => {
    const esc = String.fromCharCode(27);
    expect(stripAnsi(`${esc}[32mgreen${esc}[0m`)).toBe('green');
  });
});

describe('discoverTestFiles symlink safety', () => {
  it('terminates when a directory symlink forms a cycle', () => {
    const root = mkdtempSync(join(tmpdir(), 'bun-runner-cycle-'));
    try {
      const src = join(root, 'src');
      const nested = join(src, 'nested');
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, 'thing.test.ts'), 'export {};');
      // nested/loop -> src, so a naive walk would recurse forever.
      symlinkSync(
        src,
        join(nested, 'loop'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const found = discoverTestFiles(root);

      expect(found).toContain('src/nested/thing.test.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * React's "not wrapped in act(...)" warning is a fixed ~10-line block. These
 * tests pin the behaviour that keeps assertion failures visible in a truncated
 * log instead of being crowded out by the repeated warning. (issue #3149)
 */
function actWarningBlock(component: string): string {
  return [
    `An update to ${component} inside a test was not wrapped in act(...).`,
    '',
    'When testing, code that causes React state updates should be wrapped into act(...):',
    '',
    'act(() => {',
    '  /* fire events that update state */',
    '});',
    '/* assert on the output */',
    '',
    "This ensures that you're testing the behavior the user would see in the browser. Learn more at https://react.dev/link/wrap-tests-with-act",
  ].join(String.fromCharCode(10));
}

describe('failureExcerpt', () => {
  it('returns short output unchanged', () => {
    expect(failureExcerpt('short output', 100)).toBe('short output');
  });

  it('handles empty string without throwing', () => {
    expect(failureExcerpt('', 100)).toBe('');
  });

  it('respects the budget even when it is smaller than the elision marker', () => {
    const excerpt = failureExcerpt('x'.repeat(500), 10);
    expect(excerpt.length).toBeLessThanOrEqual(10);
  });

  it('preserves the failing assertion that a naive tail would have dropped', () => {
    const nl = String.fromCharCode(10);
    const assertion = `error: expect(received).toBe(expected)${nl}`;
    const assertionRepeat = assertion.repeat(3);
    // Many warning blocks AFTER the assertion, large enough to push it out of
    // a 600-character tail on their own.
    const warnings = `${actWarningBlock('BaseSelectionList')}${nl}`.repeat(30);
    const output = `${assertionRepeat}${warnings}5 fail${nl}`;

    const naiveTail = output.slice(-600);
    const excerpt = failureExcerpt(output, 600);

    // The naive tail is entirely warning text and loses the assertion.
    expect(naiveTail).not.toContain('expect(received)');
    // The excerpt keeps the assertion visible and counts the elided warnings.
    expect(excerpt).toContain('expect(received)');
    expect(excerpt).toContain(
      'React "not wrapped in act(...)" warning block(s) elided',
    );
    // The excerpt stays within the requested budget.
    expect(excerpt.length).toBeLessThanOrEqual(600);
  });

  it('keeps the trailing summary when warnings are collapsed', () => {
    const nl = String.fromCharCode(10);
    const warnings = `${actWarningBlock('Dialog')}${nl}`.repeat(20);
    const output = `${warnings}17 pass${nl}5 fail${nl}`;
    const excerpt = failureExcerpt(output, 400);
    expect(excerpt).toContain('5 fail');
    expect(excerpt).toContain('17 pass');
  });

  it('uses head and tail when the remaining content still exceeds the budget', () => {
    // No act() warnings, just a long output that must be truncated.
    const nl = String.fromCharCode(10);
    const head = `FIRST-LINE${nl}`;
    const middle = 'x'.repeat(2000);
    const tail = `${nl}LAST-LINE${nl}`;
    const output = `${head}${middle}${tail}`;
    const excerpt = failureExcerpt(output, 100);
    expect(excerpt).toContain('FIRST-LINE');
    expect(excerpt).toContain('LAST-LINE');
    expect(excerpt).toContain('output elided');
    expect(excerpt.length).toBeLessThanOrEqual(100);
  });

  it('preserves head, tail, and warning count when both warnings and body are large', () => {
    // Exercises the combined path: collapseActWarnings + banner + headTail.
    const nl = String.fromCharCode(10);
    const warnings = `${actWarningBlock('Menu')}${nl}`.repeat(5);
    const middle = 'y'.repeat(2000);
    const output = `HEAD${nl}${warnings}${middle}${nl}TAIL${nl}3 fail${nl}`;
    const excerpt = failureExcerpt(output, 200);
    expect(excerpt).toContain('warning block(s) elided');
    expect(excerpt).toContain('output elided');
    expect(excerpt).toContain('HEAD');
    expect(excerpt).toContain('3 fail');
    expect(excerpt.length).toBeLessThanOrEqual(200);
  });

  it('does not swallow assertions following a truncated (unterminated) warning block', () => {
    const nl = String.fromCharCode(10);
    // A warning block whose end marker never appears (truncated at the source)
    // must not consume every subsequent line including the assertion.
    const truncatedWarning =
      'An update to Foo inside a test was not wrapped in act(...).';
    // The standard warning block is ~10 lines; we need >15 lines of padding
    // to exceed the cap and verify recovery.
    const padding = Array.from(
      { length: 20 },
      (_, i) => `padding line ${i}`,
    ).join(nl);
    const assertion = 'expect(received).toBe(expected)';
    const summary = '5 fail';
    const output = `${truncatedWarning}${nl}${padding}${nl}${assertion}${nl}${summary}${nl}`;
    const excerpt = failureExcerpt(output, 600);
    expect(excerpt).toContain(assertion);
  });
});

// ---------------------------------------------------------------------------
// Partition selection (issue #3185): split the CLI test suite into parallel
// CI legs via LLXPRT_CLI_TEST_PARTITION. These tests pin the parsing contract
// and the mathematical properties of round-robin selection so a partition can
// never silently drop, duplicate, or reorder files.
// ---------------------------------------------------------------------------

/** Wraps parsePartitionIdentity to satisfy the type checker without `!`. */
function requirePartition(id: string): PartitionIdentity {
  const parsed = parsePartitionIdentity(id);
  if (parsed === null) {
    throw new Error(`expected non-null partition for '${id}'`);
  }
  return parsed;
}

describe('parsePartitionIdentity', () => {
  it('returns null for an absent identity (no partition)', () => {
    expect(parsePartitionIdentity(undefined)).toBeNull();
  });

  it('returns null for an empty identity', () => {
    expect(parsePartitionIdentity('')).toBeNull();
  });

  it('returns null for a whitespace-only identity', () => {
    expect(parsePartitionIdentity('   ')).toBeNull();
  });

  it('parses 1of1 as identity selection', () => {
    expect(parsePartitionIdentity('1of1')).toEqual({ index: 1, count: 1 });
  });

  it('parses 1of3', () => {
    expect(parsePartitionIdentity('1of3')).toEqual({ index: 1, count: 3 });
  });

  it('parses 2of3', () => {
    expect(parsePartitionIdentity('2of3')).toEqual({ index: 2, count: 3 });
  });

  it('parses 3of3', () => {
    expect(parsePartitionIdentity('3of3')).toEqual({ index: 3, count: 3 });
  });

  it('rejects surrounding spaces around an otherwise canonical identity', () => {
    expect(() => parsePartitionIdentity(' 1of3 ')).toThrow(
      /LLXPRT_CLI_TEST_PARTITION/,
    );
  });

  it('rejects a trailing newline after an otherwise canonical identity', () => {
    expect(() => parsePartitionIdentity('1of3\n')).toThrow(
      /LLXPRT_CLI_TEST_PARTITION/,
    );
  });

  it('rejects a leading tab before an otherwise canonical identity', () => {
    expect(() => parsePartitionIdentity('\t1of3')).toThrow(
      /LLXPRT_CLI_TEST_PARTITION/,
    );
  });

  it('fails on a bare number', () => {
    expect(() => parsePartitionIdentity('2')).toThrow(
      /LLXPRT_CLI_TEST_PARTITION/,
    );
  });

  it('fails on arbitrary text', () => {
    expect(() => parsePartitionIdentity('abc')).toThrow(
      /LLXPRT_CLI_TEST_PARTITION/,
    );
  });

  it('fails on a zero index', () => {
    expect(() => parsePartitionIdentity('0of3')).toThrow(
      /LLXPRT_CLI_TEST_PARTITION/,
    );
  });

  it('fails on a zero count', () => {
    expect(() => parsePartitionIdentity('1of0')).toThrow(
      /LLXPRT_CLI_TEST_PARTITION/,
    );
  });

  it('fails when index exceeds count', () => {
    expect(() => parsePartitionIdentity('4of3')).toThrow(
      /LLXPRT_CLI_TEST_PARTITION/,
    );
  });

  it('fails on a negative index', () => {
    expect(() => parsePartitionIdentity('-1of3')).toThrow(
      /LLXPRT_CLI_TEST_PARTITION/,
    );
  });

  it('fails on a fractional value', () => {
    expect(() => parsePartitionIdentity('1.5of3')).toThrow(
      /LLXPRT_CLI_TEST_PARTITION/,
    );
  });

  it('fails on leading zeros (noncanonical)', () => {
    expect(() => parsePartitionIdentity('01of3')).toThrow(
      /LLXPRT_CLI_TEST_PARTITION/,
    );
  });

  it('fails on an unsafe integer (precision loss)', () => {
    // MAX_SAFE_INTEGER + 2 — parseInt loses precision so the round-trip check
    // must reject it.
    expect(() => parsePartitionIdentity('9007199254740993of3')).toThrow(
      /LLXPRT_CLI_TEST_PARTITION/,
    );
  });

  it('fails on the first non-safe integer that round-trips (2^53)', () => {
    // 2^53 = MAX_SAFE_INTEGER + 1 round-trips through String(parseInt(...))
    // without precision loss, so a round-trip check wrongly accepts it.
    // Number.isSafeInteger(9007199254740992) is false — it must be rejected.
    expect(() =>
      parsePartitionIdentity('9007199254740992of9007199254740992'),
    ).toThrow(/LLXPRT_CLI_TEST_PARTITION/);
  });
});

describe('selectPartition', () => {
  const FILES = Array.from({ length: 10 }, (_, i) => `src/file${i}.test.ts`);

  it('returns all files when there is no partition (null)', () => {
    expect(selectPartition(FILES, null)).toEqual(FILES);
  });

  it('returns all files for 1of1 (identity selection)', () => {
    expect(selectPartition(FILES, requirePartition('1of1'))).toEqual(FILES);
  });

  it('selects a deterministic round-robin partition for 2of3', () => {
    // positions 1, 4, 7 → indices where i % 3 === 1
    expect(selectPartition(FILES, requirePartition('2of3'))).toEqual([
      'src/file1.test.ts',
      'src/file4.test.ts',
      'src/file7.test.ts',
    ]);
  });

  it('selects a deterministic round-robin partition for 1of3', () => {
    expect(selectPartition(FILES, requirePartition('1of3'))).toEqual([
      'src/file0.test.ts',
      'src/file3.test.ts',
      'src/file6.test.ts',
      'src/file9.test.ts',
    ]);
  });

  it('selects a deterministic round-robin partition for 3of3', () => {
    expect(selectPartition(FILES, requirePartition('3of3'))).toEqual([
      'src/file2.test.ts',
      'src/file5.test.ts',
      'src/file8.test.ts',
    ]);
  });

  it('produces the same result on repeated calls (deterministic)', () => {
    const identity = requirePartition('2of3');
    expect(selectPartition(FILES, identity)).toEqual(
      selectPartition(FILES, identity),
    );
  });

  it('preserves the relative order of the sorted input', () => {
    const sorted = [...FILES].sort();
    for (const id of ['1of3', '2of3', '3of3']) {
      const selected = selectPartition(sorted, requirePartition(id));
      const positions = selected.map((f) => sorted.indexOf(f));
      const sortedPositions = [...positions].sort((a, b) => a - b);
      expect(positions).toEqual(sortedPositions);
    }
  });

  it('is exhaustive: the union of all partitions equals the full list', () => {
    const sorted = [...FILES].sort();
    const p1 = selectPartition(sorted, requirePartition('1of3'));
    const p2 = selectPartition(sorted, requirePartition('2of3'));
    const p3 = selectPartition(sorted, requirePartition('3of3'));
    expect([...p1, ...p2, ...p3].sort()).toEqual(sorted);
  });

  it('is pairwise disjoint: no file appears in two partitions', () => {
    const sorted = [...FILES].sort();
    const sets = ['1of3', '2of3', '3of3'].map(
      (id) => new Set(selectPartition(sorted, requirePartition(id))),
    );
    for (let a = 0; a < sets.length; a++) {
      for (let b = a + 1; b < sets.length; b++) {
        for (const file of sets[a]) {
          expect(sets[b].has(file)).toBe(false);
        }
      }
    }
  });

  it('is balanced: partition sizes differ by at most one', () => {
    const sorted = [...FILES].sort();
    const sizes = ['1of3', '2of3', '3of3'].map(
      (id) => selectPartition(sorted, requirePartition(id)).length,
    );
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('never introduces a path that the input did not contain', () => {
    const sorted = [...FILES].sort();
    for (const id of ['1of3', '2of3', '3of3']) {
      const selected = selectPartition(sorted, requirePartition(id));
      for (const file of selected) {
        expect(sorted).toContain(file);
      }
    }
  });

  it('fails fast when a well-formed identity selects zero files', () => {
    const tiny = ['src/a.test.ts', 'src/b.test.ts'];
    // 3of3 on 2 files: no index i in {0,1} satisfies i % 3 === 2.
    expect(() => selectPartition(tiny, requirePartition('3of3'))).toThrow(
      /LLXPRT_CLI_TEST_PARTITION/,
    );
  });
});

describe('discoverTestFiles ignores LLXPRT_CLI_TEST_PARTITION', () => {
  it('returns the complete inventory even while the env var is set', () => {
    const root = mkdtempSync(join(tmpdir(), 'cli-runner-partition-env-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(root, 'src', `f${i}.test.ts`), '');
      }

      const saved = process.env.LLXPRT_CLI_TEST_PARTITION;
      process.env.LLXPRT_CLI_TEST_PARTITION = '2of3';
      try {
        expect(discoverTestFiles(root)).toHaveLength(5);
      } finally {
        if (saved === undefined) {
          delete process.env.LLXPRT_CLI_TEST_PARTITION;
        } else {
          process.env.LLXPRT_CLI_TEST_PARTITION = saved;
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('partition placement over the real discovered inventory', () => {
  it('adding a test fixture places it in exactly one partition', () => {
    const root = mkdtempSync(join(tmpdir(), 'cli-runner-partition-add-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      for (let i = 0; i < 9; i++) {
        const name = `file${String(i).padStart(2, '0')}.test.ts`;
        writeFileSync(join(root, 'src', name), '');
      }
      // Add a fixture that sorts between existing files.
      writeFileSync(join(root, 'src', 'file04b.test.ts'), '');

      const discovered = discoverTestFiles(root);
      expect(discovered).toContain('src/file04b.test.ts');

      const partitions = ['1of3', '2of3', '3of3'].map((id) =>
        selectPartition(discovered, requirePartition(id)),
      );
      let appearances = 0;
      for (const partition of partitions) {
        if (partition.includes('src/file04b.test.ts')) {
          appearances++;
        }
      }
      expect(appearances).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('three partitions over the real packages/cli inventory (issue #3185)', () => {
  it('are exhaustive, pairwise disjoint, order-preserving, and balanced', () => {
    const cliRoot = resolve(import.meta.dir, '..');
    const discovered = discoverTestFiles(cliRoot);
    expect(discovered.length).toBeGreaterThan(0);

    const partitions = ['1of3', '2of3', '3of3'].map((id) =>
      selectPartition(discovered, requirePartition(id)),
    );

    // Pairwise disjoint: no file appears in two partitions.
    const sets = partitions.map((p) => new Set(p));
    for (let a = 0; a < sets.length; a++) {
      for (let b = a + 1; b < sets.length; b++) {
        for (const file of sets[a]) {
          expect(sets[b].has(file)).toBe(false);
        }
      }
    }

    // Exhaustive: the sorted union of all partitions equals the real inventory.
    expect(
      [...partitions[0], ...partitions[1], ...partitions[2]].sort(),
    ).toEqual([...discovered].sort());

    // Order-preserving: each partition's elements appear in the same relative
    // order as in the discovered inventory.
    for (const partition of partitions) {
      const positions = partition.map((f) => discovered.indexOf(f));
      const sortedPositions = [...positions].sort((x, y) => x - y);
      expect(positions).toEqual(sortedPositions);
    }

    // Balanced: partition sizes differ by at most one.
    const sizes = partitions.map((p) => p.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);

    // Evidence of the current inventory size (count-agnostic, not hard-coded).
    expect(partitions.reduce((sum, p) => sum + p.length, 0)).toBe(
      discovered.length,
    );
  });
});
