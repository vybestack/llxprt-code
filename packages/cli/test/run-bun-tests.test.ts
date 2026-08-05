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

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverTestFiles,
  escapeXml,
  isTestFile,
  fileTimeoutForFile,
  parseCaseCounts,
  timeoutForFile,
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
