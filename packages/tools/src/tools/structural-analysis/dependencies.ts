/**
 * Module dependencies analysis mode for the structural-analysis tool.
 *
 * @plan PLAN-20260211-ASTGREP.P10
 */

import * as path from 'node:path';
import type { NapiConfig } from '@ast-grep/napi';
import type {
  ParsedFile,
  AnalysisResult,
  ImportEntry,
  ResolvedLang,
} from './types.js';
import { getFiles, parseFile, makeRelative } from './helpers.js';

function collectNamedAndDefaultImports(
  parsed: ParsedFile,
  relPath: string,
  imports: ImportEntry[],
): void {
  try {
    const named = parsed.root.findAll(`import { $$$NAMES } from $SOURCE`);
    for (const m of named) {
      const src = m.getMatch('SOURCE');
      if (src) {
        imports.push({
          file: relPath,
          line: m.range().start.line + 1,
          source: src.text().replace(/['"]/g, ''),
          kind: 'named',
        });
      }
    }
  } catch {
    /* skip */
  }

  try {
    const defaults = parsed.root.findAll(`import $DEFAULT from $SOURCE`);
    for (const m of defaults) {
      const src = m.getMatch('SOURCE');
      if (src) {
        imports.push({
          file: relPath,
          line: m.range().start.line + 1,
          source: src.text().replace(/['"]/g, ''),
          kind: 'default',
        });
      }
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
  collectNamedAndDefaultImports(parsed, relPath, imports);
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
      imports,
      reverseImports: reverse ? reverseImports : undefined,
    },
  };
}
