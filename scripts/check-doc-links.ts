#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * check-doc-links.ts (issue #2654)
 *
 * Recursively scans docs/ and dev-docs/ for Markdown, validates every
 * repo-relative link target exists, and validates in-file #anchors
 * against GitHub heading slugs. Exits non-zero when any break is found.
 *
 * Usage: scripts/check-doc-links.ts
 * Test override: set DOC_GUARD_ROOT=<dir> to scan a temp tree instead.
 */

import { relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractLinks, type DocLink } from './doc-links/markdown-links.ts';
import { fragmentMatches } from './doc-links/heading-slugger.ts';
import {
  collectMarkdownFiles,
  collectRootMarkdownFiles,
  readFileText,
  resolveTarget,
  isFile,
  isDirectory,
  dirHasIndex,
  isWithinRoot,
  RootMissingError,
} from './doc-links/file-scanner.ts';
import { loadLycheeignore, isIgnored } from './doc-links/lycheeignore.ts';

const EXIT_PASS = 0;
const EXIT_FAIL = 1;

interface Break {
  readonly file: string;
  readonly target: string;
  readonly reason: string;
}

function getRoots(): { roots: string[]; root: string } {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const root = process.env.DOC_GUARD_ROOT
    ? resolve(process.env.DOC_GUARD_ROOT)
    : resolve(scriptDir, '..');
  return {
    root,
    roots: [resolve(root, 'docs'), resolve(root, 'dev-docs')],
  };
}

function checkLink(
  link: DocLink,
  fromFile: string,
  lycheePatterns: readonly string[],
  root: string,
): string | undefined {
  if (link.isExternal) {
    // Apply .lycheeignore filtering for external links
    if (isIgnored(link.target, lycheePatterns)) {
      return undefined;
    }
    return undefined; // External links are not checked (no network access)
  }
  const target = link.target;
  if (target === '') {
    return checkLocalFragment(link, fromFile);
  }
  const absTarget = resolveTarget(fromFile, target);
  if (!absTarget) return undefined;

  // Containment check: resolved target must stay within the repository root
  if (!isWithinRoot(absTarget, root)) {
    return `${target} resolves outside the repository`;
  }

  // Check if it's a directory — directories must have index.md or README.md
  if (isDirectory(absTarget)) {
    if (!dirHasIndex(absTarget)) {
      return `${target} is a directory without index.md or README.md`;
    }
    return checkFragment(link, fromFile, resolve(absTarget, 'index.md'));
  }

  // Check if it's a file
  if (isFile(absTarget)) {
    return checkFragment(link, fromFile, absTarget);
  }

  return `${target} does not exist`;
}

function checkLocalFragment(
  link: DocLink,
  fromFile: string,
): string | undefined {
  if (!link.fragment) return undefined;
  return fragmentMatches(readFileText(fromFile), link.fragment)
    ? undefined
    : `anchor #${link.fragment} not found in ${relativePath(fromFile)}`;
}

function checkFragment(
  link: DocLink,
  fromFile: string,
  absTarget: string,
): string | undefined {
  if (!link.fragment) return undefined;
  // Fragments can only be validated against Markdown heading slugs.
  // For non-Markdown targets, report the fragment so it is not silently ignored.
  if (!absTarget.endsWith('.md')) {
    return `anchor #${link.fragment} cannot be checked on non-Markdown target ${relativePath(absTarget)}`;
  }
  const targetContent = readFileText(absTarget);
  return fragmentMatches(targetContent, link.fragment)
    ? undefined
    : `anchor #${link.fragment} not found in ${relativePath(absTarget)}`;
}

function relativePath(absPath: string): string {
  const { root } = getRoots();
  return relative(root, absPath).replace(/\\/g, '/');
}

function scanFile(
  filePath: string,
  lycheePatterns: readonly string[],
  root: string,
): readonly Break[] {
  let content: string;
  try {
    content = readFileText(filePath);
  } catch {
    return [
      { file: relativePath(filePath), target: '', reason: 'unreadable file' },
    ];
  }
  const links = extractLinks(content);
  const breaks: Break[] = [];
  for (const link of links) {
    const reason = checkLink(link, filePath, lycheePatterns, root);
    if (reason) {
      breaks.push({
        file: relativePath(filePath),
        target: formatTarget(link),
        reason,
      });
    }
  }
  return breaks;
}

function formatTarget(link: DocLink): string {
  return link.fragment ? `${link.target}#${link.fragment}` : link.target;
}

function main(): number {
  const { roots, root } = getRoots();

  // Collect files, failing fast if expected roots are missing
  let files: string[];
  try {
    files = [...collectMarkdownFiles(roots), ...collectRootMarkdownFiles(root)];
  } catch (error) {
    if (error instanceof RootMissingError) {
      console.error(`doc-links guard FATAL: ${error.message}`);
      return EXIT_FAIL;
    }
    throw error;
  }

  const lycheePatterns = loadLycheeignore(root);
  const allBreaks: Break[] = [];
  for (const file of files) {
    allBreaks.push(...scanFile(file, lycheePatterns, root));
  }
  if (allBreaks.length === 0) {
    console.log('doc-links guard PASSED');
    return EXIT_PASS;
  }
  console.log(`doc-links guard FAILED: ${allBreaks.length} broken link(s)`);
  for (const brk of allBreaks) {
    console.log(`  ${brk.file} -> ${brk.target}: ${brk.reason}`);
  }
  return EXIT_FAIL;
}

if (process.argv[1]) {
  const entryUrl = fileURLToPath(`file://${process.argv[1]}`);
  if (
    entryUrl === import.meta.url ||
    process.argv[1].endsWith('check-doc-links.ts')
  ) {
    process.exit(main());
  }
}
