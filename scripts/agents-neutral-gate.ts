#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * agents-neutral-gate.ts — AST-based enforcement gate for #2349
 * (PLAN-20260707-AGENTNEUTRAL.P31 — FULL fail-mode).
 *
 * Detects Google-shaped structural envelopes and cheap #2424 re-introduction
 * vectors. Implements the COMPLETE AST-context-aware check set (a)-(h):
 *   (a) checkA — raw @google/genai imports
 *   (b) checkB — banned Google symbol imports (provenance-based)
 *   (c) checkC — Contract* payload-type aliases
 *   (d) checkD — round-trip conversion symbols (deleted-helper guard)
 *   (e) checkE — FinishReason/Type enum re-declarations
 *   (f) checkF — structural {candidates}/{role,parts}/.parts envelopes (F1/F3/F5)
 *   (g) checkG — toGeminiContent(s) calls (G-call) + GeminiContent* barrel imports (G-barrel)
 *   (h) checkH — Gemini usage keys outside boundary modules
 *
 * --count/--by-file/--explain ratchet over checkF + checkG-call + checkD +
 * checkG-barrel + checkH (all structural checks). --enforce-imports runs the
 * FULL check set (a)-(h) in fail-mode. Default (no-flag) run = full fail-mode.
 *
 * Detection logic lives in sibling modules:
 *   - agents-neutral-gate-config.ts  (constants + types)
 *   - agents-neutral-gate-ast.ts     (AST utilities + allow-list matching)
 *   - agents-neutral-gate-checks.ts  (checkA-checkH + hit collection)
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 * @pseudocode lines 9-48
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Hit } from './agents-neutral-gate-config.ts';
import {
  REPO_ROOT,
  DEFAULT_SCAN_ROOT,
  ALLOWLIST_PATH,
  productionFilesUnder,
  parseAllowlist,
  parseFile,
  matchesAstContext,
} from './agents-neutral-gate-ast.ts';
import {
  collectStructuralHits,
  collectImportHits,
  checkH_usageKeys,
} from './agents-neutral-gate-checks.ts';

// ─── Input resolution (Critical 2 — resolveInputFiles) ──────────────────────

interface ParsedArgs {
  readonly count: boolean;
  readonly byFile: boolean;
  readonly enforceImports: boolean;
  readonly explain: boolean;
  readonly checkUsageKeyBoundary: boolean;
  readonly files: string[];
  readonly root: string | null;
  readonly positional: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const files: string[] = [];
  const positional: string[] = [];
  let root: string | null = null;
  let count = false;
  let byFile = false;
  let enforceImports = false;
  let explain = false;
  let checkUsageKeyBoundary = false;
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--count') count = true;
    else if (arg === '--by-file') byFile = true;
    else if (arg === '--enforce-imports') enforceImports = true;
    else if (arg === '--explain') explain = true;
    else if (arg === '--check-usage-key-boundary') checkUsageKeyBoundary = true;
    else if (arg === '--files') {
      i++;
      while (i < argv.length && !argv[i].startsWith('-')) {
        files.push(argv[i]);
        i++;
      }
      i--;
    } else if (arg === '--root') {
      i++;
      if (i < argv.length && !argv[i].startsWith('-')) root = argv[i];
    } else if (!arg.startsWith('-')) positional.push(arg);
    i++;
  }
  return {
    count,
    byFile,
    enforceImports,
    explain,
    checkUsageKeyBoundary,
    files,
    root,
    positional,
  };
}

/** resolveInputFiles (pseudocode lines 9-9e): --files/positional OVERRIDE
 *  the default scan; --root overrides the scan root; default = DEFAULT_SCAN_ROOT. */
function resolveInputFiles(args: ParsedArgs): string[] {
  const explicit = [...args.files, ...args.positional];
  if (explicit.length > 0) {
    const seen = new Set<string>();
    const resolved: string[] = [];
    for (const p of explicit) {
      const abs = resolve(REPO_ROOT, p);
      if (existsSync(abs) && !seen.has(abs)) {
        seen.add(abs);
        resolved.push(abs);
      }
    }
    return resolved;
  }
  return productionFilesUnder(REPO_ROOT, args.root ?? DEFAULT_SCAN_ROOT);
}

// ─── CLI modes ──────────────────────────────────────────────────────────────

function compareByFileThenLine(a: Hit, b: Hit): number {
  if (a.file < b.file) return -1;
  if (a.file > b.file) return 1;
  return a.line - b.line;
}

/** runCount (lines 40-44): print ONLY the integer non-exempt total. Exit 0. */
function runCount(args: ParsedArgs): number {
  const allowlist = parseAllowlist(ALLOWLIST_PATH);
  const hits = collectStructuralHits(resolveInputFiles(args));
  const unexempted = hits.filter((h) => !matchesAstContext(h, allowlist));
  console.log(unexempted.length);
  return 0;
}

/** runByFile (lines 45-48): per-site identity lines. Shares runCount detection. */
function runByFile(args: ParsedArgs): number {
  const allowlist = parseAllowlist(ALLOWLIST_PATH);
  const hits = collectStructuralHits(resolveInputFiles(args));
  const unexempted = hits
    .filter((h) => !matchesAstContext(h, allowlist))
    .sort(compareByFileThenLine);
  for (const h of unexempted) {
    console.log(`${h.file}:${h.line}:${h.subkind}  ${h.contextSnippet}`);
  }
  return 0;
}

/** runEnforceImports (lines 25a-25h): full checkA-H fail-mode. GREEN/RED. */
function runEnforceImports(args: ParsedArgs): number {
  const hits = getEnforceImportHits(args);
  if (hits.length === 0) return 0;
  for (const h of hits.sort(compareByFileThenLine)) {
    console.error(`${h.file}:${h.line}:${h.subkind} — ${h.reason}`);
    console.error(`    ${h.contextSnippet}`);
  }
  return 1;
}

/**
 * Collects non-exempt import-mode hits for the given args. Exported so tests
 * can invoke the gate in-process (Finding #5 — eliminates one npx process
 * per test). Also serves as the shared entry point for --enforce-imports and
 * the default fail-mode run.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */
export function getEnforceImportHits(args: ParsedArgs): Hit[] {
  const allowlist = parseAllowlist(ALLOWLIST_PATH);
  const hits = collectImportHits(resolveInputFiles(args));
  return hits.filter((h) => !matchesAstContext(h, allowlist));
}

/**
 * Exported parseArgs so tests can construct ParsedArgs without going through
 * argv parsing.
 */
export { parseArgs as parseGateArgs };
export type { ParsedArgs as GateParsedArgs };

/** runExplain: structural hits with reasons for auditability. */
function runExplain(args: ParsedArgs): number {
  const allowlist = parseAllowlist(ALLOWLIST_PATH);
  const hits = collectStructuralHits(resolveInputFiles(args));
  const unexempted = hits
    .filter((h) => !matchesAstContext(h, allowlist))
    .sort(compareByFileThenLine);
  for (const h of unexempted) {
    console.log(`${h.file}:${h.line}:${h.subkind} — ${h.reason}`);
    console.log(`    ${h.contextSnippet}`);
  }
  console.log(`total: ${unexempted.length}`);
  return 0;
}

/**
 * runCheckUsageKeyBoundary (pseudocode lines 39a-39e): runs checkH over
 * packages/agents/src/api ONLY, with the AST-context allow-list. Exit 1
 * on any usage-key node outside the mapper body / declared type.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 * @pseudocode lines 39a-39e
 */
function runCheckUsageKeyBoundary(args: ParsedArgs): number {
  const allowlist = parseAllowlist(ALLOWLIST_PATH);
  const root = args.root ?? 'packages/agents/src/api';
  const files = resolveInputFiles({ ...args, root });
  const hits: Hit[] = [];
  for (const file of files) {
    const sf = parseFile(file);
    if (sf === null) continue;
    hits.push(...checkH_usageKeys(sf, file));
  }
  const unexempted = hits
    .filter((h) => !matchesAstContext(h, allowlist))
    .sort(compareByFileThenLine);
  if (unexempted.length === 0) return 0;
  for (const h of unexempted) {
    console.error(`${h.file}:${h.line}:${h.subkind} — ${h.reason}`);
    console.error(`    ${h.contextSnippet}`);
  }
  return 1;
}

/**
 * runDefault (pseudocode lines 10-25): FULL fail-mode run over all checks
 * (a)-(h). Exit 0 on clean tree (only allow-listed hits), exit 1 on any
 * non-exempt hit. This is the default CI mode.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 * @pseudocode lines 10-25
 */
function runDefault(args: ParsedArgs): number {
  const allowlist = parseAllowlist(ALLOWLIST_PATH);
  const hits = collectImportHits(resolveInputFiles(args));
  const unexempted = hits
    .filter((h) => !matchesAstContext(h, allowlist))
    .sort(compareByFileThenLine);
  if (unexempted.length === 0) {
    console.log('OK: agents-neutral-gate — no non-exempt hits');
    return 0;
  }
  console.error(
    `FAIL: agents-neutral-gate — ${unexempted.length} non-exempt hit(s):`,
  );
  for (const h of unexempted) {
    console.error(`${h.file}:${h.line}:${h.subkind} — ${h.reason}`);
    console.error(`    ${h.contextSnippet}`);
  }
  return 1;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.checkUsageKeyBoundary) process.exit(runCheckUsageKeyBoundary(args));
  if (args.enforceImports) process.exit(runEnforceImports(args));
  if (args.count) process.exit(runCount(args));
  if (args.byFile) process.exit(runByFile(args));
  if (args.explain) process.exit(runExplain(args));
  process.exit(runDefault(args));
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
