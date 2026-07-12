#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * check-cli-import-boundary.ts
 *
 * Enforces the public API boundary for packages/cli/src (#2204, parent #1595).
 *
 * The CLI must be ONE CLIENT of the shared Agent/runtime API — not a co-owner
 * of runtime assembly. This script classifies every import in
 * packages/cli/src production source (static imports, dynamic import(), and
 * vi.mock module specifiers) and forbids deep/internal runtime-construction
 * imports from the runtime packages, EXCEPT for a narrow per-file allowlist of
 * genuine bootstrap/quarantine modules.
 *
 * It also:
 *   - forbids the `agent.getConfig(` / `.getConfig()` escape hatch anywhere in
 *     packages/cli/src (the Config must be reached via the public Agent
 *     surface, not an opaque getConfig back-door).
 *   - asserts packages/cli/index.ts stays under a thin-entry line threshold.
 *
 * Modeled on scripts/check-storage-import-boundary.ts (TypeScript compiler
 * API) for accurate specifier detection across all import kinds.
 *
 * The allowlist is a QUARANTINE BOUNDARY THAT MUST SHRINK OVER TIME: each entry
 * is a genuine bootstrap/runtime-construction site that has no public-API
 * replacement yet. New entries require explicit justification.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, relative, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isErrnoException } from './utils/error-guards.ts';
import type {
  ImportViolation,
  GetConfigHit,
  BannedSymbolHit,
  StaleEntry,
  ScanResult,
} from './cli-boundary/config.ts';
import {
  ALLOWLIST,
  THIN_ENTRY_MAX_LINES,
  TEST_DIR_GLOBS,
  PRUNED_DIR_BASE_NAMES,
} from './cli-boundary/config.ts';
import {
  analyzeFile,
  collectAllSpecifiers,
} from './cli-boundary/import-scanner.ts';
import { scanGetConfigEscapeHatch } from './cli-boundary/getconfig-scanner.ts';
import { scanBannedRuntimeAssembly } from './cli-boundary/banned-assembly-scanner.ts';

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Anchor the repo root to THIS script's location (import.meta.url) rather than
 * process.cwd(), so the boundary check is deterministic regardless of which
 * directory the script is invoked from (#2204). The script lives at
 * <repo>/scripts/check-cli-import-boundary.ts, so the repo root is one level
 * up from the script directory.
 *
 * An override via the CLI_BOUNDARY_ROOT env var is supported for the script's
 * own synthetic-fixture test suite (scripts/tests/cli-import-boundary.test.js),
 * which builds throwaway trees under temp dirs. Production/CI invocations never
 * set this env var and always resolve against the script-anchored root.
 */
const REPO_ROOT = process.env.CLI_BOUNDARY_ROOT
  ? resolve(process.env.CLI_BOUNDARY_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CLI_SRC_DIR = join(REPO_ROOT, 'packages/cli/src');
const CLI_INDEX = join(REPO_ROOT, 'packages/cli/index.ts');
const CLI_ENTRY = join(REPO_ROOT, 'packages/cli/src/cli.tsx');

// ─── Helpers ────────────────────────────────────────────────────────────────

function walkDir(dir: string): string[] {
  const results: string[] = [];
  const absDir = resolve(dir);

  function shouldExclude(filePath: string): boolean {
    const rel = relative(REPO_ROOT, filePath).replace(/\\/g, '/');
    return TEST_DIR_GLOBS.some((glob) => matchGlob(glob, rel));
  }

  function walk(d: string): void {
    if (shouldExclude(d)) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch (err) {
      if (isErrnoException(err, 'ENOENT') || isErrnoException(err, 'ENOTDIR')) {
        return;
      }
      throw err;
    }
    for (const entry of entries) {
      processEntry(entry, d);
    }
  }

  function processEntry(entry: Dirent, d: string): void {
    const full = join(d, entry.name);
    if (entry.isDirectory()) {
      if (PRUNED_DIR_BASE_NAMES.has(entry.name)) return;
      if (shouldExclude(full)) return;
      walk(full);
    } else if (
      !shouldExclude(full) &&
      entry.isFile() &&
      (extname(entry.name) === '.ts' || extname(entry.name) === '.tsx')
    ) {
      results.push(full);
    }
  }

  walk(absDir);
  return results;
}

/**
 * Minimal glob matcher supporting `*` (single segment, non-slash) and `**`
 * (any path). Anchored to the full relative path.
 */
function matchGlob(glob: string, relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  const escaped = glob.replace(/[\\^$.|?*+(){}[\]]/g, (ch) => '\\' + ch);
  const body = escaped
    .replace(/\\\*\\\*\//g, '(?:.*/)?')
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\\\*/g, '[^/]*');
  return new RegExp('^' + body + '$').test(normalized);
}

function relRepo(filePath: string): string {
  return relative(REPO_ROOT, filePath).replace(/\\/g, '/');
}

function countLines(relPath: string): number {
  return readFileSync(relPath, 'utf-8').trimEnd().split('\n').length;
}

// ─── Reporting ──────────────────────────────────────────────────────────────

function formatViolationLine(v: ImportViolation): string {
  if (v.importKind === 'vi.mock-non-literal') {
    return (
      `    line ${v.line}: vi.mock(<non-literal>) — vi.mock specifiers must` +
      ' be static string literals so this guard can analyze them; a dynamic' +
      ' specifier could hide a deep runtime import'
    );
  }
  if (v.importKind === 'dynamic-import-non-literal') {
    return (
      `    line ${v.line}: import(<non-literal>) — dynamic import specifiers` +
      ' must be static string literals so this guard can analyze them; a' +
      ' dynamic specifier could hide a deep runtime import'
    );
  }
  return (
    `    line ${v.line}: ${v.specifier} (${v.importKind}) — use the public` +
    ' package root or add a justified allowlist entry'
  );
}

function formatBannedSymbolHit(h: BannedSymbolHit): string {
  if (h.kind === 'pattern') {
    return (
      `    line ${h.line}: ${h.symbol} — the Agent owns the single session` +
      ' MessageBus and Config.initialize (#2378); construct/initialize via the' +
      ' public agent-bootstrap surface (createForegroundAgent / fromConfig /' +
      ' preflightAgentActivation) instead'
    );
  }
  const verb = h.kind === 'import' ? 'imports' : 'uses';
  return (
    `    line ${h.line}: ${verb} ${h.symbol} — runtime-assembly primitive` +
    ' banned in production CLI (#2378); consume the public agent-bootstrap /' +
    ' provider-composition surface instead of assembling the runtime here'
  );
}

function formatStaleEntry(e: StaleEntry): string {
  if (e.kind === 'missing-file') {
    return '    allowlisted file no longer exists in production source — remove the entry';
  }
  return `    allowlisted specifier '${e.detail}' is no longer imported — remove the entry`;
}

// ─── Phases ─────────────────────────────────────────────────────────────────

function runDeepImportScan(files: string[]): ScanResult {
  console.log('Checking CLI import boundary (packages/cli/src)...');
  const violationsByFile: Record<string, ImportViolation[]> = {};
  let totalViolations = 0;
  for (const filePath of files) {
    const rel = relRepo(filePath);
    const viols = analyzeFile(filePath, REPO_ROOT);
    if (viols.length > 0) {
      violationsByFile[rel] = viols;
      totalViolations += viols.length;
    }
  }
  if (totalViolations > 0) {
    console.log(`FAIL: ${totalViolations} disallowed import(s):\n`);
    for (const [file, viols] of Object.entries(violationsByFile)) {
      console.log(`  ${file}:`);
      for (const v of viols) {
        console.log(formatViolationLine(v));
      }
    }
    console.log('');
  } else {
    console.log('PASS: no disallowed deep runtime imports in CLI source.\n');
  }
  return { failed: totalViolations > 0, violationsByFile };
}

function runGetConfigScan(files: string[]): boolean {
  console.log('Checking for getConfig() escape-hatch usage...');
  let getConfigHits = 0;
  const getConfigByFile: Record<string, GetConfigHit[]> = {};
  for (const filePath of files) {
    const rel = relRepo(filePath);
    const hits = scanGetConfigEscapeHatch(filePath);
    if (hits.length > 0) {
      getConfigByFile[rel] = hits;
      getConfigHits += hits.length;
    }
  }
  if (getConfigHits > 0) {
    console.log(
      `FAIL: ${getConfigHits} getConfig() escape-hatch usage(s) found:\n`,
    );
    for (const [file, hits] of Object.entries(getConfigByFile)) {
      console.log(`  ${file}:`);
      for (const h of hits) {
        console.log(
          `    line ${h.line}: getConfig() escape-hatch — reach Config via` +
            ' the public Agent surface instead (if this is a legitimate local' +
            ' helper, rename it to a more specific name; do NOT add an' +
            ' allowlist)',
        );
      }
    }
    console.log('');
    return true;
  }
  console.log('PASS: no getConfig() escape-hatch usage in CLI source.\n');
  return false;
}

function runBannedRuntimeAssemblyScan(files: string[]): boolean {
  console.log('Checking for banned runtime-assembly symbols/patterns...');
  let totalHits = 0;
  const hitsByFile: Record<string, BannedSymbolHit[]> = {};
  for (const filePath of files) {
    const rel = relRepo(filePath);
    const hits = scanBannedRuntimeAssembly(filePath);
    if (hits.length > 0) {
      hitsByFile[rel] = hits;
      totalHits += hits.length;
    }
  }
  if (totalHits === 0) {
    console.log(
      'PASS: no banned runtime-assembly symbols/patterns in CLI source.\n',
    );
    return false;
  }
  console.log(
    `FAIL: ${totalHits} banned runtime-assembly symbol/pattern usage(s) found:\n`,
  );
  for (const [file, hits] of Object.entries(hitsByFile)) {
    console.log(`  ${file}:`);
    for (const h of hits) {
      console.log(formatBannedSymbolHit(h));
    }
  }
  console.log('');
  return true;
}

function collectStaleEntries(
  allowFile: string,
  allowSpecs: readonly string[],
  scannedRelFiles: Set<string>,
  staleByFile: Record<string, StaleEntry[]>,
): void {
  if (!scannedRelFiles.has(allowFile)) {
    staleByFile[allowFile] = [{ kind: 'missing-file', detail: allowFile }];
    return;
  }
  const absFile = join(REPO_ROOT, allowFile);
  const actualSpecs = collectAllSpecifiers(absFile);
  const stale: StaleEntry[] = [];
  for (const spec of allowSpecs) {
    if (!actualSpecs.has(spec)) {
      stale.push({ kind: 'unused-specifier', detail: spec });
    }
  }
  if (stale.length > 0) {
    staleByFile[allowFile] = stale;
  }
}

function runAllowlistFreshness(scannedRelFiles: Set<string>): boolean {
  console.log('Checking allowlist freshness (self-pruning guard)...');
  if (process.env.CLI_BOUNDARY_ROOT) {
    console.log('SKIP: allowlist freshness (synthetic fixture tree).\n');
    return false;
  }
  let staleEntries = 0;
  const staleByFile: Record<string, StaleEntry[]> = {};
  for (const [allowFile, allowSpecs] of Object.entries(ALLOWLIST)) {
    collectStaleEntries(allowFile, allowSpecs, scannedRelFiles, staleByFile);
    staleEntries += (staleByFile[allowFile] ?? []).length;
  }
  if (staleEntries === 0) {
    console.log('PASS: allowlist is fresh (no stale entries).\n');
    return false;
  }
  console.log(`FAIL: ${staleEntries} stale allowlist entr(y/ies) found:\n`);
  for (const [file, entries] of Object.entries(staleByFile)) {
    console.log(`  ${file}:`);
    for (const e of entries) {
      console.log(formatStaleEntry(e));
    }
  }
  console.log('');
  return true;
}

function checkThinIndex(): boolean {
  if (!existsSync(CLI_INDEX)) {
    console.log(`SKIP: thin CLI_INDEX guard (${CLI_INDEX} absent).`);
    return false;
  }
  const indexLines = countLines(CLI_INDEX);
  if (indexLines > THIN_ENTRY_MAX_LINES) {
    console.log(
      `FAIL: ${CLI_INDEX} is ${indexLines} lines (threshold ${THIN_ENTRY_MAX_LINES}). ` +
        'The real entrypoint must stay thin: shebang + top-level error handling + main() invocation only.',
    );
    return true;
  }
  console.log(
    `PASS: ${CLI_INDEX} is ${indexLines} lines (<= ${THIN_ENTRY_MAX_LINES}).`,
  );
  return false;
}

function checkCliEntryDeepImports(
  violationsByFile: Record<string, ImportViolation[]>,
): boolean {
  if (!existsSync(CLI_ENTRY)) {
    if (existsSync(CLI_INDEX)) {
      console.log(`SKIP: CLI_ENTRY deep-import guard (${CLI_ENTRY} absent).`);
    } else {
      console.log('SKIP: thin-entry guard (entrypoint files absent).');
    }
    return false;
  }
  const entryRel = relRepo(CLI_ENTRY);
  if (Object.prototype.hasOwnProperty.call(ALLOWLIST, entryRel)) {
    console.log(
      `FAIL: ${entryRel} must not appear in ALLOWLIST; the thin-entry guard requires zero direct deep imports.`,
    );
    return true;
  }
  const entryViolations = violationsByFile[entryRel] ?? [];
  if (entryViolations.length > 0) {
    console.log(
      `\nFAIL: ${entryRel} directly imports runtime-construction deep paths:`,
    );
    for (const v of entryViolations) {
      console.log(`    line ${v.line}: ${v.specifier} (${v.importKind})`);
    }
    return true;
  }
  console.log(
    `PASS: ${CLI_ENTRY} does not directly import runtime-construction deep paths.`,
  );
  return false;
}

function runThinEntryGuard(
  violationsByFile: Record<string, ImportViolation[]>,
): boolean {
  console.log('Checking thin-entry structure...');
  let failed = checkThinIndex();
  failed = checkCliEntryDeepImports(violationsByFile) || failed;
  return failed;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const files = walkDir(CLI_SRC_DIR);
  if (files.length === 0) {
    console.log(
      `FAIL: no TypeScript source files found under ${CLI_SRC_DIR}. ` +
        'The scan directory must exist and contain production source.',
    );
    process.exit(1);
  }
  console.log(`Scanning ${files.length} production source files...\n`);
  const scanResult = runDeepImportScan(files);
  let failed = scanResult.failed;

  failed = runGetConfigScan(files) || failed;
  failed = runBannedRuntimeAssemblyScan(files) || failed;

  const scannedRelFiles = new Set(files.map(relRepo));
  failed = runAllowlistFreshness(scannedRelFiles) || failed;

  failed = runThinEntryGuard(scanResult.violationsByFile) || failed;

  if (failed) {
    console.log('\nCLI import boundary check FAILED.');
    process.exit(1);
  }
  console.log('\nCLI import boundary check PASSED.');
  process.exit(0);
}

main();
