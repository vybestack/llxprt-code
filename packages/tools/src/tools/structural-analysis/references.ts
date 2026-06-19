/**
 * References analysis mode for the structural-analysis tool.
 *
 * @plan PLAN-20260211-ASTGREP.P10
 */

import type { NapiConfig } from '@ast-grep/napi';
import type { ParsedFile, AnalysisResult, ResolvedLang } from './types.js';
import { escapeRegex, getFiles, parseFile, makeRelative } from './helpers.js';

type AddResultFn = (
  category: string,
  file: string,
  line: number,
  text: string,
) => void;

function searchDirectCallReferences(
  parsed: ParsedFile,
  symbol: string,
  relPath: string,
  addResult: AddResultFn,
): void {
  try {
    const memberCalls = parsed.root.findAll(`$OBJ.${symbol}($$$ARGS)`);
    for (const m of memberCalls) {
      addResult('Direct calls', relPath, m.range().start.line + 1, m.text());
    }
  } catch {
    /* skip */
  }

  try {
    const standaloneCalls = parsed.root.findAll(`${symbol}($$$ARGS)`);
    for (const m of standaloneCalls) {
      addResult('Direct calls', relPath, m.range().start.line + 1, m.text());
    }
  } catch {
    /* skip */
  }
}

function searchInstantiationReferences(
  parsed: ParsedFile,
  symbol: string,
  relPath: string,
  addResult: AddResultFn,
): void {
  try {
    const news = parsed.root.findAll(`new ${symbol}($$$ARGS)`);
    for (const m of news) {
      addResult('Instantiations', relPath, m.range().start.line + 1, m.text());
    }
  } catch {
    /* skip */
  }

  try {
    const lowerSymbol = symbol.charAt(0).toLowerCase() + symbol.slice(1);
    const instanceCalls = parsed.root.findAll({
      rule: {
        kind: 'call_expression',
        has: {
          kind: 'member_expression',
          has: {
            kind: 'identifier',
            regex: `(?i)${escapeRegex(lowerSymbol)}|${escapeRegex(symbol)}`,
          },
        },
      },
    } as NapiConfig);
    for (const m of instanceCalls) {
      addResult(
        'Instance method calls (heuristic)',
        relPath,
        m.range().start.line + 1,
        m.text(),
      );
    }
  } catch {
    /* skip */
  }
}

function searchTypeAndHeritageReferences(
  parsed: ParsedFile,
  symbol: string,
  relPath: string,
  addResult: AddResultFn,
): void {
  try {
    const typeRefs = parsed.root.findAll({
      rule: {
        kind: 'type_annotation',
        has: {
          kind: 'type_identifier',
          regex: `^${escapeRegex(symbol)}$`,
        },
      },
    } as NapiConfig);
    for (const m of typeRefs) {
      addResult(
        'Type annotations',
        relPath,
        m.range().start.line + 1,
        m.text(),
      );
    }
  } catch {
    /* skip */
  }

  try {
    const heritage = parsed.root.findAll(
      `class $NAME extends ${symbol} { $$$BODY }`,
    );
    for (const m of heritage) {
      addResult(
        'Extends/Implements',
        relPath,
        m.range().start.line + 1,
        `class ${m.getMatch('NAME')?.text()} extends ${symbol}`,
      );
    }
  } catch {
    /* skip */
  }

  try {
    const implHeritage = parsed.root.findAll(
      `class $NAME implements ${symbol} { $$$BODY }`,
    );
    for (const m of implHeritage) {
      addResult(
        'Extends/Implements',
        relPath,
        m.range().start.line + 1,
        `class ${m.getMatch('NAME')?.text()} implements ${symbol}`,
      );
    }
  } catch {
    /* skip */
  }
}

function searchImportReferences(
  parsed: ParsedFile,
  symbol: string,
  relPath: string,
  addResult: AddResultFn,
): void {
  try {
    const imports = parsed.root.findAll({
      rule: {
        kind: 'import_specifier',
        has: { kind: 'identifier', regex: `^${escapeRegex(symbol)}$` },
      },
    } as NapiConfig);
    for (const m of imports) {
      addResult('Imports', relPath, m.range().start.line + 1, m.text());
    }
  } catch {
    /* skip */
  }
}

/**
 * Processes all reference categories for a single parsed file.
 */
function searchAllReferenceCategories(
  parsed: ParsedFile,
  symbol: string,
  relPath: string,
  addResult: AddResultFn,
): void {
  searchDirectCallReferences(parsed, symbol, relPath, addResult);
  searchInstantiationReferences(parsed, symbol, relPath, addResult);
  searchTypeAndHeritageReferences(parsed, symbol, relPath, addResult);
  searchImportReferences(parsed, symbol, relPath, addResult);
}

/**
 * Parses a file and searches all reference categories, or returns null if
 * the file is unparseable.
 */
async function trySearchReferencesForFile(
  file: string,
  lang: ResolvedLang,
  workspaceRoot: string,
  symbol: string,
  addResult: AddResultFn,
): Promise<boolean> {
  const parsed = await parseFile(file, lang);
  if (!parsed) {
    return false;
  }
  const relPath = makeRelative(file, workspaceRoot);
  searchAllReferenceCategories(parsed, symbol, relPath, addResult);
  return true;
}

export async function executeReferences(
  symbol: string,
  lang: ResolvedLang,
  searchPath: string,
  workspaceRoot: string,
  signal: AbortSignal,
): Promise<AnalysisResult> {
  const files = await getFiles(searchPath, lang);
  const categories: Record<
    string,
    Array<{ file: string; line: number; text: string }>
  > = {
    'Direct calls': [],
    'Instance method calls (heuristic)': [],
    Instantiations: [],
    'Type annotations': [],
    'Extends/Implements': [],
    Imports: [],
  };

  const seen = new Set<string>();
  const addResult: AddResultFn = (
    category: string,
    file: string,
    line: number,
    text: string,
  ): void => {
    const key = `${category}:${file}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    categories[category].push({ file, line, text: text.substring(0, 200) });
  };

  for (const file of files) {
    if (signal.aborted) {
      break;
    }
    await trySearchReferencesForFile(
      file,
      lang,
      workspaceRoot,
      symbol,
      addResult,
    );
  }

  const counts: Record<string, number> = {};
  for (const [cat, items] of Object.entries(categories)) {
    counts[cat] = items.length;
  }

  return {
    mode: 'references',
    symbol,
    truncated: false,
    results: { categories, counts },
  };
}
