/**
 * Type hierarchy analysis mode for the structural-analysis tool.
 *
 * @plan PLAN-20260211-ASTGREP.P07
 */

import type { ParsedFile, AnalysisResult, ResolvedLang } from './types.js';
import { iterateFiles, parseFile, makeRelative } from './helpers.js';
import { type AnalysisBudget, BudgetTracker } from './budget.js';

interface HierarchyNode {
  name: string;
  file: string;
  line: number;
}

function findSymbolParents(
  parsed: ParsedFile,
  symbol: string,
  extendsParent: string[],
  implementsInterfaces: string[],
): void {
  try {
    const extendsMatches = parsed.root.findAll(
      `class ${symbol} extends $PARENT { $$$BODY }`,
    );
    for (const m of extendsMatches) {
      const parent = m.getMatch('PARENT');
      if (parent) extendsParent.push(parent.text());
    }
  } catch {
    /* skip */
  }

  try {
    const implMatches = parsed.root.findAll(
      `class ${symbol} implements $IFACE { $$$BODY }`,
    );
    for (const m of implMatches) {
      const iface = m.getMatch('IFACE');
      if (iface) implementsInterfaces.push(iface.text());
    }
  } catch {
    /* skip */
  }
}

function findSymbolChildren(
  parsed: ParsedFile,
  symbol: string,
  relPath: string,
  extendedBy: HierarchyNode[],
  implementedBy: HierarchyNode[],
): void {
  try {
    const childMatches = parsed.root.findAll(
      `class $NAME extends ${symbol} { $$$BODY }`,
    );
    for (const m of childMatches) {
      const name = m.getMatch('NAME');
      if (name) {
        extendedBy.push({
          name: name.text(),
          file: relPath,
          line: m.range().start.line + 1,
        });
      }
    }
  } catch {
    /* skip */
  }

  try {
    const implByMatches = parsed.root.findAll(
      `class $NAME implements ${symbol} { $$$BODY }`,
    );
    for (const m of implByMatches) {
      const name = m.getMatch('NAME');
      if (name) {
        implementedBy.push({
          name: name.text(),
          file: relPath,
          line: m.range().start.line + 1,
        });
      }
    }
  } catch {
    /* skip */
  }
}

export async function executeHierarchy(
  symbol: string,
  lang: ResolvedLang,
  searchPath: string,
  workspaceRoot: string,
  signal: AbortSignal,
  budget: AnalysisBudget,
): Promise<AnalysisResult> {
  const tracker = new BudgetTracker(budget, signal);
  const extendsParent: string[] = [];
  const implementsInterfaces: string[] = [];
  const extendedBy: HierarchyNode[] = [];
  const implementedBy: HierarchyNode[] = [];

  for await (const file of iterateFiles(searchPath, lang, signal)) {
    if (!tracker.shouldVisitMoreFiles()) break;
    tracker.filesVisited++;

    const outcome = await parseFile(file, lang);
    if (!outcome.ok) {
      tracker.recordFileOmission(outcome.reason);
    } else {
      const relPath = makeRelative(file, workspaceRoot);

      const pendingParents: string[] = [];
      const pendingIfaces: string[] = [];
      const pendingExtendedBy: HierarchyNode[] = [];
      const pendingImplBy: HierarchyNode[] = [];
      findSymbolParents(outcome, symbol, pendingParents, pendingIfaces);
      findSymbolChildren(
        outcome,
        symbol,
        relPath,
        pendingExtendedBy,
        pendingImplBy,
      );

      // All four relationship lists (parents, interfaces, extendedBy,
      // implementedBy) for the current file are routed through the shared
      // record budget. Each list stops at its first omitted record; after the
      // current file is drained, the outer traversal stops at the next file
      // boundary so no relationship aggregate grows without bound.
      drainIntoRecordBudget(tracker, pendingParents, extendsParent);
      drainIntoRecordBudget(tracker, pendingIfaces, implementsInterfaces);
      drainIntoRecordBudget(tracker, pendingExtendedBy, extendedBy);
      drainIntoRecordBudget(tracker, pendingImplBy, implementedBy);
    }
  }

  if (signal.aborted) {
    tracker.markAborted();
  }

  return {
    mode: 'hierarchy',
    symbol,
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
      extends: extendsParent,
      implements: implementsInterfaces,
      extendedBy,
      implementedBy,
    },
  };
}

/**
 * Drain a pending relationship list into its result sink through the shared
 * record budget. Stops this list (without pushing the overflow) when the budget
 * sentinel fires, so the result list never exceeds the budget.
 */
function drainIntoRecordBudget<T>(
  tracker: BudgetTracker,
  pending: readonly T[],
  sink: T[],
): void {
  for (const item of pending) {
    if (!tracker.tryRetainRecord()) return;
    sink.push(item);
  }
}
