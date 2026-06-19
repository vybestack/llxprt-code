/**
 * Exports analysis mode for the structural-analysis tool.
 *
 * @plan PLAN-20260211-ASTGREP.P10
 */

import type { NapiConfig } from '@ast-grep/napi';
import type { ParsedFile, AnalysisResult, ResolvedLang } from './types.js';
import { getFiles, parseFile, makeRelative } from './helpers.js';

interface ExportEntry {
  file: string;
  line: number;
  text: string;
  kind: string;
}

/**
 * Classifies an export statement text into a kind label.
 */
function classifyExportKind(text: string): string {
  if (/^export\s+default\b/.test(text)) return 'default';
  if (text.includes('class')) return 'class';
  if (text.includes('function')) return 'function';
  if (text.includes('const') || text.includes('let') || text.includes('var')) {
    return 'const';
  }
  if (text.includes('interface')) return 'interface';
  if (text.includes('type ')) return 'type';
  if (text.includes('from')) return 'reexport';
  return 'export';
}

/**
 * Parses a file and returns its export entries, or null if unparseable.
 */
async function tryCollectExportsForFile(
  file: string,
  lang: ResolvedLang,
  workspaceRoot: string,
): Promise<ExportEntry[] | null> {
  const parsed = await parseFile(file, lang);
  if (!parsed) {
    return null;
  }
  const relPath = makeRelative(file, workspaceRoot);
  const exports: ExportEntry[] = [];
  collectExportsFromFile(parsed, relPath, exports);
  return exports;
}

export async function executeExports(
  searchPath: string,
  lang: ResolvedLang,
  workspaceRoot: string,
  signal: AbortSignal,
): Promise<AnalysisResult> {
  const files = await getFiles(searchPath, lang);
  const exports: ExportEntry[] = [];

  for (const file of files) {
    if (signal.aborted) {
      break;
    }
    const fileExports = await tryCollectExportsForFile(
      file,
      lang,
      workspaceRoot,
    );
    if (fileExports) {
      exports.push(...fileExports);
    }
  }

  return {
    mode: 'exports',
    truncated: false,
    results: exports,
  };
}

/**
 * Collects all export statements from a single parsed file.
 */
function collectExportsFromFile(
  parsed: ParsedFile,
  relPath: string,
  exports: ExportEntry[],
): void {
  try {
    const exportNodes = parsed.root.findAll({
      rule: { kind: 'export_statement' },
    } as NapiConfig);
    for (const m of exportNodes) {
      const text = m.text();
      exports.push({
        file: relPath,
        line: m.range().start.line + 1,
        text: text.substring(0, 200),
        kind: classifyExportKind(text),
      });
    }
  } catch {
    /* skip */
  }
}
