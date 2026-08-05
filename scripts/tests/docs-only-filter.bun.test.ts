/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the documentation-only change detector (issue #342).
 *
 * These exercise the EXPORTED pure classifier functions from
 * `scripts/docs-only-filter.ts` against realistic structured GitHub PR file
 * entries, plus a cross-classifier invariant check against the REAL
 * `scripts/affected-test-shards.ts` selector.
 */

import { describe, it, expect } from 'bun:test';
import {
  classifyDocsOnly,
  classifyEntry,
  classifyPath,
  gitignoreIsDocs,
  type ChangedFileEntry,
} from '../docs-only-filter.ts';
import { selectAffectedShards } from '../affected-test-shards.ts';

/** Builds a single structured file entry. */
function entry(
  filename: string,
  extra: Partial<Omit<ChangedFileEntry, 'filename'>> = {},
): ChangedFileEntry {
  return { filename, status: 'modified', ...extra };
}

describe('docs-only-filter: pure docs changes are docs-only', () => {
  it('a change set of only documentation paths is docs-only', () => {
    const entries = [
      entry('docs/index.md'),
      entry('README.md'),
      entry('dev-docs/bun.md'),
      entry('project-plans/issue342/plan.md'),
    ];
    const result = classifyDocsOnly({ entries, changedFiles: entries.length });
    expect(result.docsOnly).toBe(true);
  });
});

describe('docs-only-filter: runtime prompt inputs are NOT docs (fail-open fix)', () => {
  it('packages/core/src/prompt-config/defaults/core.md is CODE — the exact review fail-open', () => {
    // Regression guard: this .md file is a RUNTIME PROMPT INPUT embedded into
    // the built prompt manifest and loaded at runtime. It MUST NOT be docs.
    const entries = [entry('packages/core/src/prompt-config/defaults/core.md')];
    const result = classifyDocsOnly({
      entries,
      changedFiles: entries.length,
    });
    expect(result.docsOnly).toBe(false);
  });

  it('packages/core/src/core/legacy-model-limits.expected.txt (test fixture) is CODE', () => {
    const entries = [
      entry('packages/core/src/core/legacy-model-limits.expected.txt'),
    ];
    const result = classifyDocsOnly({
      entries,
      changedFiles: entries.length,
    });
    expect(result.docsOnly).toBe(false);
  });

  it('packages/cli/src/providers/README.md (packaged source) is CODE', () => {
    const entries = [entry('packages/cli/src/providers/README.md')];
    const result = classifyDocsOnly({
      entries,
      changedFiles: entries.length,
    });
    expect(result.docsOnly).toBe(false);
  });

  it('.github/pull_request_template.md is CODE', () => {
    const entries = [entry('.github/pull_request_template.md')];
    const result = classifyDocsOnly({
      entries,
      changedFiles: entries.length,
    });
    expect(result.docsOnly).toBe(false);
  });

  it('integration-tests/TESTING_STRATEGY.md is CODE', () => {
    const entries = [entry('integration-tests/TESTING_STRATEGY.md')];
    const result = classifyDocsOnly({
      entries,
      changedFiles: entries.length,
    });
    expect(result.docsOnly).toBe(false);
  });
});

describe('docs-only-filter: mixed changes are not docs-only', () => {
  it('one docs file plus one .ts file is not docs-only', () => {
    const entries = [
      entry('docs/index.md'),
      entry('packages/core/src/index.ts'),
    ];
    const result = classifyDocsOnly({
      entries,
      changedFiles: entries.length,
    });
    expect(result.docsOnly).toBe(false);
  });

  it('an unknown/unclassified path is not docs-only', () => {
    const entries = [entry('some-new-top-level-thing/x.json')];
    const result = classifyDocsOnly({
      entries,
      changedFiles: entries.length,
    });
    expect(result.docsOnly).toBe(false);
  });
});

describe('docs-only-filter: rename handling', () => {
  it('rename packages/core/src/foo.ts -> docs/foo.md is not docs-only', () => {
    const e = entry('docs/foo.md', {
      status: 'renamed',
      previous_filename: 'packages/core/src/foo.ts',
    });
    const result = classifyDocsOnly({
      entries: [e],
      changedFiles: 1,
    });
    expect(result.docsOnly).toBe(false);
  });

  it('rename docs/a.md -> docs/b.md is docs-only', () => {
    const e = entry('docs/b.md', {
      status: 'renamed',
      previous_filename: 'docs/a.md',
    });
    const result = classifyDocsOnly({
      entries: [e],
      changedFiles: 1,
    });
    expect(result.docsOnly).toBe(true);
  });

  it('rename .gitignore -> docs/notes.md is not docs-only (bypass closed)', () => {
    const e = entry('docs/notes.md', {
      status: 'renamed',
      previous_filename: '.gitignore',
    });
    const result = classifyDocsOnly({
      entries: [e],
      changedFiles: 1,
    });
    expect(result.docsOnly).toBe(false);
  });
});

describe('docs-only-filter: .gitignore carve-out', () => {
  it('.gitignore patch toggling only a docs/reference line is docs', () => {
    const patch =
      '@@ -1,1 +1,2 @@\n+# keep built docs/reference output\n+!docs/reference/\n';
    expect(gitignoreIsDocs(patch)).toBe(true);
    expect(classifyPath('.gitignore', patch)).toBe('docs');
  });

  it('.gitignore patch with any other content line is CODE', () => {
    const patch = '@@ -1,1 +1,2 @@\n+node_modules/\n';
    expect(gitignoreIsDocs(patch)).toBe(false);
    expect(classifyPath('.gitignore', patch)).toBe('code');
  });

  it('.gitignore with no patch available is CODE (fail closed)', () => {
    expect(gitignoreIsDocs(undefined)).toBe(false);
    expect(classifyPath('.gitignore', undefined)).toBe('code');
    expect(classifyEntry(entry('.gitignore'))).toBe('code');
  });
});

describe('docs-only-filter: GitHub API guards', () => {
  it('entry count < changed_files (API truncation) is not docs-only', () => {
    const entries = [entry('docs/index.md'), entry('README.md')];
    const result = classifyDocsOnly({ entries, changedFiles: 4000 });
    expect(result.docsOnly).toBe(false);
    expect(result.reason).toContain('truncation');
  });

  it('zero entries is not docs-only', () => {
    const result = classifyDocsOnly({ entries: [], changedFiles: 0 });
    expect(result.docsOnly).toBe(false);
  });

  // An unusable changed_files count must never let an all-docs entry list
  // through: without a trustworthy total we cannot know the API returned every
  // changed file. Each of these would otherwise be a fail-open.
  it.each([
    ['NaN', Number.NaN],
    ['undefined', undefined],
    ['negative', -1],
    ['fractional', 3.5],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('an unusable changed_files count (%s) fails closed', (_label, count) => {
    const entries = [entry('docs/index.md')];
    const result = classifyDocsOnly({ entries, changedFiles: count });
    expect(result.docsOnly).toBe(false);
    expect(result.reason).toContain('unusable changed_files count');
  });
});

describe('docs-only-filter: path classification unit cases', () => {
  it('classifies documentation prefixes as docs', () => {
    expect(classifyPath('docs/index.md')).toBe('docs');
    expect(classifyPath('dev-docs/bun.md')).toBe('docs');
    expect(classifyPath('project-plans/x/plan.md')).toBe('docs');
    expect(classifyPath('research/note.md')).toBe('docs');
  });

  it('classifies root-level documentation as docs', () => {
    expect(classifyPath('README.md')).toBe('docs');
    expect(classifyPath('README_CN.md')).toBe('docs');
    expect(classifyPath('CHANGELOG.md')).toBe('docs');
    expect(classifyPath('CONTRIBUTING.md')).toBe('docs');
    expect(classifyPath('CODE_OF_CONDUCT.md')).toBe('docs');
    expect(classifyPath('SECURITY.md')).toBe('docs');
    expect(classifyPath('ROADMAP.md')).toBe('docs');
    expect(classifyPath('AGENTS.md')).toBe('docs');
    expect(classifyPath('LICENSE_NOTE.md')).toBe('docs');
  });

  it('classifies all CODE prefixes as code regardless of extension', () => {
    expect(classifyPath('packages/cli/src/SKILL.md')).toBe('code');
    expect(classifyPath('scripts/foo.md')).toBe('code');
    expect(classifyPath('integration-tests/README.md')).toBe('code');
    expect(classifyPath('evals/readme.md')).toBe('code');
    expect(classifyPath('test-setup/x.md')).toBe('code');
    expect(classifyPath('test-scripts/x.md')).toBe('code');
    expect(classifyPath('shell-scripts/x.md')).toBe('code');
    expect(classifyPath('eslint-rules/x.md')).toBe('code');
    expect(classifyPath('schemas/x.md')).toBe('code');
    expect(classifyPath('profiles/x.md')).toBe('code');
    expect(classifyPath('.github/workflows/ci.yml')).toBe('code');
    expect(classifyPath('.husky/pre-commit')).toBe('code');
    expect(classifyPath('bundle/x.md')).toBe('code');
  });
});

describe('docs-only-filter: cross-classifier invariant', () => {
  // The invariant: anything docs-only-filter calls DOCS must select NO shards
  // for affected-test-shards. Being stricter is fine; being looser is a bug.
  it('every DOCS path selects no test shards (imports the real selector)', () => {
    const docsPaths = [
      'docs/index.md',
      'docs/reference/x.md',
      'dev-docs/bun.md',
      'project-plans/issue342/plan.md',
      'research/note.md',
      'README.md',
      'README_CN.md',
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'CODE_OF_CONDUCT.md',
      'SECURITY.md',
      'ROADMAP.md',
      'AGENTS.md',
      'SOMETHING.md',
      'NOTES.mdx',
      'NOTES.rst',
      'NOTES.txt',
      'NOTES.adoc',
    ];
    for (const p of docsPaths) {
      // Sanity: docs-only-filter agrees this is docs.
      expect(classifyPath(p), `${p} should be docs`).toBe('docs');
      const selection = selectAffectedShards({
        event: 'pull_request',
        changedPaths: [p],
      });
      expect(
        selection.selectedShards.length,
        `DOCS path '${p}' must select no shards, got [${selection.selectedShards.join(', ')}]`,
      ).toBe(0);
      expect(selection.hasTests).toBe(false);
    }
  });

  it('a .gitignore with a docs/reference-only patch is docs AND selects no shards', () => {
    const patch = '@@ -1,1 +1,2 @@\n+!docs/reference/\n';
    expect(classifyPath('.gitignore', patch)).toBe('docs');
    const selection = selectAffectedShards({
      event: 'pull_request',
      changedPaths: ['.gitignore'],
    });
    expect(selection.selectedShards.length).toBe(0);
  });
});
