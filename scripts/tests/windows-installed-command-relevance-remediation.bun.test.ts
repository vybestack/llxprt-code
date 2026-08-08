/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Remediation behavioral tests for the Windows installed-command semantic
 * relevance classifier (issue #2693 review findings).
 *
 * These exercise the EXPORTED pure classifier functions against the review
 * findings: GET method in gh api args, publishable package runtime inputs
 * (with test/spec exclusion), extended lifecycle scripts, malformed entry
 * fail-closed, and exact-file vs directory-prefix matching.
 */

import { describe, it, expect } from 'bun:test';
import {
  classifyWindowsRelevance,
  buildManifestApiArgs,
  type ClassifyWindowsRelevanceParams,
  type WindowsChangedFileEntry,
} from '../windows-installed-command-relevance.ts';

/** Minimal base manifest used by most tests (real root shape). */
const BASE_MANIFEST = JSON.stringify({
  name: '@vybestack/llxprt-code',
  version: '0.11.0',
  type: 'module',
  private: true,
  workspaces: ['packages/core', 'packages/cli'],
  scripts: {
    preinstall: 'node scripts/preinstall.cjs',
    postinstall: 'node scripts/postinstall.cjs',
    build: 'bun scripts/build.ts',
    lint: 'bun scripts/run-lint.ts',
  },
  dependencies: { bun: '1.3.14' },
  overrides: { typescript: '5.8.3' },
  engines: { node: '>=24', bun: '>=1.3.14' },
  packageManager: 'npm@11.6.2',
});

function entry(
  filename: string,
  status = 'modified',
  previousFilename?: string,
): WindowsChangedFileEntry {
  return {
    filename,
    status,
    ...(previousFilename !== undefined
      ? { previous_filename: previousFilename }
      : {}),
  };
}

function classifyPr(
  overrides: Partial<ClassifyWindowsRelevanceParams>,
): ReturnType<typeof classifyWindowsRelevance> {
  return classifyWindowsRelevance({
    event: 'pull_request',
    changedEntries: [entry('package.json')],
    changedFilesCount: 1,
    baseManifest: BASE_MANIFEST,
    headManifest: BASE_MANIFEST,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Finding 1: gh api forces GET method
// ---------------------------------------------------------------------------

describe('remediation: buildManifestApiArgs forces --method GET', () => {
  it('contains --method GET in the argument vector', () => {
    const args = buildManifestApiArgs('vybestack/llxprt-code', 'abc123');
    const methodIndex = args.indexOf('--method');
    expect(methodIndex).toBeGreaterThanOrEqual(0);
    expect(args[methodIndex + 1]).toBe('GET');
  });
});

// ---------------------------------------------------------------------------
// Finding 2: publishable package runtime inputs are relevant
// ---------------------------------------------------------------------------

describe('remediation: publishable package runtime source is relevant', () => {
  it('packages/cli/src/ui/App.tsx (CLI runtime) is relevant', () => {
    expect(
      classifyPr({
        changedEntries: [entry('packages/cli/src/ui/App.tsx')],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(true);
  });

  it('packages/core/src/index.ts (core runtime) is relevant', () => {
    expect(
      classifyPr({
        changedEntries: [entry('packages/core/src/index.ts')],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(true);
  });

  it('packages/agents/src/scheduler/dispatcher.ts (other publishable) is relevant', () => {
    expect(
      classifyPr({
        changedEntries: [entry('packages/agents/src/scheduler/dispatcher.ts')],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(true);
  });

  it('packages/cli/bundle/llxprt.js (CLI bundle) is relevant', () => {
    expect(
      classifyPr({
        changedEntries: [entry('packages/cli/bundle/llxprt.js')],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(true);
  });

  it('packages/tools/index.ts (publishable entry point) is relevant', () => {
    expect(
      classifyPr({
        changedEntries: [entry('packages/tools/index.ts')],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(true);
  });
});

describe('remediation: package test/spec content is NOT relevant', () => {
  it('packages/cli/src/__tests__/foo.test.ts is NOT relevant', () => {
    expect(
      classifyPr({
        changedEntries: [entry('packages/cli/src/__tests__/foo.test.ts')],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(false);
  });

  it('packages/core/src/policy/bar.spec.ts is NOT relevant', () => {
    expect(
      classifyPr({
        changedEntries: [entry('packages/core/src/policy/bar.spec.ts')],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(false);
  });

  it('packages/core/src/__snapshots__/snap.test.ts.snap is NOT relevant', () => {
    expect(
      classifyPr({
        changedEntries: [
          entry('packages/core/src/__snapshots__/snap.test.ts.snap'),
        ],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(false);
  });

  it('packages/agents/src/scheduler/scheduler.test.ts is NOT relevant', () => {
    expect(
      classifyPr({
        changedEntries: [
          entry('packages/agents/src/scheduler/scheduler.test.ts'),
        ],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(false);
  });

  it('packages/core/src/foo.bun.test.ts (bun test) is NOT relevant', () => {
    expect(
      classifyPr({
        changedEntries: [entry('packages/core/src/foo.bun.test.ts')],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Finding 4: extended lifecycle scripts (preprepare, postprepare)
// ---------------------------------------------------------------------------

describe('remediation: preprepare/postprepare lifecycle scripts', () => {
  function withScript(name: string): ReturnType<typeof classifyPr> {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    const scripts = { ...(head['scripts'] as Record<string, unknown>) };
    scripts[name] = `node scripts/${name}.cjs`;
    head['scripts'] = scripts;
    return classifyPr({ headManifest: JSON.stringify(head) });
  }

  it('adding a preprepare script is relevant', () => {
    const result = withScript('preprepare');
    expect(result.relevant).toBe(true);
    expect(result.reason).toContain('lifecycle');
  });

  it('changing a postprepare script is relevant', () => {
    expect(withScript('postprepare').relevant).toBe(true);
  });

  it('adding the npm dependencies lifecycle script is relevant', () => {
    const result = withScript('dependencies');
    expect(result.relevant).toBe(true);
    expect(result.reason).toContain('lifecycle');
  });

  it('an ordinary named script is NOT relevant (not every script is lifecycle)', () => {
    const result = withScript('lint:custom');
    expect(result.relevant).toBe(false);
  });
});

describe('remediation: malformed manifest scripts fail closed', () => {
  it('treats a change between non-object scripts values as relevant', () => {
    const base = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    base['scripts'] = 'malformed-base';
    head['scripts'] = 'malformed-head';

    const result = classifyPr({
      baseManifest: JSON.stringify(base),
      headManifest: JSON.stringify(head),
    });

    expect(result.relevant).toBe(true);
    expect(result.reason).toContain('scripts');
  });

  it('treats a change from an object to malformed scripts as relevant', () => {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    head['scripts'] = false;

    const result = classifyPr({ headManifest: JSON.stringify(head) });

    expect(result.relevant).toBe(true);
    expect(result.reason).toContain('scripts');
  });
});

// ---------------------------------------------------------------------------
// Finding 5: malformed changed-file entries fail closed (pure classifier)
// ---------------------------------------------------------------------------

describe('remediation: malformed entries fail closed (pure classifier)', () => {
  it('entry with unknown status fails closed', () => {
    expect(
      classifyPr({
        changedEntries: [entry('docs/index.md', 'bogus-status')],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(true);
  });

  it('entry with empty status fails closed', () => {
    expect(
      classifyPr({
        changedEntries: [{ filename: 'docs/index.md', status: '' }],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(true);
  });

  it('renamed entry without previous_filename fails closed', () => {
    expect(
      classifyPr({
        changedEntries: [{ filename: 'docs/new.md', status: 'renamed' }],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(true);
  });

  it('renamed entry with empty previous_filename fails closed', () => {
    expect(
      classifyPr({
        changedEntries: [
          {
            filename: 'docs/new.md',
            status: 'renamed',
            previous_filename: '',
          },
        ],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(true);
  });

  it('valid modified entry does NOT fail closed', () => {
    expect(
      classifyPr({
        changedEntries: [entry('docs/index.md', 'modified')],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(false);
  });

  it('valid removed entry does NOT fail closed', () => {
    expect(
      classifyPr({
        changedEntries: [entry('docs/index.md', 'removed')],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(false);
  });

  it('valid renamed entry with previous_filename does NOT fail closed', () => {
    expect(
      classifyPr({
        changedEntries: [entry('docs/new.md', 'renamed', 'docs/old.md')],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Finding 6: exact file vs directory prefix matching (no overmatch)
// ---------------------------------------------------------------------------

describe('remediation: exact files do not overmatch arbitrary prefixes', () => {
  it.each([
    ['package-lock.json.backup'],
    ['.nvmrc.old'],
    ['.bun-version.bak'],
    ['scripts/prepare-package.ts.bak'],
    ['scripts/postinstall.cjs.old'],
  ])('%s is NOT relevant (prefix overmatch fix)', (path) => {
    expect(
      classifyPr({
        changedEntries: [entry(path)],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(false);
  });

  it.each([
    ['package-lock.json', true],
    ['.nvmrc', true],
    ['scripts/prepare-package.ts', true],
    ['packages/cli/bin/llxprt', true],
    ['scripts/windows-installed-command-smoke/checks.cjs', true],
  ])('exact/directory %s IS relevant', (path, expected) => {
    expect(
      classifyPr({
        changedEntries: [entry(path)],
        changedFilesCount: 1,
      }).relevant,
    ).toBe(expected);
  });
});
