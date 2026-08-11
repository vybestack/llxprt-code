/**
 * References analysis mode for the structural-analysis tool.
 *
 * @plan PLAN-20260211-ASTGREP.P10
 */

import type { NapiConfig } from '@ast-grep/napi';
import type { ParsedFile, AnalysisResult, ResolvedLang } from './types.js';
import {
  escapeRegex,
  iterateFiles,
  parseFile,
  makeRelative,
} from './helpers.js';
import { type AnalysisBudget, BudgetTracker } from './budget.js';

type AddResultFn = (
  category: string,
  file: string,
  line: number,
  text: string,
) => boolean;

function searchDirectCallReferences(
  parsed: ParsedFile,
  symbol: string,
  relPath: string,
  addResult: AddResultFn,
): boolean {
  try {
    const memberCalls = parsed.root.findAll(`$OBJ.${symbol}($$$ARGS)`);
    for (const m of memberCalls) {
      if (
        !addResult('Direct calls', relPath, m.range().start.line + 1, m.text())
      ) {
        return false;
      }
    }
  } catch {
    /* skip */
  }

  try {
    const standaloneCalls = parsed.root.findAll(`${symbol}($$$ARGS)`);
    for (const m of standaloneCalls) {
      if (
        !addResult('Direct calls', relPath, m.range().start.line + 1, m.text())
      ) {
        return false;
      }
    }
  } catch {
    /* skip */
  }
  return true;
}

function searchInstantiationReferences(
  parsed: ParsedFile,
  symbol: string,
  relPath: string,
  addResult: AddResultFn,
): boolean {
  try {
    const news = parsed.root.findAll(`new ${symbol}($$$ARGS)`);
    for (const m of news) {
      if (
        !addResult(
          'Instantiations',
          relPath,
          m.range().start.line + 1,
          m.text(),
        )
      ) {
        return false;
      }
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
      if (
        !addResult(
          'Instance method calls (heuristic)',
          relPath,
          m.range().start.line + 1,
          m.text(),
        )
      ) {
        return false;
      }
    }
  } catch {
    /* skip */
  }
  return true;
}

function searchTypeAndHeritageReferences(
  parsed: ParsedFile,
  symbol: string,
  relPath: string,
  addResult: AddResultFn,
): boolean {
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
      if (
        !addResult(
          'Type annotations',
          relPath,
          m.range().start.line + 1,
          m.text(),
        )
      ) {
        return false;
      }
    }
  } catch {
    /* skip */
  }

  try {
    const heritage = parsed.root.findAll(
      `class $NAME extends ${symbol} { $$$BODY }`,
    );
    for (const m of heritage) {
      if (
        !addResult(
          'Extends/Implements',
          relPath,
          m.range().start.line + 1,
          `class ${m.getMatch('NAME')?.text()} extends ${symbol}`,
        )
      ) {
        return false;
      }
    }
  } catch {
    /* skip */
  }

  try {
    const implHeritage = parsed.root.findAll(
      `class $NAME implements ${symbol} { $$$BODY }`,
    );
    for (const m of implHeritage) {
      if (
        !addResult(
          'Extends/Implements',
          relPath,
          m.range().start.line + 1,
          `class ${m.getMatch('NAME')?.text()} implements ${symbol}`,
        )
      ) {
        return false;
      }
    }
  } catch {
    /* skip */
  }
  return true;
}

function searchImportReferences(
  parsed: ParsedFile,
  symbol: string,
  relPath: string,
  addResult: AddResultFn,
): boolean {
  try {
    const imports = parsed.root.findAll({
      rule: {
        kind: 'import_specifier',
        has: { kind: 'identifier', regex: `^${escapeRegex(symbol)}$` },
      },
    } as NapiConfig);
    for (const m of imports) {
      if (!addResult('Imports', relPath, m.range().start.line + 1, m.text())) {
        return false;
      }
    }
  } catch {
    /* skip */
  }
  return true;
}

/**
 * Processes all reference categories for a single parsed file. Propagates the
 * first record-budget sentinel immediately: once one category observes the
 * one-over record, remaining categories and nodes for this file are skipped.
 */
function searchAllReferenceCategories(
  parsed: ParsedFile,
  symbol: string,
  relPath: string,
  addResult: AddResultFn,
): boolean {
  if (!searchDirectCallReferences(parsed, symbol, relPath, addResult)) {
    return false;
  }
  if (!searchInstantiationReferences(parsed, symbol, relPath, addResult)) {
    return false;
  }
  if (!searchTypeAndHeritageReferences(parsed, symbol, relPath, addResult)) {
    return false;
  }
  return searchImportReferences(parsed, symbol, relPath, addResult);
}

/**
 * Parses a file and searches all reference categories. Returns false when the
 * record-budget sentinel was hit (caller stops traversal); true otherwise
 * (including when the file is unparseable and simply skipped).
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
    return true;
  }
  const relPath = makeRelative(file, workspaceRoot);
  return searchAllReferenceCategories(parsed, symbol, relPath, addResult);
}

export async function executeReferences(
  symbol: string,
  lang: ResolvedLang,
  searchPath: string,
  workspaceRoot: string,
  signal: AbortSignal,
  budget: AnalysisBudget,
): Promise<AnalysisResult> {
  const tracker = new BudgetTracker(budget, signal);
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
  ): boolean => {
    const dedupKey = `${category}:${file}:${line}`;
    if (seen.has(dedupKey)) return true;
    // Global record cap across all categories — one shared accounting policy.
    // Returns false once the budget is exhausted so category loops stop.
    if (!tracker.tryRetainRecord()) return false;
    seen.add(dedupKey);
    categories[category].push({ file, line, text: text.substring(0, 200) });
    return true;
  };

  const processFile = async (file: string): Promise<boolean> => {
    if (!tracker.shouldVisitMoreFiles()) return false;
    tracker.filesVisited++;
    // Propagate the record-budget sentinel: once addResult returns false for a
    // file, stop visiting further files for this traversal.
    return trySearchReferencesForFile(
      file,
      lang,
      workspaceRoot,
      symbol,
      addResult,
    );
  };

  for await (const file of iterateFiles(searchPath, lang, signal)) {
    if (!(await processFile(file))) break;
  }

  if (signal.aborted) {
    tracker.markAborted();
  }

  const counts: Record<string, number> = {};
  for (const [cat, items] of Object.entries(categories)) {
    counts[cat] = items.length;
  }

  return {
    mode: 'references',
    symbol,
    truncated: tracker.truncated,
    partial: tracker.truncated,
    partialReason: tracker.partialReason,
    fileBudget: budget.fileBudget,
    recordBudget: budget.recordBudget,
    filesVisited: tracker.filesVisited,
    recordsRetained: tracker.recordsRetained,
    recordsObserved: tracker.recordsObserved,
    countInexact: tracker.countInexact,
    results: { categories, counts },
  };
}
