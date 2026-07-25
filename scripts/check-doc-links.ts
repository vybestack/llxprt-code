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
import {
  extractHeadingSlugs,
  fragmentMatchesSlugs,
} from './doc-links/heading-slugger.ts';
import {
  collectMarkdownFiles,
  collectRootMarkdownFiles,
  readFileText,
  resolveTarget,
  isFile,
  isDirectory,
  resolveIndexFile,
  isWithinRoot,
  RootMissingError,
} from './doc-links/file-scanner.ts';

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

/**
 * Per-source-file fragment context: the file's already-read content and its
 * pre-built heading-slug set. Computed once per file so that same-file
 * fragment links neither re-read the file nor re-lex it.
 */
interface FragmentContext {
  readonly content: string;
  readonly slugs: Set<string>;
}

/**
 * Lazily-computed slug-set cache for target documents. Each source file gets
 * its own cache (passed explicitly, no module-level global state). Target
 * documents are read and lexed at most once per source-file scan, even when
 * many fragment links point at the same target.
 */
type SlugCache = Map<string, FragmentContext>;

function checkLink(
  link: DocLink,
  fromFile: string,
  root: string,
  sourceCtx: FragmentContext,
  slugCache: SlugCache,
): string | undefined {
  if (link.isExternal) {
    // External links are never fetched (no network access in the guard).
    return undefined;
  }
  const target = link.target;
  if (target === '') {
    return checkLocalFragment(link, fromFile, sourceCtx);
  }
  const absTarget = resolveTarget(fromFile, target);
  if (!absTarget) return undefined;

  // Containment check: resolved target must stay within the repository root
  if (!isWithinRoot(absTarget, root)) {
    return `${target} resolves outside the repository`;
  }

  // Check if it's a directory — directories must have index.md or README.md
  if (isDirectory(absTarget)) {
    const indexFile = resolveIndexFile(absTarget);
    if (indexFile === undefined) {
      return `${target} is a directory without index.md or README.md`;
    }
    return checkFragment(link, indexFile, slugCache);
  }

  // Check if it's a file
  if (isFile(absTarget)) {
    return checkFragment(link, absTarget, slugCache);
  }

  return `${target} does not exist`;
}

function checkLocalFragment(
  link: DocLink,
  fromFile: string,
  sourceCtx: FragmentContext,
): string | undefined {
  if (!link.fragment) return undefined;
  return fragmentMatchesSlugs(sourceCtx.slugs, link.fragment)
    ? undefined
    : `anchor #${link.fragment} not found in ${relativePath(fromFile)}`;
}

function checkFragment(
  link: DocLink,
  absTarget: string,
  slugCache: SlugCache,
): string | undefined {
  if (!link.fragment) return undefined;
  // Fragments can only be validated against Markdown heading slugs.
  // For non-Markdown targets, report the fragment so it is not silently ignored.
  if (!absTarget.endsWith('.md')) {
    return `anchor #${link.fragment} cannot be checked on non-Markdown target ${relativePath(absTarget)}`;
  }
  const ctx = getFragmentContext(absTarget, slugCache);
  return fragmentMatchesSlugs(ctx.slugs, link.fragment)
    ? undefined
    : `anchor #${link.fragment} not found in ${relativePath(absTarget)}`;
}

/**
 * Read and lex a target document at most once per scan, caching the result.
 */
function getFragmentContext(
  filePath: string,
  slugCache: SlugCache,
): FragmentContext {
  let ctx = slugCache.get(filePath);
  if (ctx === undefined) {
    const content = readFileText(filePath);
    ctx = { content, slugs: extractHeadingSlugs(content) };
    slugCache.set(filePath, ctx);
  }
  return ctx;
}

function relativePath(absPath: string): string {
  const { root } = getRoots();
  return relative(root, absPath).replace(/\\/g, '/');
}

function scanFile(filePath: string, root: string): readonly Break[] {
  let content: string;
  try {
    content = readFileText(filePath);
  } catch (error) {
    // Surface the underlying cause (EACCES, EISDIR, encoding errors); a bare
    // 'unreadable file' makes CI failures undiagnosable from the log alone.
    const detail = error instanceof Error ? error.message : String(error);
    return [
      {
        file: relativePath(filePath),
        target: '',
        reason: `unreadable file: ${detail}`,
      },
    ];
  }
  const links = extractLinks(content);
  const breaks: Break[] = [];
  // Build the source file's slug set once so same-file fragment links
  // do not re-read or re-lex the file on every fragment check.
  const sourceCtx: FragmentContext = {
    content,
    slugs: extractHeadingSlugs(content),
  };
  // Per-source-file slug cache for target documents — passed explicitly,
  // not a module-level global.
  const slugCache: SlugCache = new Map();
  for (const link of links) {
    const reason = checkLink(link, filePath, root, sourceCtx, slugCache);
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

  const allBreaks: Break[] = [];
  for (const file of files) {
    allBreaks.push(...scanFile(file, root));
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

// Compare like-to-like: both sides are resolved filesystem paths.
// (fileURLToPath(import.meta.url) is the current script's real path;
// resolve(process.argv[1]) is how Node was invoked.)
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  process.exit(main());
}
