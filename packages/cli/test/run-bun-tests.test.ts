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
import { join } from 'node:path';
import {
  discoverTestFiles,
  escapeXml,
  exitCodeForRun,
  failureExcerpt,
  isTestFile,
  fileTimeoutForFile,
  parseCaseCounts,
  stripAnsi,
  timeoutForFile,
  toPathArgument,
} from '../run-bun-tests.js';

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
