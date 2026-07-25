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

const DOCS = join(repoRoot, 'docs');

function readFile(relPath: string): string {
  return readFileSync(join(repoRoot, relPath), 'utf8');
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
    return readdirSync(dir).includes(name);
  } catch (error) {
    throw new Error(`Cannot read directory ${dir}: ${String(error)}`);
  }
}

/**
 * Recursively search the repository for files containing a marker string,
 * excluding node_modules, .git, dist, bundle, coverage, and .integration-tests.
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
  } else if (entry.isFile() && entry.name.endsWith('.md')) {
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
  } catch {
    return;
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
  } catch {
    // unreadable file — skip
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
      ];
      for (const p of newPaths) {
        expect(fileExists(p)).toBe(true);
      }
    });

    it('no relocated document remains at its old docs/ path', () => {
      const oldPaths = [
        'docs/architecture/message-bus-architecture.md',
        'docs/hooks/architecture.md',
        'docs/tool-output-format.md',
        'docs/merge-notes/batch21-25-skipped.md',
        'docs/plans/2026-01-03-welcome-onboarding.md',
      ];
      for (const p of oldPaths) {
        expect(fileExists(p)).toBe(false);
      }
    });

    it('docs/tool-parsing.md still exists (user-facing settings page)', () => {
      expect(fileExists('docs/tool-parsing.md')).toBe(true);
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
      const fenceCount = (content.match(/^```/gm) ?? []).length;
      expect(fenceCount % 2).toBe(0);
    });

    it('does not claim telemetry.logPrompts governs hook I/O logging', () => {
      const content = readFile('docs/hooks/best-practices.md');
      // The corrected doc must explicitly state logPrompts does NOT control hook I/O
      expect(content).toMatch(
        /logPrompts.*does.*not.*control|does.*not.*govern/i,
      );
    });
  });

  describe('CONTRIBUTING references the style guide', () => {
    it('CONTRIBUTING.md links to the documentation style guide', () => {
      const content = readFile('CONTRIBUTING.md');
      expect(content).toMatch(/documentation-style-guide/);
    });
  });
});
