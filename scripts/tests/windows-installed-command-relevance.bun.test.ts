/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the Windows installed-command semantic relevance
 * classifier (issue #2693).
 *
 * These exercise the EXPORTED pure classifier functions from
 * `scripts/windows-installed-command-relevance.ts` against realistic PR
 * scenarios:
 *   - unrelated named scripts (the PR #2686 negative case)
 *   - lifecycle/invoked scripts
 *   - workspaces/dependency/install metadata
 *   - formatting/key order (no-op)
 *   - lockfile and direct path categories
 *   - mixed changes
 *   - rename/deletion of relevant inputs (fail-closed)
 *   - packed-asset (README/LICENSE) deletion vs ordinary content edit
 *   - malformed/missing manifests
 *   - incomplete/mismatched file data
 *   - PR, push, and manual events
 *   - gh api argument construction for manifest fetch (no -q ref= misuse)
 */

import { describe, it, expect } from 'bun:test';
import {
  classifyWindowsRelevance,
  compareRootManifests,
  buildManifestApiArgs,
  buildChangedFilesApiArgs,
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

/** Builds a single modified file entry. */
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

/** Shorthand for a PR classification call with valid defaults. */
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

describe('windows-relevance: workflow_dispatch always runs', () => {
  it('manual trigger is relevant regardless of changes', () => {
    const result = classifyWindowsRelevance({
      event: 'workflow_dispatch',
      changedEntries: [],
      changedFilesCount: undefined,
      baseManifest: undefined,
      headManifest: undefined,
    });
    expect(result.relevant).toBe(true);
  });
});

describe('windows-relevance: non-PR events fail closed', () => {
  it('push event is relevant (untrustworthy base)', () => {
    const result = classifyWindowsRelevance({
      event: 'push',
      changedEntries: [entry('package.json')],
      changedFilesCount: 1,
      baseManifest: BASE_MANIFEST,
      headManifest: BASE_MANIFEST,
    });
    expect(result.relevant).toBe(true);
  });

  it('schedule event is relevant', () => {
    const result = classifyWindowsRelevance({
      event: 'schedule',
      changedEntries: [entry('docs/index.md')],
      changedFilesCount: 1,
      baseManifest: undefined,
      headManifest: undefined,
    });
    expect(result.relevant).toBe(true);
  });

  it('merge_group event is relevant', () => {
    const result = classifyWindowsRelevance({
      event: 'merge_group',
      changedEntries: [entry('package.json')],
      changedFilesCount: 1,
      baseManifest: BASE_MANIFEST,
      headManifest: BASE_MANIFEST,
    });
    expect(result.relevant).toBe(true);
  });
});

describe('windows-relevance: PR file-count guards fail closed', () => {
  it('unusable changedFilesCount (undefined) fails closed', () => {
    const result = classifyPr({
      changedFilesCount: undefined,
    });
    expect(result.relevant).toBe(true);
  });

  it('unusable changedFilesCount (NaN) fails closed', () => {
    const result = classifyPr({
      changedFilesCount: Number.NaN,
    });
    expect(result.relevant).toBe(true);
  });

  it('count mismatch (truncation) fails closed', () => {
    const result = classifyPr({
      changedEntries: [entry('package.json'), entry('docs/index.md')],
      changedFilesCount: 4000,
    });
    expect(result.relevant).toBe(true);
    expect(result.reason).toContain('mismatch');
  });
});

describe('windows-relevance: unrelated named scripts skip (PR #2686 case)', () => {
  it('adding lint:doc-links and lint:doc-placement scripts is NOT relevant', () => {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    const scripts = { ...(head['scripts'] as Record<string, unknown>) };
    scripts['lint:doc-links'] = 'bun scripts/check-doc-links.ts';
    scripts['lint:doc-placement'] = 'bun scripts/check-doc-placement.ts';
    head['scripts'] = scripts;

    const result = classifyPr({
      headManifest: JSON.stringify(head),
    });
    expect(result.relevant).toBe(false);
    expect(result.reason).toContain('unrelated');
  });

  it('adding a new ordinary test script is NOT relevant', () => {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    const scripts = { ...(head['scripts'] as Record<string, unknown>) };
    scripts['test:custom'] = 'bun scripts/custom-test.ts';
    head['scripts'] = scripts;

    const result = classifyPr({
      headManifest: JSON.stringify(head),
    });
    expect(result.relevant).toBe(false);
  });

  it('removing an unrelated named script is NOT relevant', () => {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    const scripts = { ...(head['scripts'] as Record<string, unknown>) };
    delete scripts['build'];
    delete scripts['lint'];
    head['scripts'] = scripts;

    const result = classifyPr({
      headManifest: JSON.stringify(head),
    });
    expect(result.relevant).toBe(false);
  });
});

describe('windows-relevance: lifecycle scripts ARE relevant', () => {
  it('changing postinstall script is relevant', () => {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    const scripts = { ...(head['scripts'] as Record<string, unknown>) };
    scripts['postinstall'] = 'node scripts/postinstall-v2.cjs';
    head['scripts'] = scripts;

    const result = classifyPr({
      headManifest: JSON.stringify(head),
    });
    expect(result.relevant).toBe(true);
    expect(result.reason).toContain('lifecycle');
  });

  it('adding a prepare script is relevant', () => {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    const scripts = { ...(head['scripts'] as Record<string, unknown>) };
    scripts['prepare'] = 'bun scripts/prepare.ts';
    head['scripts'] = scripts;

    const result = classifyPr({
      headManifest: JSON.stringify(head),
    });
    expect(result.relevant).toBe(true);
  });

  it('removing a lifecycle script is relevant', () => {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    const scripts = { ...(head['scripts'] as Record<string, unknown>) };
    delete scripts['postinstall'];
    head['scripts'] = scripts;

    const result = classifyPr({
      headManifest: JSON.stringify(head),
    });
    expect(result.relevant).toBe(true);
  });
});

describe('windows-relevance: install/package metadata is relevant', () => {
  it('changing workspaces array is relevant', () => {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    head['workspaces'] = ['packages/core', 'packages/cli', 'packages/new'];
    const result = classifyPr({ headManifest: JSON.stringify(head) });
    expect(result.relevant).toBe(true);
    expect(result.reason).toContain('workspaces');
  });

  it('changing dependencies is relevant', () => {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    head['dependencies'] = { bun: '1.3.15' };
    const result = classifyPr({ headManifest: JSON.stringify(head) });
    expect(result.relevant).toBe(true);
    expect(result.reason).toContain('dependencies');
  });

  it('changing overrides is relevant', () => {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    head['overrides'] = { typescript: '5.9.0' };
    const result = classifyPr({ headManifest: JSON.stringify(head) });
    expect(result.relevant).toBe(true);
  });

  it('changing engines is relevant', () => {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    head['engines'] = { node: '>=26' };
    const result = classifyPr({ headManifest: JSON.stringify(head) });
    expect(result.relevant).toBe(true);
  });

  it('changing packageManager is relevant', () => {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    head['packageManager'] = 'npm@12.0.0';
    const result = classifyPr({ headManifest: JSON.stringify(head) });
    expect(result.relevant).toBe(true);
  });

  it('adding trustedDependencies is relevant', () => {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    head['trustedDependencies'] = ['sharp'];
    const result = classifyPr({ headManifest: JSON.stringify(head) });
    expect(result.relevant).toBe(true);
  });
});

describe('windows-relevance: unknown top-level fields fail closed', () => {
  it('adding an unknown top-level key is relevant', () => {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    head['unknownFutureField'] = 'something';
    const result = classifyPr({ headManifest: JSON.stringify(head) });
    expect(result.relevant).toBe(true);
    expect(result.reason).toContain('unknownFutureField');
  });
});

describe('windows-relevance: formatting and key order are no-ops', () => {
  it('re-serialized manifest with same content is not relevant', () => {
    const reformatted = JSON.stringify(
      JSON.parse(BASE_MANIFEST) as Record<string, unknown>,
      null,
      4,
    );
    const result = classifyPr({
      headManifest: reformatted,
      baseManifest: BASE_MANIFEST,
    });
    expect(result.relevant).toBe(false);
  });

  it('reordered keys produce the same semantic diff', () => {
    const reordered: Record<string, unknown> = {};
    const base = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    for (const key of Object.keys(base).reverse()) {
      reordered[key] = base[key];
    }
    const result = classifyPr({
      headManifest: JSON.stringify(reordered),
      baseManifest: BASE_MANIFEST,
    });
    expect(result.relevant).toBe(false);
  });
});

describe('windows-relevance: lockfile and direct paths are relevant', () => {
  it('root package-lock.json change is relevant', () => {
    const result = classifyPr({
      changedEntries: [entry('package.json'), entry('package-lock.json')],
      changedFilesCount: 2,
    });
    expect(result.relevant).toBe(true);
    expect(result.reason).toContain('lockfile');
  });

  it('.nvmrc change is relevant', () => {
    const result = classifyPr({
      changedEntries: [entry('.nvmrc')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('.bun-version change is relevant', () => {
    const result = classifyPr({
      changedEntries: [entry('.bun-version')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('.npmrc change is relevant (install/pack config)', () => {
    const result = classifyPr({
      changedEntries: [entry('.npmrc')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('packages/cli/bin/ change is relevant', () => {
    const result = classifyPr({
      changedEntries: [entry('packages/cli/bin/llxprt')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('packages/cli/package.json change is relevant', () => {
    const result = classifyPr({
      changedEntries: [entry('packages/cli/package.json')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('workspace manifest (packages/core/package.json) is relevant', () => {
    const result = classifyPr({
      changedEntries: [entry('packages/core/package.json')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
    expect(result.reason).toContain('workspace manifest');
  });

  it('windows smoke module change is relevant', () => {
    const result = classifyPr({
      changedEntries: [
        entry('scripts/windows-installed-command-smoke/checks.cjs'),
      ],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('release-pack helper change is relevant', () => {
    const result = classifyPr({
      changedEntries: [entry('scripts/tests/issue-2603-release-pack.cjs')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('workflow YAML change is relevant', () => {
    const result = classifyPr({
      changedEntries: [
        entry('.github/workflows/windows-installed-command.yml'),
      ],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });
});

describe('windows-relevance: release/install helper closure is relevant', () => {
  it('scripts/lib/npm-command.cjs is relevant (smoke + release-pack consume it)', () => {
    const result = classifyPr({
      changedEntries: [entry('scripts/lib/npm-command.cjs')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('scripts/lib/tar-command.cjs is relevant (release-pack consumes it)', () => {
    const result = classifyPr({
      changedEntries: [entry('scripts/lib/tar-command.cjs')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('scripts/utils/release-packages.ts is relevant (bind-release-deps consumes it)', () => {
    const result = classifyPr({
      changedEntries: [entry('scripts/utils/release-packages.ts')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('scripts/utils/error-guards.ts is relevant (bind-release-deps consumes it)', () => {
    const result = classifyPr({
      changedEntries: [entry('scripts/utils/error-guards.ts')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('scripts/bind-release-deps.ts is relevant', () => {
    const result = classifyPr({
      changedEntries: [entry('scripts/bind-release-deps.ts')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('scripts/prepare-package.ts is relevant', () => {
    const result = classifyPr({
      changedEntries: [entry('scripts/prepare-package.ts')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });
});

describe('windows-relevance: mixed changes run when any input is relevant', () => {
  it('unrelated script + lockfile change is relevant', () => {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    const scripts = { ...(head['scripts'] as Record<string, unknown>) };
    scripts['lint:doc-links'] = 'bun scripts/check-doc-links.ts';
    head['scripts'] = scripts;

    const result = classifyPr({
      changedEntries: [entry('package.json'), entry('package-lock.json')],
      changedFilesCount: 2,
      headManifest: JSON.stringify(head),
    });
    expect(result.relevant).toBe(true);
  });

  it('unrelated script + smoke module is relevant', () => {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    const scripts = { ...(head['scripts'] as Record<string, unknown>) };
    scripts['lint:custom'] = 'bun scripts/custom.ts';
    head['scripts'] = scripts;

    const result = classifyPr({
      changedEntries: [
        entry('package.json'),
        entry('scripts/windows-installed-command-smoke.cjs'),
      ],
      changedFilesCount: 2,
      headManifest: JSON.stringify(head),
    });
    expect(result.relevant).toBe(true);
  });
});

describe('windows-relevance: deletion of relevant inputs runs', () => {
  it('deleting package-lock.json is relevant', () => {
    const result = classifyPr({
      changedEntries: [entry('package-lock.json', 'removed')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('deleting .nvmrc is relevant', () => {
    const result = classifyPr({
      changedEntries: [entry('.nvmrc', 'removed')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('deleting a release helper (npm-command.cjs) is relevant', () => {
    const result = classifyPr({
      changedEntries: [entry('scripts/lib/npm-command.cjs', 'removed')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('deleting the smoke orchestrator is relevant', () => {
    const result = classifyPr({
      changedEntries: [
        entry('scripts/windows-installed-command-smoke.cjs', 'removed'),
      ],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });
});

describe('windows-relevance: rename of relevant inputs runs (either side)', () => {
  it('renaming a relevant helper to a new name is relevant (old side)', () => {
    const result = classifyPr({
      changedEntries: [
        entry(
          'scripts/lib/npm-command-v2.cjs',
          'renamed',
          'scripts/lib/npm-command.cjs',
        ),
      ],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('renaming an irrelevant file to a relevant name is relevant (new side)', () => {
    const result = classifyPr({
      changedEntries: [
        entry(
          'scripts/lib/npm-command.cjs',
          'renamed',
          'scripts/lib/old-helper.cjs',
        ),
      ],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('renaming a lockfile away is relevant (old side)', () => {
    const result = classifyPr({
      changedEntries: [
        entry('package-lock-v2.json', 'renamed', 'package-lock.json'),
      ],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('renaming two irrelevant docs does not run (negative control)', () => {
    const result = classifyPr({
      changedEntries: [entry('docs/new.md', 'renamed', 'docs/old.md')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(false);
  });
});

describe('windows-relevance: packed-asset deletion vs ordinary doc edit', () => {
  it('deleting README.md is relevant (required packed asset)', () => {
    const result = classifyPr({
      changedEntries: [entry('README.md', 'removed')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('deleting LICENSE is relevant (required packed asset)', () => {
    const result = classifyPr({
      changedEntries: [entry('LICENSE', 'removed')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('modifying README.md (ordinary doc content) is NOT relevant', () => {
    const result = classifyPr({
      changedEntries: [entry('README.md', 'modified')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(false);
  });

  it('modifying LICENSE (ordinary doc content) is NOT relevant', () => {
    const result = classifyPr({
      changedEntries: [entry('LICENSE', 'modified')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(false);
  });

  it('renaming away from README.md is relevant (effective deletion)', () => {
    const result = classifyPr({
      changedEntries: [entry('docs/readme.md', 'renamed', 'README.md')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(true);
  });

  it('renaming to README.md is NOT relevant (doc content now at README)', () => {
    const result = classifyPr({
      changedEntries: [entry('README.md', 'renamed', 'docs/old-readme.md')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(false);
  });

  it('adding README.md is NOT relevant', () => {
    const result = classifyPr({
      changedEntries: [entry('README.md', 'added')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(false);
  });
});

describe('windows-relevance: malformed/missing manifests fail closed', () => {
  it('unparseable base manifest fails closed', () => {
    const result = classifyPr({
      baseManifest: '{ this is not valid json',
    });
    expect(result.relevant).toBe(true);
    expect(result.reason).toContain('could not be parsed');
  });

  it('unparseable head manifest fails closed', () => {
    const result = classifyPr({
      headManifest: 'not json at all',
    });
    expect(result.relevant).toBe(true);
  });

  it('missing base manifest fails closed', () => {
    const result = classifyPr({
      baseManifest: undefined,
    });
    expect(result.relevant).toBe(true);
  });

  it('base manifest that is a JSON array (not object) fails closed', () => {
    const result = classifyPr({
      baseManifest: '[1, 2, 3]',
    });
    expect(result.relevant).toBe(true);
  });
});

describe('windows-relevance: no relevant path and no manifest change skips', () => {
  it('only a docs file changed (no manifest) skips', () => {
    const result = classifyPr({
      changedEntries: [entry('docs/index.md')],
      changedFilesCount: 1,
    });
    expect(result.relevant).toBe(false);
  });
});

describe('windows-relevance: compareRootManifests direct tests', () => {
  it('identical manifests are not relevant', () => {
    const base = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    const result = compareRootManifests(base, { ...base });
    expect(result.relevant).toBe(false);
  });

  it('version-only change is not relevant', () => {
    const base = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    const head = { ...base, version: '0.12.0' };
    const result = compareRootManifests(base, head);
    expect(result.relevant).toBe(false);
  });

  it('description change is not relevant', () => {
    const base = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    const head = { ...base, description: 'new description' };
    const result = compareRootManifests(base, head);
    expect(result.relevant).toBe(false);
  });

  it('bin change is relevant', () => {
    const base = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    const head = { ...base, bin: { llxprt: 'packages/cli/bin/llxprt' } };
    const result = compareRootManifests(base, head);
    expect(result.relevant).toBe(true);
  });
});

describe('windows-relevance: gh api argument construction', () => {
  it('buildManifestApiArgs forces GET method (gh defaults to POST with -f)', () => {
    const args = buildManifestApiArgs('vybestack/llxprt-code', 'abc123');
    // gh api -f <param> defaults to POST; --method GET is REQUIRED so the
    // contents endpoint is read (not written to). Without this, a #2686
    // root-manifest-only change cannot reliably fetch the base manifest.
    const methodIndex = args.indexOf('--method');
    expect(methodIndex).toBeGreaterThanOrEqual(0);
    expect(args[methodIndex + 1]).toBe('GET');
  });

  it('buildManifestApiArgs uses -f ref= (query param), not -q (jq alias)', () => {
    const args = buildManifestApiArgs('vybestack/llxprt-code', 'abc123');
    // The ref must be a query parameter via -f, NOT a jq query via -q/--jq.
    expect(args).toContain('-f');
    expect(args).toContain('ref=abc123');
    // There must be exactly one jq selector, and it must request .content.
    const jqIndices = args
      .map((a, i) => (a === '--jq' ? i : -1))
      .filter((i) => i >= 0);
    expect(jqIndices.length).toBe(1);
    expect(args[jqIndices[0] + 1]).toBe('.content');
    // No -q flag (short alias of --jq) misused for the ref.
    expect(args).not.toContain('-q');
  });

  it('buildManifestApiArgs targets the contents endpoint with the manifest path', () => {
    const args = buildManifestApiArgs('owner/repo', 'sha');
    expect(args.some((a) => a === 'api')).toBe(true);
    expect(args).toContain('repos/owner/repo/contents/package.json');
  });

  it('buildChangedFilesApiArgs fetches structured entries (.[]), not filenames only', () => {
    const args = buildChangedFilesApiArgs('owner/repo', '42');
    expect(args).toContain('--paginate');
    expect(args.some((a) => a === 'repos/owner/repo/pulls/42/files')).toBe(
      true,
    );
    // Must request full entries (.[]), not .[].filename.
    expect(args).toContain('.[]');
    expect(args).not.toContain('.[].filename');
  });
});

describe('windows-relevance: mutation sanity (fail-closed decisions)', () => {
  it('the PR #2686 exact negative case (lint:doc-links + lint:doc-placement)', () => {
    const head = JSON.parse(BASE_MANIFEST) as Record<string, unknown>;
    const scripts = { ...(head['scripts'] as Record<string, unknown>) };
    scripts['lint:doc-links'] = 'bun scripts/check-doc-links.ts';
    scripts['lint:doc-placement'] = 'bun scripts/check-doc-placement.ts';
    head['scripts'] = scripts;

    const result = classifyWindowsRelevance({
      event: 'pull_request',
      changedEntries: [entry('package.json')],
      changedFilesCount: 1,
      baseManifest: BASE_MANIFEST,
      headManifest: JSON.stringify(head),
    });
    expect(result.relevant).toBe(false);
  });

  it('PRs #2610 and #3086 shape (launcher/installer change) is relevant', () => {
    const result = classifyWindowsRelevance({
      event: 'pull_request',
      changedEntries: [
        entry('packages/cli/bin/llxprt'),
        entry('packages/cli/scripts/install-native-launchers.cjs'),
      ],
      changedFilesCount: 2,
      baseManifest: BASE_MANIFEST,
      headManifest: BASE_MANIFEST,
    });
    expect(result.relevant).toBe(true);
  });
});
