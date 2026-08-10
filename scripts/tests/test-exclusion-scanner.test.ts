/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  BASELINE_PATH,
  extractExcludeArray,
  hasGlobWildcards,
  isBlanketTestExclusion,
  isLiteralTestOptOut,
  isTestIndicator,
  normalizePosixPath,
  parseBaseline,
  scanConfigExclusions,
  scanRepositoryTestExclusions,
} from '../eslint-guard/test-exclusion-scanner.ts';

const repoRoot = resolve(__dirname, '..', '..');

function createGuardRepository(
  baseBaseline: string | null,
  currentBaseline: string,
  currentExclude: readonly string[],
): { readonly root: string; readonly base: string } {
  const root = mkdtempSync(join(tmpdir(), 'issue3161-guard-'));
  const configDir = join(root, 'packages', 'sample');
  const baselinePath = join(root, BASELINE_PATH);
  mkdirSync(configDir, { recursive: true });
  mkdirSync(resolve(baselinePath, '..'), { recursive: true });
  writeFileSync(
    join(configDir, 'tsconfig.json'),
    JSON.stringify({ exclude: ['dist'] }, null, 2),
  );
  if (baseBaseline !== null) {
    writeFileSync(baselinePath, baseBaseline);
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'issue3161@example.test'], {
    cwd: root,
  });
  execFileSync('git', ['config', 'user.name', 'Issue 3161'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  const base = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  writeFileSync(
    join(configDir, 'tsconfig.json'),
    JSON.stringify({ exclude: ['dist', ...currentExclude] }, null, 2),
  );
  writeFileSync(baselinePath, currentBaseline);
  return { root, base };
}

function baseline(entries: readonly string[]): string {
  return JSON.stringify(
    {
      issue: 3161,
      configs: { 'packages/sample/tsconfig.json': entries },
    },
    null,
    2,
  );
}
describe('test-exclusion-scanner — classification', () => {
  describe('isBlanketTestExclusion', () => {
    const blanket = [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/*.test-d.ts',
      '**/__tests__/**',
      '__tests__',
      'test',
      'test/',
      'test/**',
      'tests',
      'tests/**',
      '../mcp/src/**/*.test.ts',
      '../mcp/src/**/*.spec.ts',
      'src/launcher/*.test.ts',
      'src/launcher/*.spec.ts',
      '**/*.{test,spec}.ts',
      'src/api/__tests__/fixtures/**',
      // Brace-expansion and wildcard-extension forms (#3161 review): the test
      // marker is present but the extension is a brace group or a bare glob,
      // so neither the old fixed-extension regex nor the test-word-in-brace
      // check alone detects them.
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      '**/*.test.*',
      '**/*.spec.*',
      '**/*.test-d.{ts,tsx}',
      '**/*.test-d.*',
      '../mcp/src/**/*.test.{ts,tsx}',
      '../mcp/src/**/*.spec.{ts,tsx}',
      '../core/src/**/*.test.*',
      '../core/src/**/*.test-d.{ts,tsx}',
      'src/{tests,prod}/**',
      'src/{__tests__,fixtures}/**',
      '../mcp/src/{tests,prod}/**',
      '../core/src/{__tests__,fixtures}/**',
      'src/__TESTS__/**',
    ];

    it.each(blanket)('rejects blanket form %s', (pattern) => {
      expect(isBlanketTestExclusion(pattern)).toBe(true);
    });
  });

  describe('isLiteralTestOptOut', () => {
    const literals = [
      'src/config/config.test.ts',
      'src/config/config.integration.test.ts',
      'src/ui/App.test.tsx',
      'src/types/utils.spec.ts',
      'src/types/utils.test-d.ts',
      '../mcp/src/foo/bar.test.ts',
    ];

    it.each(literals)('accepts literal path %s', (pattern) => {
      expect(isLiteralTestOptOut(pattern)).toBe(true);
      expect(isBlanketTestExclusion(pattern)).toBe(false);
    });
  });

  it('treats non-test excludes as neither blanket nor literal', () => {
    const nonTest = ['node_modules', 'dist', 'coverage', 'vitest.config.ts'];
    for (const entry of nonTest) {
      expect(isTestIndicator(entry)).toBe(false);
      expect(isBlanketTestExclusion(entry)).toBe(false);
      expect(isLiteralTestOptOut(entry)).toBe(false);
    }
  });

  it('does not treat test-helper-named files as test directory refs', () => {
    expect(isTestIndicator('src/test-helpers/util.ts')).toBe(false);
    expect(isTestIndicator('src/testing-setup.ts')).toBe(false);
    expect(isBlanketTestExclusion('src/test-helpers/util.ts')).toBe(false);
  });

  it('detects glob wildcards including brace patterns', () => {
    expect(hasGlobWildcards('**/*.test.ts')).toBe(true);
    expect(hasGlobWildcards('**/*.{test,spec}.ts')).toBe(true);
    expect(hasGlobWildcards('src/launcher/*.test.ts')).toBe(true);
    expect(hasGlobWildcards('src/config/config.test.ts')).toBe(false);
  });
});

describe('test-exclusion-scanner — JSONC parsing', () => {
  it('parses exclude arrays that contain leading/trailing JSONC comments', () => {
    const source = [
      '{',
      '  // issue #3161 tracking',
      '  "exclude": [',
      '    // blanket removed',
      '    "node_modules",',
      '    "dist"',
      '  ]',
      '}',
    ].join('\n');
    expect(extractExcludeArray(source)).toEqual(['node_modules', 'dist']);
  });

  it('parses block comments interspersed with entries', () => {
    const source =
      '{ "exclude": [ /* keep */ "dist", "node_modules" /* tail */ ] }';
    expect(extractExcludeArray(source)).toEqual(['dist', 'node_modules']);
  });
});

describe('test-exclusion-scanner — scanConfigExclusions', () => {
  it('flags blanket entries and collects literal opt-outs', () => {
    const source = [
      '{',
      '  "exclude": [',
      '    "node_modules",',
      '    "dist",',
      '    "**/*.test.ts",',
      '    "src/config/config.test.ts"',
      '  ]',
      '}',
    ].join('\n');
    const result = scanConfigExclusions('packages/foo/tsconfig.json', source);
    expect(result.blanket).toHaveLength(1);
    expect(result.blanket[0].content).toBe('**/*.test.ts');
    expect(result.optOuts).toEqual(['src/config/config.test.ts']);
  });

  it('distinguishes a literal file from a directory inside __tests__', () => {
    const root = mkdtempSync(join(tmpdir(), 'issue3161-classifier-'));
    const configDir = join(root, 'packages', 'sample');
    const testDir = join(configDir, 'src', '__tests__');
    try {
      mkdirSync(join(testDir, 'fixtures.json'), { recursive: true });
      writeFileSync(join(testDir, 'single.json'), '{}');
      const source = JSON.stringify({
        exclude: ['src/__tests__/fixtures.json', 'src/__tests__/single.json'],
      });

      const result = scanConfigExclusions(
        'packages/sample/tsconfig.json',
        source,
        join(configDir, 'tsconfig.json'),
      );

      expect(result.blanket.map((violation) => violation.content)).toEqual([
        'src/__tests__/fixtures.json',
      ]);
      expect(result.optOuts).toEqual(['src/__tests__/single.json']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('test-exclusion-scanner — path normalization', () => {
  it('normalizes backslashes to POSIX forward slashes deterministically', () => {
    expect(normalizePosixPath('src\\ui\\App.test.tsx')).toBe(
      'src/ui/App.test.tsx',
    );
    expect(normalizePosixPath('src/ui/App.test.tsx')).toBe(
      'src/ui/App.test.tsx',
    );
    // Idempotent.
    expect(normalizePosixPath(normalizePosixPath('src\\a\\b.test.ts'))).toBe(
      normalizePosixPath('src\\a\\b.test.ts'),
    );
  });
});

describe('test-exclusion-scanner — baseline', () => {
  it('parses a populated baseline keyed by POSIX config path', () => {
    const content = [
      '{',
      '  "issue": 3161,',
      '  "configs": {',
      '    "packages/cli/tsconfig.json": ["src/config/config.test.ts"],',
      '    "packages\\\\win\\\\tsconfig.json": ["a/b.test.ts"]',
      '  }',
      '}',
    ].join('\n');
    const baseline = parseBaseline(content);
    expect(baseline.configs['packages/cli/tsconfig.json']).toEqual([
      'src/config/config.test.ts',
    ]);
    // Windows config key normalized to POSIX.
    expect(baseline.configs['packages/win/tsconfig.json']).toEqual([
      'a/b.test.ts',
    ]);
  });

  it('fails fast for malformed and structurally invalid baseline content', () => {
    expect(() => parseBaseline('not json')).toThrow();
    expect(() => parseBaseline('   ')).toThrow();
    expect(() => parseBaseline('{"issue":3161}')).toThrow();
    expect(() => parseBaseline('{"issue":999,"configs":{}}')).toThrow();
  });

  it('rejects duplicate entries after path normalization', () => {
    expect(() =>
      parseBaseline(baseline(['src\\config.test.ts', 'src/config.test.ts'])),
    ).toThrow(/duplicate/i);
  });

  it('rejects non-typecheck keys and entries that are not literal test files', () => {
    const invalidKey = JSON.stringify({
      issue: 3161,
      configs: { 'packages/sample/tsconfig.build.json': [] },
    });
    expect(() => parseBaseline(invalidKey)).toThrow(/config/i);
    expect(() => parseBaseline(baseline(['src/**/*.test.ts']))).toThrow(
      /literal/i,
    );
    expect(() => parseBaseline(baseline(['dist/index.ts']))).toThrow(
      /literal/i,
    );
  });
});

describe('test-exclusion-scanner — repository ratchet', () => {
  it('allows initial bootstrap only when the baseline is absent at the Git base', () => {
    const fixture = createGuardRepository(null, baseline(['src/new.test.ts']), [
      'src/new.test.ts',
    ]);
    try {
      expect(scanRepositoryTestExclusions(fixture.root, fixture.base)).toEqual(
        [],
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('fails when the current baseline is missing or malformed', () => {
    const missing = createGuardRepository(baseline([]), baseline([]), []);
    const malformed = createGuardRepository(baseline([]), 'not json', []);
    try {
      unlinkSync(join(missing.root, BASELINE_PATH));
      expect(() =>
        scanRepositoryTestExclusions(missing.root, missing.base),
      ).toThrow(/baseline/i);
      expect(() =>
        scanRepositoryTestExclusions(malformed.root, malformed.base),
      ).toThrow();
    } finally {
      rmSync(missing.root, { recursive: true, force: true });
      rmSync(malformed.root, { recursive: true, force: true });
    }
  });

  it('fails fast when the Git-base baseline is malformed', () => {
    const fixture = createGuardRepository('not json', baseline([]), []);
    try {
      expect(() =>
        scanRepositoryTestExclusions(fixture.root, fixture.base),
      ).toThrow();
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects a literal opt-out that is absent from the working baseline', () => {
    const fixture = createGuardRepository(baseline([]), baseline([]), [
      'src/new.test.ts',
    ]);
    try {
      expect(
        scanRepositoryTestExclusions(fixture.root, fixture.base).map(
          (violation) => violation.content,
        ),
      ).toContain('src/new.test.ts');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects pure baseline growth even when the new entry is currently stale', () => {
    const fixture = createGuardRepository(
      baseline([]),
      baseline(['src/new.test.ts']),
      [],
    );
    try {
      expect(
        scanRepositoryTestExclusions(fixture.root, fixture.base).map(
          (violation) => violation.content,
        ),
      ).toContain('packages/sample/tsconfig.json:src/new.test.ts');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('allows stale baseline reduction without blocking', () => {
    const fixture = createGuardRepository(
      baseline(['src/old.test.ts']),
      baseline([]),
      [],
    );
    try {
      expect(scanRepositoryTestExclusions(fixture.root, fixture.base)).toEqual(
        [],
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects inherited blanket exclusions on the exact package config', () => {
    const fixture = createGuardRepository(baseline([]), baseline([]), []);
    const configDir = join(fixture.root, 'packages', 'sample');
    try {
      writeFileSync(
        join(configDir, 'base.json'),
        JSON.stringify({ exclude: ['src/{tests,prod}/**'] }),
      );
      writeFileSync(
        join(configDir, 'tsconfig.json'),
        JSON.stringify({ extends: './base.json' }),
      );

      const violations = scanRepositoryTestExclusions(
        fixture.root,
        fixture.base,
      );
      expect(violations.map((violation) => violation.content)).toContain(
        'src/{tests,prod}/**',
      );
      expect(violations[0]?.file).toBe('packages/sample/tsconfig.json');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('fails fast on cyclic and malformed inherited configs', () => {
    const cyclic = createGuardRepository(baseline([]), baseline([]), []);
    const malformed = createGuardRepository(baseline([]), baseline([]), []);
    try {
      const cyclicDir = join(cyclic.root, 'packages', 'sample');
      writeFileSync(
        join(cyclicDir, 'tsconfig.json'),
        JSON.stringify({ extends: './base.json' }),
      );
      writeFileSync(
        join(cyclicDir, 'base.json'),
        JSON.stringify({ extends: './tsconfig.json' }),
      );
      writeFileSync(
        join(malformed.root, 'packages', 'sample', 'tsconfig.json'),
        JSON.stringify({ extends: 42 }),
      );

      expect(() =>
        scanRepositoryTestExclusions(cyclic.root, cyclic.base),
      ).toThrow(/cycle/i);
      expect(() =>
        scanRepositoryTestExclusions(malformed.root, malformed.base),
      ).toThrow(/extends/i);
    } finally {
      rmSync(cyclic.root, { recursive: true, force: true });
      rmSync(malformed.root, { recursive: true, force: true });
    }
  });

  it('requires working baseline keys to equal the scanned config paths', () => {
    const missing = createGuardRepository(
      baseline([]),
      JSON.stringify({ issue: 3161, configs: {} }),
      [],
    );
    const extra = createGuardRepository(
      baseline([]),
      JSON.stringify({
        issue: 3161,
        configs: {
          'packages/sample/tsconfig.json': [],
          'packages/other/tsconfig.json': [],
        },
      }),
      [],
    );
    try {
      expect(() =>
        scanRepositoryTestExclusions(missing.root, missing.base),
      ).toThrow(/config/i);
      expect(() =>
        scanRepositoryTestExclusions(extra.root, extra.base),
      ).toThrow(/config/i);
    } finally {
      rmSync(missing.root, { recursive: true, force: true });
      rmSync(extra.root, { recursive: true, force: true });
    }
  });

  it('rejects a same-total substitution relative to the Git-base entry set', () => {
    const fixture = createGuardRepository(
      baseline(['src/old.test.ts']),
      baseline(['src/new.test.ts']),
      ['src/new.test.ts'],
    );
    try {
      const violations = scanRepositoryTestExclusions(
        fixture.root,
        fixture.base,
      );
      expect(violations.map((violation) => violation.content)).toContain(
        'packages/sample/tsconfig.json:src/new.test.ts',
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

describe('test-exclusion-scanner — repository invariants (#3161)', () => {
  it('the committed baseline file exists and is keyed by issue 3161', () => {
    const baselineAbs = join(repoRoot, BASELINE_PATH);
    expect(existsSync(baselineAbs)).toBe(true);
    const content = readFileSync(baselineAbs, 'utf8');
    const baseline = parseBaseline(content);
    expect(baseline.issue).toBe(3161);
  });

  it('no typecheck-feeding config contains a blanket test exclusion', () => {
    const violations = scanRepositoryTestExclusions(repoRoot, 'HEAD');
    const blanket = violations.filter((v) =>
      v.message.includes('Blanket test exclusion'),
    );
    expect(blanket).toEqual([]);
  });

  it('graduated packages have zero test opt-outs', () => {
    const graduated = [
      'packages/a2a-server/tsconfig.json',
      'packages/policy/tsconfig.json',
      'packages/storage/tsconfig.json',
      'packages/ide-integration/tsconfig.json',
      'packages/auth/tsconfig.json',
      'packages/tools/tsconfig.json',
      'packages/lsp/tsconfig.json',
    ];
    const baseline = parseBaseline(
      readFileSync(join(repoRoot, BASELINE_PATH), 'utf8'),
    );
    for (const configPath of graduated) {
      expect(baseline.configs[configPath] ?? []).toEqual([]);
    }
  });

  it('all current literal opt-outs are tracked in the baseline', () => {
    const violations = scanRepositoryTestExclusions(repoRoot, 'HEAD');
    const untracked = violations.filter((v) =>
      v.message.includes('not tracked in the'),
    );
    expect(untracked).toEqual([]);
  });

  it('the eslint guard entry point stays green against the committed state', () => {
    const violations = scanRepositoryTestExclusions(repoRoot, 'HEAD');
    const blocking = violations.filter(
      (v) =>
        v.message.includes('Blanket test exclusion') ||
        v.message.includes('not tracked in the') ||
        v.message.includes('forbids adding test opt-outs'),
    );
    expect(blocking).toEqual([]);
  });
});

describe('test-exclusion-scanner — new test is typechecked (#3161 AC3)', () => {
  // Proves permanently that a brand-new test file in a graduated package is
  // typechecked by default. Creates a deliberately-invalid temporary test in
  // the policy package, runs the real workspace typecheck, observes failure,
  // then cleans up and confirms the valid state passes again.
  it('an invalid new test fails the real policy workspace typecheck and cleanup restores green', () => {
    const policyDir = join(repoRoot, 'packages', 'policy');
    const tempTest = join(
      policyDir,
      'src',
      `tmp-issue3161-typecheck-probe-${process.pid}.test.ts`,
    );
    const invalidSource = [
      '/** @license Apache-2.0 */',
      "import { describe, it, expect } from 'bun:test';",
      'describe("issue3161 probe", () => {',
      '  // Deliberately invalid: assigning string to number.',
      '  const value: number = "not-a-number";',
      '  it("fails typecheck on purpose", () => {',
      '    expect(value).toBe(0);',
      '  });',
      '});',
      '',
    ].join('\n');

    try {
      writeFileSync(tempTest, invalidSource);
      const proc = Bun.spawnSync({
        cmd: ['bun', 'x', 'tsc', '--noEmit'],
        cwd: policyDir,
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 120_000,
      });
      const out =
        (proc.stdout?.toString() ?? '') + (proc.stderr?.toString() ?? '');
      const failed = proc.exitCode !== 0;
      expect(failed).toBe(true);
      expect(out).toContain('tmp-issue3161-typecheck-probe');
    } finally {
      if (existsSync(tempTest)) {
        unlinkSync(tempTest);
      }
    }

    // After cleanup the valid state must pass again.
    const proc = Bun.spawnSync({
      cmd: ['bun', 'x', 'tsc', '--noEmit'],
      cwd: policyDir,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
    });
    expect(proc.exitCode).toBe(0);
  });
});
