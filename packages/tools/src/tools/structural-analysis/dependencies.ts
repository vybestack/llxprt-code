/**
 * Module dependencies analysis mode for the structural-analysis tool.
 *
 * @plan PLAN-20260211-ASTGREP.P10
 */

import * as path from 'node:path';
import type { NapiConfig } from '@ast-grep/napi';
import type { SgNode } from '@ast-grep/napi';
import type {
  ParsedFile,
  AnalysisResult,
  ImportEntry,
  ResolvedLang,
} from './types.js';
import { iterateFiles, parseFile, makeRelative } from './helpers.js';
import { type AnalysisBudget, BudgetTracker } from './budget.js';

/** Inline dedup key for an import record (forward or reverse). */
function importKey(entry: ImportEntry): string {
  return JSON.stringify([entry.file, entry.line, entry.source, entry.kind]);
}

/**
 * Retains one import record against the shared budget. Returns true when
 * collection should continue (record retained, or already-seen duplicate that
 * does not consume budget), false when the record budget is exhausted (caller
 * must stop collecting for this traversal).
 *
 * Feeding retention inline — instead of accumulating an unbounded per-file
 * ImportEntry[] before the tracker applies its cap — means record objects are
 * never materialized beyond the budget plus the single one-over sentinel.
 */
type RetainImportFn = (entry: ImportEntry) => boolean;

/**
 * Builds a {@link RetainImportFn} bound to a shared tracker, dedup set, and
 * output array. Forward and reverse collection each construct one so both
 * phases share one total file/record accounting policy.
 */
function makeImportRetainer(
  tracker: BudgetTracker,
  seen: Set<string>,
  out: ImportEntry[],
): RetainImportFn {
  return (entry: ImportEntry): boolean => {
    const key = importKey(entry);
    if (seen.has(key)) {
      return true;
    }
    if (!tracker.tryRetainRecord()) {
      return false;
    }
    seen.add(key);
    out.push(entry);
    return true;
  };
}

/**
 * Strips surrounding single or double quotes from a module specifier.
 */
function stripQuotes(text: string): string {
  return text.replace(/^['"]|['"]$/g, '');
}

/**
 * Returns the string child of an import_statement (the module source), or
 * null if the statement has no source string among its direct children.
 */
function findImportSource(children: SgNode[]): SgNode | null {
  return children.find((c: SgNode) => String(c.kind()) === 'string') ?? null;
}

/**
 * Resolves the module source string for a given import statement node.
 *
 * For static imports the string is a direct child, but for
 * `import x = require('...')` (and `import type x = require(...)`) the
 * specifier lives inside the `import_require_clause` rather than as a
 * direct child of the import_statement. This helper traverses into that
 * clause to extract the source when the direct-child scan finds nothing.
 *
 * Returns the unquoted source text, or null when no source can be resolved.
 */
function resolveImportSource(stmt: SgNode): string | null {
  const children = stmt.children();
  const directSource = findImportSource(children);
  if (directSource !== null) {
    return stripQuotes(directSource.text());
  }

  const requireClause = children.find(
    (c: SgNode) => String(c.kind()) === 'import_require_clause',
  );
  if (requireClause !== undefined) {
    const stringNode = requireClause
      .children()
      .find((c: SgNode) => String(c.kind()) === 'string');
    if (stringNode !== undefined) {
      return stripQuotes(stringNode.text());
    }
  }

  return null;
}

/**
 * Determines whether every import_specifier inside a named_imports clause
 * carries an inline `type` modifier (e.g. `import { type A, type B }`).
 * Returns true only when the clause is non-empty and every specifier is
 * type-only.
 */
function isNamedImportsAllType(namedImports: SgNode): boolean {
  const specifiers = namedImports
    .children()
    .filter((c: SgNode) => String(c.kind()) === 'import_specifier');
  if (specifiers.length === 0) {
    return false;
  }
  return specifiers.every((spec: SgNode) =>
    spec.children().some((c: SgNode) => String(c.kind()) === 'type'),
  );
}

/**
 * Finds a named_imports clause among the clause's children and determines
 * whether it is fully type-only (every specifier carries inline `type`).
 * Returns true when the named_imports clause exists and is all-type.
 */
function namedImportsAreAllType(clauseChildren: SgNode[]): boolean {
  const namedImports = clauseChildren.find(
    (c: SgNode) => String(c.kind()) === 'named_imports',
  );
  if (namedImports === undefined) {
    return false;
  }
  return isNamedImportsAllType(namedImports);
}

/**
 * Classifies a single import_statement node into one or more import records by
 * inspecting its children, rather than running overlapping literal patterns.
 *
 * A statement can produce BOTH a `default` and a `named` record (e.g.
 * `import def, { named } from '...'`). Each candidate record is fed to
 * `retain` inline; if the budget is exhausted, this returns false so the
 * caller stops collecting.
 */
function classifyImportStatement(
  stmt: SgNode,
  relPath: string,
  retain: RetainImportFn,
): boolean {
  const children = stmt.children();
  const line = stmt.range().start.line + 1;
  const source = resolveImportSource(stmt);

  const hasTypeKeyword = children.some(
    (c: SgNode) => String(c.kind()) === 'type',
  );
  if (hasTypeKeyword) {
    if (
      source !== null &&
      !retain({ file: relPath, line, source, kind: 'type' })
    ) {
      return false;
    }
    return true;
  }

  const requireClause = children.find(
    (c: SgNode) => String(c.kind()) === 'import_require_clause',
  );
  if (requireClause !== undefined) {
    if (
      source !== null &&
      !retain({ file: relPath, line, source, kind: 'require' })
    ) {
      return false;
    }
    return true;
  }

  const clause = children.find(
    (c: SgNode) => String(c.kind()) === 'import_clause',
  );
  if (!clause) {
    if (
      source !== null &&
      !retain({ file: relPath, line, source, kind: 'side-effect' })
    ) {
      return false;
    }
    return true;
  }

  // A record asserting a dependency on '' is worse than no record at all.
  if (source === null) {
    return true;
  }

  const clauseChildren = clause.children();
  if (
    clauseChildren.some((c: SgNode) => String(c.kind()) === 'identifier') &&
    !retain({ file: relPath, line, source, kind: 'default' })
  ) {
    return false;
  }
  if (
    clauseChildren.some((c: SgNode) => String(c.kind()) === 'named_imports')
  ) {
    const kind = namedImportsAreAllType(clauseChildren) ? 'type' : 'named';
    if (!retain({ file: relPath, line, source, kind })) return false;
  }
  if (
    clauseChildren.some(
      (c: SgNode) => String(c.kind()) === 'namespace_import',
    ) &&
    !retain({ file: relPath, line, source, kind: 'namespace' })
  ) {
    return false;
  }
  return true;
}

function collectStaticImports(
  parsed: ParsedFile,
  relPath: string,
  retain: RetainImportFn,
): boolean {
  try {
    const statements = parsed.root.findAll({
      rule: { kind: 'import_statement' },
    } as NapiConfig);
    for (const stmt of statements) {
      if (!classifyImportStatement(stmt, relPath, retain)) return false;
    }
  } catch {
    /* skip */
  }
  return true;
}

function collectDynamicAndReexports(
  parsed: ParsedFile,
  relPath: string,
  retain: RetainImportFn,
): boolean {
  try {
    const dynamic = parsed.root.findAll({
      rule: {
        kind: 'call_expression',
        has: { kind: 'import' },
      },
    } as NapiConfig);
    for (const m of dynamic) {
      if (
        !retain({
          file: relPath,
          line: m.range().start.line + 1,
          source: m.text(),
          kind: 'dynamic',
        })
      ) {
        return false;
      }
    }
  } catch {
    /* skip */
  }

  try {
    const reexports = parsed.root.findAll({
      rule: {
        kind: 'export_statement',
        has: { kind: 'string', regex: '.' },
      },
    } as NapiConfig);
    for (const m of reexports) {
      if (
        m.text().includes('from') &&
        !retain({
          file: relPath,
          line: m.range().start.line + 1,
          source: m.text().substring(0, 200),
          kind: 'reexport',
        })
      ) {
        return false;
      }
    }
  } catch {
    /* skip */
  }
  return true;
}

/**
 * Collects all import records from a single parsed file, retaining each inline
 * against the shared budget. Returns false if the budget was exhausted
 * mid-file (caller stops traversing).
 */
function collectFileImportsBounded(
  parsed: ParsedFile,
  relPath: string,
  retain: RetainImportFn,
): boolean {
  if (!collectStaticImports(parsed, relPath, retain)) return false;
  return collectDynamicAndReexports(parsed, relPath, retain);
}

function collectImportMatches(
  parsed: ParsedFile,
  relPath: string,
  targetBasename: string,
  retain: RetainImportFn,
): boolean {
  try {
    const allImports = parsed.root.findAll({
      rule: { kind: 'import_statement' },
    } as NapiConfig);
    for (const m of allImports) {
      const text = m.text();
      if (
        text.includes(targetBasename) &&
        !retain({
          file: relPath,
          line: m.range().start.line + 1,
          source: text.substring(0, 200),
          kind: 'import',
        })
      ) {
        return false;
      }
    }
  } catch {
    /* skip */
  }
  return true;
}

/**
 * Determines whether a parsed file should be considered for reverse-import
 * matching (not the target itself, and content references the target).
 */
function shouldCheckReverseImport(
  relPath: string,
  targetRel: string,
  content: string,
  targetBasename: string,
): boolean {
  return relPath !== targetRel && content.includes(targetBasename);
}

/**
 * Parses a file and feeds its reverse-import matches inline to `retain`, or
 * returns true (continue) if the file should be skipped (unparseable, is the
 * target, or doesn't reference it). Returns false only when the budget was
 * exhausted mid-file.
 */
async function tryCollectReverseImportsForFile(
  file: string,
  lang: ResolvedLang,
  targetRel: string,
  targetBasename: string,
  workspaceRoot: string,
  retain: RetainImportFn,
  tracker: BudgetTracker,
): Promise<boolean> {
  const outcome = await parseFile(file, lang);
  if (!outcome.ok) {
    tracker.recordFileOmission(outcome.reason);
    return true;
  }
  const relPath = makeRelative(file, workspaceRoot);
  if (
    !shouldCheckReverseImport(
      relPath,
      targetRel,
      outcome.content,
      targetBasename,
    )
  ) {
    return true;
  }
  return collectImportMatches(outcome, relPath, targetBasename, retain);
}

/**
 * Bounded reverse-import collection. Iterates the whole workspace lazily and
 * shares the caller's {@link BudgetTracker} so forward + reverse records stay
 * under one total file/record accounting policy. Reverse records are retained
 * inline (no unbounded per-file aggregate).
 */
async function collectReverseImportsBounded(
  searchPath: string,
  workspaceRoot: string,
  lang: ResolvedLang,
  tracker: BudgetTracker,
  seen: Set<string>,
  out: ImportEntry[],
): Promise<void> {
  const targetRel = makeRelative(searchPath, workspaceRoot);
  const targetBasename = path.basename(searchPath).replace(/\.\w+$/, '');
  const retain = makeImportRetainer(tracker, seen, out);

  for await (const file of iterateFiles(workspaceRoot, lang, tracker.signal)) {
    if (!tracker.shouldVisitMoreFiles()) return;
    tracker.filesVisited++;
    if (
      !(await tryCollectReverseImportsForFile(
        file,
        lang,
        targetRel,
        targetBasename,
        workspaceRoot,
        retain,
        tracker,
      ))
    ) {
      return;
    }
  }
}

/**
 * Builds the final {@link AnalysisResult} with bounded summary metadata.
 */
function buildDependenciesResult(
  imports: ImportEntry[],
  reverseImports: ImportEntry[] | undefined,
  reverse: boolean,
  tracker: BudgetTracker,
  budget: AnalysisBudget,
): AnalysisResult {
  return {
    mode: 'dependencies',
    truncated: tracker.truncated,
    partial: tracker.truncated,
    partialReason: tracker.partialReason,
    fileBudget: budget.fileBudget,
    recordBudget: budget.recordBudget,
    filesVisited: tracker.filesVisited,
    recordsRetained: tracker.recordsRetained,
    recordsObserved: tracker.recordsObserved,
    oversizedFiles: tracker.oversizedFiles,
    unparseableFiles: tracker.unparseableFiles,
    countInexact: tracker.countInexact,
    results: {
      imports,
      reverseImports: reverse ? reverseImports : undefined,
    },
  };
}

export async function executeDependencies(
  searchPath: string,
  lang: ResolvedLang,
  workspaceRoot: string,
  reverse: boolean,
  signal: AbortSignal,
  budget: AnalysisBudget,
): Promise<AnalysisResult> {
  const tracker = new BudgetTracker(budget, signal);
  const imports: ImportEntry[] = [];
  const seen = new Set<string>();

  await collectForwardImportsBounded(
    searchPath,
    workspaceRoot,
    lang,
    tracker,
    seen,
    imports,
  );

  let reverseImports: ImportEntry[] | undefined;
  if (reverse) {
    reverseImports = [];
    await collectReverseImportsBounded(
      searchPath,
      workspaceRoot,
      lang,
      tracker,
      seen,
      reverseImports,
    );
  }

  // A signal that was already aborted (or aborted during a gap between file
  // yields) must never read as a falsely complete result.
  if (signal.aborted) {
    tracker.markAborted();
  }

  return buildDependenciesResult(
    imports,
    reverseImports,
    reverse,
    tracker,
    budget,
  );
}

/**
 * Bounded forward-import collection. Iterates the search root lazily and
 * retains each import inline against the shared budget (no unbounded per-file
 * ImportEntry[] aggregate). Deduplication happens inside the retainer so
 * retained output never exceeds the record budget.
 */
async function collectForwardImportsBounded(
  searchPath: string,
  workspaceRoot: string,
  lang: ResolvedLang,
  tracker: BudgetTracker,
  seen: Set<string>,
  imports: ImportEntry[],
): Promise<void> {
  const retain = makeImportRetainer(tracker, seen, imports);
  for await (const file of iterateFiles(searchPath, lang, tracker.signal)) {
    if (!tracker.shouldVisitMoreFiles()) return;
    tracker.filesVisited++;
    const outcome = await parseFile(file, lang);
    if (!outcome.ok) {
      tracker.recordFileOmission(outcome.reason);
      continue;
    }
    const relPath = makeRelative(file, workspaceRoot);
    if (!collectFileImportsBounded(outcome, relPath, retain)) return;
  }
}
