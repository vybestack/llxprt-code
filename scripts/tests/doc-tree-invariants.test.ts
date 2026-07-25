/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real-repo invariants for the docs/ tree (issue #2654).
 *
 * These assert actual, current repository state — not fixtures. They
 * encode the acceptance criteria that the relocation and rewrite work
 * produced and must maintain.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { repoRoot } from './doc-guard-helpers.ts';
import { extractHeadingSlugs } from '../doc-links/heading-slugger.ts';
import { collectMarkdownFiles } from '../doc-links/file-scanner.ts';

const DOCS = join(repoRoot, 'docs');

function readFile(relPath: string): string {
  return readFileSync(join(repoRoot, relPath), 'utf8');
}

/**
 * Every Markdown file under a repo-relative directory, as repo-relative
 * paths. Reuses the guard's own scanner so these invariants see exactly the
 * same file set the guard enforces against.
 */
function collectMarkdownUnder(relDir: string): string[] {
  return collectMarkdownFiles([join(repoRoot, relDir)]).map((p) =>
    relative(repoRoot, p),
  );
}

function fileExists(relPath: string): boolean {
  return existsSync(join(repoRoot, relPath));
}

/**
 * Check if a directory contains a given entry name.
 * Fails fast if the parent directory itself is missing (not just the entry).
 */
function dirContains(dir: string, name: string): boolean {
  if (!existsSync(dir)) {
    throw new Error(`Expected directory does not exist: ${dir}`);
  }
  try {
    // Match directories only: callers assert that internal-only directories
    // are absent, and a same-named file must not satisfy that check.
    return readdirSync(dir, { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && entry.name === name,
    );
  } catch (error) {
    throw new Error(`Cannot read directory ${dir}: ${String(error)}`);
  }
}

/**
 * Recursively search the repository for Markdown files containing a marker
 * string. Only `.md` files are inspected. Excludes node_modules, .git, dist,
 * bundle, coverage, .integration-tests, and project-plans.
 */
function searchRepoForMarker(marker: string): string[] {
  const excludeDirs = new Set([
    'node_modules',
    '.git',
    'dist',
    'bundle',
    'coverage',
    '.integration-tests',
    'project-plans',
  ]);
  const results: string[] = [];
  collectFilesWithMarker(repoRoot, marker, excludeDirs, results);
  return results;
}

function isBenignFsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

function processMarkerEntry(
  entry: { name: string; isDirectory(): boolean; isFile(): boolean },
  dir: string,
  marker: string,
  excludeDirs: Set<string>,
  results: string[],
): void {
  if (excludeDirs.has(entry.name)) return;
  const full = join(dir, entry.name);
  if (entry.isDirectory()) {
    collectFilesWithMarker(full, marker, excludeDirs, results);
    // Case-insensitive to match isMarkdown() in the guard itself, so this
    // scanner cannot miss a violation living in a .MD file.
  } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
    checkFileForMarker(full, marker, results);
  }
}

function collectFilesWithMarker(
  dir: string,
  marker: string,
  excludeDirs: Set<string>,
  results: string[],
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    // A directory we cannot enumerate is unscanned, so an absence assertion
    // built on this walk would be vacuously true. Only ENOENT is benign
    // (a path removed mid-walk); anything else must fail loudly.
    if (isBenignFsError(error)) return;
    throw error;
  }
  for (const entry of entries) {
    processMarkerEntry(entry, dir, marker, excludeDirs, results);
  }
}

function checkFileForMarker(
  full: string,
  marker: string,
  results: string[],
): void {
  try {
    const content = readFileSync(full, 'utf8');
    if (content.includes(marker)) {
      results.push(relative(repoRoot, full));
    }
  } catch (error) {
    // An unread file is an unchecked file, which would silently weaken the
    // "no bookkeeping markers anywhere" assertion. Tolerate only ENOENT.
    if (isBenignFsError(error)) return;
    throw error;
  }
}

describe('doc-tree invariants (real repo state)', () => {
  describe('internal-only directories removed from docs/', () => {
    it('docs/ contains no architecture/ directory', () => {
      expect(dirContains(DOCS, 'architecture')).toBe(false);
    });

    it('docs/ contains no plans/ directory', () => {
      expect(dirContains(DOCS, 'plans')).toBe(false);
    });

    it('docs/ contains no merge-notes/ directory', () => {
      expect(dirContains(DOCS, 'merge-notes')).toBe(false);
    });
  });

  describe('relocated documents', () => {
    it('each relocated document exists at its new dev-docs/ path', () => {
      const newPaths = [
        'dev-docs/architecture/message-bus.md',
        'dev-docs/hooks/architecture.md',
        'dev-docs/tools/tool-output-format.md',
        'dev-docs/providers/text-tool-call-parsing.md',
        'dev-docs/merge-notes/2026-01-06-batches21-25-skipped.md',
        'dev-docs/plans/archive/2026-01-03-welcome-onboarding.md',
        'dev-docs/agent-api.md',
      ];
      for (const p of newPaths) {
        expect(fileExists(p)).toBe(true);
      }
    });

    it('no relocated document remains at its old docs/ path', () => {
      // docs/tool-parsing.md is deliberately absent from this list: its
      // internals moved to dev-docs/providers/text-tool-call-parsing.md, but
      // the docs/ path was reused for a new user-facing settings page rather
      // than deleted. That case is covered by the test below.
      const oldPaths = [
        'docs/architecture/message-bus-architecture.md',
        'docs/hooks/architecture.md',
        'docs/tool-output-format.md',
        'docs/merge-notes/batch21-25-skipped.md',
        'docs/plans/2026-01-03-welcome-onboarding.md',
        'docs/agent-api.md',
      ];
      for (const p of oldPaths) {
        expect(fileExists(p)).toBe(false);
      }
    });

    it('docs/tool-parsing.md is retained as a user-facing page', () => {
      expect(fileExists('docs/tool-parsing.md')).toBe(true);
    });

    it('obsolete user-facing records are removed rather than relocated', () => {
      expect(fileExists('docs/migration/stateless-provider-v2.md')).toBe(false);
      expect(fileExists('docs/release-notes/2025Q4.md')).toBe(false);
    });

    it('the emoji filter page uses a lowercase filename like its peers', () => {
      // Compare against the real directory listing rather than existsSync:
      // macOS is case-insensitive, so existsSync('docs/EMOJI-FILTER.md')
      // returns true even after the file has been renamed to lowercase.
      const names = readdirSync(DOCS).filter((n) => /emoji/i.test(n));
      expect(names).toEqual(['emoji-filter.md']);
    });
  });

  describe('audience separation', () => {
    it('no user-facing page under docs/ links into dev-docs/', () => {
      const offenders = collectMarkdownUnder('docs').filter((p) =>
        /\]\([^)]*dev-docs\//.test(readFile(p)),
      );
      expect(offenders).toEqual([]);
    });

    it('no page under docs/ deep-links to blob or tree URLs on GitHub', () => {
      // These break when the docs are published to vybestack.dev: they escape
      // the site and land on the raw GitHub view instead of the rendered page.
      const offenders = collectMarkdownUnder('docs').filter((p) =>
        /github\.com\/vybestack\/llxprt-code\/(blob|tree)\//.test(readFile(p)),
      );
      expect(offenders).toEqual([]);
    });
  });

  describe('keybindings generator single-target', () => {
    it('exactly one file in the entire repo carries KEYBINDINGS-AUTOGEN:START', () => {
      const found = searchRepoForMarker('KEYBINDINGS-AUTOGEN:START');
      expect(found).toEqual(['docs/keyboard-shortcuts.md']);
    });
  });

  describe('telemetry doc accuracy', () => {
    it('docs/telemetry.md does not claim telemetry is commented out', () => {
      const content = readFile('docs/telemetry.md');
      expect(content).not.toMatch(/commented out/i);
    });

    it('docs/telemetry.md does not claim source modification is required', () => {
      const content = readFile('docs/telemetry.md');
      expect(content).not.toMatch(/modify the source/i);
      expect(content).not.toMatch(/source changes are required/i);
      expect(content).not.toMatch(/re-enable.*source code/i);
    });

    it('docs/telemetry.md uses llxprt_code.* event names (not llxprt_cli.*)', () => {
      const content = readFile('docs/telemetry.md');
      expect(content).not.toMatch(/llxprt_cli\./);
      expect(content).toMatch(/llxprt_code\./);
    });

    it('docs/telemetry.md documents --no-telemetry for session disable', () => {
      const content = readFile('docs/telemetry.md');
      expect(content).toMatch(/--no-telemetry/);
    });
  });

  describe('Uninstall doc', () => {
    it('does not mention gemini-cli', () => {
      const content = readFile('docs/Uninstall.md');
      expect(content).not.toMatch(/gemini-cli/i);
    });

    it('documents Homebrew uninstall', () => {
      const content = readFile('docs/Uninstall.md');
      expect(content).toMatch(/brew uninstall llxprt-code/);
    });

    it('references application directories for complete data removal', () => {
      const content = readFile('docs/Uninstall.md');
      expect(content).toMatch(/application-directories/);
    });
  });

  describe('hooks best-practices repair', () => {
    it('retains a heading that slugs to using-hooks-securely', () => {
      const content = readFile('docs/hooks/best-practices.md');
      const slugs = extractHeadingSlugs(content);
      expect(slugs.has('using-hooks-securely')).toBe(true);
    });

    it('SECRET_PATTERNS array is defined exactly once', () => {
      const content = readFile('docs/hooks/best-practices.md');
      const count = (content.match(/const SECRET_PATTERNS/g) ?? []).length;
      expect(count).toBe(1);
    });

    it('every fenced code block is balanced (no orphaned fragment)', () => {
      const content = readFile('docs/hooks/best-practices.md');
      // Count backtick and tilde fences of any length; docs in this repo use
      // four-backtick fences to wrap examples that themselves contain fences.
      // CommonMark permits up to three leading spaces on a fence, so allow
      // them here - anchoring at column 0 would silently count zero fences in
      // an indented block and make this assertion vacuously pass.
      const fenceCount = (content.match(/^ {0,3}(?:`{3,}|~{3,})/gm) ?? [])
        .length;
      expect(fenceCount % 2).toBe(0);
    });

    it('does not claim telemetry.logPrompts governs hook I/O logging', () => {
      const content = readFile('docs/hooks/best-practices.md');
      // The corrected doc must explicitly state logPrompts does NOT control hook I/O
      expect(content).toMatch(/logPrompts.*?does.*?not.*?(?:control|govern)/i);
    });
  });

  describe('CONTRIBUTING references the style guide', () => {
    it('CONTRIBUTING.md links to the documentation style guide', () => {
      const content = readFile('CONTRIBUTING.md');
      expect(content).toMatch(/documentation-style-guide/);
    });
  });
});
