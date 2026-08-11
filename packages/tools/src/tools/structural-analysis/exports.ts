/**
 * Exports analysis mode for the structural-analysis tool.
 *
 * @plan PLAN-20260211-ASTGREP.P10
 */

import type { NapiConfig } from '@ast-grep/napi';
import type { ParsedFile, AnalysisResult, ResolvedLang } from './types.js';
import { iterateFiles, parseFile, makeRelative } from './helpers.js';
import { type AnalysisBudget, BudgetTracker } from './budget.js';

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

export async function executeExports(
  searchPath: string,
  lang: ResolvedLang,
  workspaceRoot: string,
  signal: AbortSignal,
  budget: AnalysisBudget,
): Promise<AnalysisResult> {
  const tracker = new BudgetTracker(budget, signal);
  const exports: ExportEntry[] = [];

  await collectExportsBounded(
    searchPath,
    workspaceRoot,
    lang,
    tracker,
    exports,
  );

  if (signal.aborted) {
    tracker.markAborted();
  }

  return {
    mode: 'exports',
    truncated: tracker.truncated,
    partial: tracker.truncated,
    partialReason: tracker.partialReason,
    fileBudget: budget.fileBudget,
    recordBudget: budget.recordBudget,
    filesVisited: tracker.filesVisited,
    recordsRetained: tracker.recordsRetained,
    recordsObserved: tracker.recordsObserved,
    countInexact: tracker.countInexact,
    results: exports,
  };
}

/**
 * Bounded export collection. Iterates the search root lazily and retains at
 * most the record budget across the complete result.
 */
async function collectExportsBounded(
  searchPath: string,
  workspaceRoot: string,
  lang: ResolvedLang,
  tracker: BudgetTracker,
  exports: ExportEntry[],
): Promise<void> {
  for await (const file of iterateFiles(searchPath, lang, tracker.signal)) {
    if (!tracker.shouldVisitMoreFiles()) return;
    tracker.filesVisited++;
    const parsed = await parseFile(file, lang);
    if (!parsed) continue;
    const relPath = makeRelative(file, workspaceRoot);
    const fileExports = collectExportsRetained(parsed, relPath, tracker);
    exports.push(...fileExports);
  }
}

/**
 * Collects export statements from a single parsed file, retaining only those
 * that fit within the shared record budget. Each retained record is counted
 * through {@link BudgetTracker.tryRetainRecord}; the first record beyond the
 * budget is observed as a sentinel (proving partiality) and discarded.
 */
function collectExportsRetained(
  parsed: ParsedFile,
  relPath: string,
  tracker: BudgetTracker,
): ExportEntry[] {
  const retained: ExportEntry[] = [];
  try {
    const exportNodes = parsed.root.findAll({
      rule: { kind: 'export_statement' },
    } as NapiConfig);
    for (const m of exportNodes) {
      if (!tracker.tryRetainRecord()) break;
      const text = m.text();
      retained.push({
        file: relPath,
        line: m.range().start.line + 1,
        text: text.substring(0, 200),
        kind: classifyExportKind(text),
      });
    }
  } catch {
    /* skip */
  }
  return retained;
}
