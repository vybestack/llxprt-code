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
import { getFiles, parseFile, makeRelative } from './helpers.js';

/**
 * Strips surrounding single or double quotes from a module specifier.
 */
function stripQuotes(text: string): string {
  return text.replace(/^['"]|['"]$/g, '');
}

/**
 * Returns the string child of an import_statement (the module source), or
 * null if the statement has no source string (malformed input).
 */
function findImportSource(children: SgNode[]): SgNode | null {
  return children.find((c: SgNode) => String(c.kind()) === 'string') ?? null;
}

/**
 * Classifies a single import_statement node into one or more import records by
 * inspecting its children, rather than running overlapping literal patterns.
 *
 * A statement can produce BOTH a `default` and a `named` record (e.g.
 * `import def, { named } from '...'`).
 */
function classifyImportStatement(
  stmt: SgNode,
  relPath: string,
  imports: ImportEntry[],
): void {
  const children = stmt.children();
  const line = stmt.range().start.line + 1;
  const sourceNode = findImportSource(children);
  const source = sourceNode ? stripQuotes(sourceNode.text()) : '';

  const hasTypeKeyword = children.some(
    (c: SgNode) => String(c.kind()) === 'type',
  );
  if (hasTypeKeyword) {
    imports.push({ file: relPath, line, source, kind: 'type' });
    return;
  }

  const clause = children.find(
    (c: SgNode) => String(c.kind()) === 'import_clause',
  );
  if (!clause) {
    imports.push({ file: relPath, line, source, kind: 'side-effect' });
    return;
  }

  const clauseChildren = clause.children();
  if (clauseChildren.some((c: SgNode) => String(c.kind()) === 'identifier')) {
    imports.push({ file: relPath, line, source, kind: 'default' });
  }
  if (
    clauseChildren.some((c: SgNode) => String(c.kind()) === 'named_imports')
  ) {
    imports.push({ file: relPath, line, source, kind: 'named' });
  }
  if (
    clauseChildren.some((c: SgNode) => String(c.kind()) === 'namespace_import')
  ) {
    imports.push({ file: relPath, line, source, kind: 'namespace' });
  }
}

function collectStaticImports(
  parsed: ParsedFile,
  relPath: string,
  imports: ImportEntry[],
): void {
  try {
    const statements = parsed.root.findAll({
      rule: { kind: 'import_statement' },
    } as NapiConfig);
    for (const stmt of statements) {
      classifyImportStatement(stmt, relPath, imports);
    }
  } catch {
    /* skip */
  }
}

function collectDynamicAndReexports(
  parsed: ParsedFile,
  relPath: string,
  imports: ImportEntry[],
): void {
  try {
    const dynamic = parsed.root.findAll({
      rule: {
        kind: 'call_expression',
        has: { kind: 'import' },
      },
    } as NapiConfig);
    for (const m of dynamic) {
      imports.push({
        file: relPath,
        line: m.range().start.line + 1,
        source: m.text(),
        kind: 'dynamic',
      });
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
      if (m.text().includes('from')) {
        imports.push({
          file: relPath,
          line: m.range().start.line + 1,
          source: m.text().substring(0, 200),
          kind: 'reexport',
        });
      }
    }
  } catch {
    /* skip */
  }
}

function collectFileImports(
  parsed: ParsedFile,
  relPath: string,
  imports: ImportEntry[],
): void {
  collectStaticImports(parsed, relPath, imports);
  collectDynamicAndReexports(parsed, relPath, imports);
}

function collectImportMatches(
  parsed: ParsedFile,
  relPath: string,
  targetBasename: string,
): ImportEntry[] {
  const imports: ImportEntry[] = [];
  try {
    const allImports = parsed.root.findAll({
      rule: { kind: 'import_statement' },
    } as NapiConfig);
    for (const m of allImports) {
      const text = m.text();
      if (text.includes(targetBasename)) {
        imports.push({
          file: relPath,
          line: m.range().start.line + 1,
          source: text.substring(0, 200),
          kind: 'import',
        });
      }
    }
  } catch {
    /* skip */
  }
  return imports;
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
 * Parses a file and returns its reverse-import matches, or null if the file
 * should be skipped (unparseable, is the target, or doesn't reference it).
 */
async function tryCollectReverseImportsForFile(
  file: string,
  lang: ResolvedLang,
  targetRel: string,
  targetBasename: string,
  workspaceRoot: string,
): Promise<ImportEntry[] | null> {
  const parsed = await parseFile(file, lang);
  if (!parsed) {
    return null;
  }
  const relPath = makeRelative(file, workspaceRoot);
  if (
    !shouldCheckReverseImport(
      relPath,
      targetRel,
      parsed.content,
      targetBasename,
    )
  ) {
    return null;
  }
  return collectImportMatches(parsed, relPath, targetBasename);
}

async function findReverseImports(
  searchPath: string,
  workspaceRoot: string,
  lang: ResolvedLang,
  signal: AbortSignal,
): Promise<ImportEntry[]> {
  const reverseImports: ImportEntry[] = [];
  const allFiles = await getFiles(workspaceRoot, lang);
  const targetRel = makeRelative(searchPath, workspaceRoot);
  const targetBasename = path.basename(searchPath).replace(/\.\w+$/, '');

  for (const file of allFiles) {
    if (signal.aborted) {
      break;
    }
    const matches = await tryCollectReverseImportsForFile(
      file,
      lang,
      targetRel,
      targetBasename,
      workspaceRoot,
    );
    if (matches) {
      reverseImports.push(...matches);
    }
  }
  return reverseImports;
}

/**
 * Parses a file and collects its imports, or returns null if unparseable.
 */
async function tryCollectImportsForFile(
  file: string,
  lang: ResolvedLang,
  workspaceRoot: string,
): Promise<ImportEntry[] | null> {
  const parsed = await parseFile(file, lang);
  if (!parsed) {
    return null;
  }
  const relPath = makeRelative(file, workspaceRoot);
  const imports: ImportEntry[] = [];
  collectFileImports(parsed, relPath, imports);
  return imports;
}

export async function executeDependencies(
  searchPath: string,
  lang: ResolvedLang,
  workspaceRoot: string,
  reverse: boolean,
  signal: AbortSignal,
): Promise<AnalysisResult> {
  const files = await getFiles(searchPath, lang);
  const imports: ImportEntry[] = [];

  for (const file of files) {
    if (signal.aborted) {
      break;
    }
    const fileImports = await tryCollectImportsForFile(
      file,
      lang,
      workspaceRoot,
    );
    if (fileImports) {
      imports.push(...fileImports);
    }
  }

  const reverseImports = reverse
    ? await findReverseImports(searchPath, workspaceRoot, lang, signal)
    : [];

  return {
    mode: 'dependencies',
    truncated: false,
    results: {
      imports: deduplicateForwardImports(imports),
      reverseImports: reverse ? reverseImports : undefined,
    },
  };
}

/**
 * Deduplicates the forward import list by (file, line, source, kind) so no
 * tuple is emitted more than once.
 */
function deduplicateForwardImports(imports: ImportEntry[]): ImportEntry[] {
  const seen = new Set<string>();
  const result: ImportEntry[] = [];
  for (const imp of imports) {
    const key = JSON.stringify([imp.file, imp.line, imp.source, imp.kind]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(imp);
  }
  return result;
}
