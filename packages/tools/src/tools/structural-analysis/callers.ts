/**
 * Callers analysis mode for the structural-analysis tool.
 *
 * @plan PLAN-20260211-ASTGREP.P09
 */

import type { NapiConfig } from '@ast-grep/napi';
import type { SgNode } from '@ast-grep/napi';
import type { ParsedFile, AnalysisResult, ResolvedLang } from './types.js';
import {
  escapeRegex,
  iterateFiles,
  parseFile,
  makeRelative,
  findFunctionContainer,
  getContainerName,
  getViaContext,
} from './helpers.js';
import { type AnalysisBudget, BudgetTracker } from './budget.js';

interface CallerRef {
  method: string;
  file: string;
  line: number;
  via: string;
}

/**
 * Accept one caller candidate through the node budget, pushing it into
 * `results` when it fits. Returns true to keep iterating, false to stop
 * (budget sentinel). Shared by the member-call and direct-call loops so
 * each stays to a single break with no nested control flow.
 */
function acceptCallerEntry(
  entry: CallerRef | undefined,
  results: CallerRef[],
  tracker: BudgetTracker,
  effectiveMaxNodes: number,
): boolean {
  if (entry === undefined) return true;
  if (!tracker.tryAcceptNode(effectiveMaxNodes)) return false;
  results.push(entry);
  return true;
}

export interface CallerEntry {
  method: string;
  file: string;
  line: number;
  via: string;
  callers?: CallerEntry[];
}

function buildCallerEntry(
  callNode: SgNode,
  sym: string,
  relPath: string,
  visited: Set<string>,
  via?: string,
): CallerRef | undefined {
  const container = findFunctionContainer(callNode);
  if (container === null) {
    return undefined;
  }

  const methodName = getContainerName(container);
  if (methodName === null || methodName === '' || methodName === sym) {
    return undefined;
  }

  const key = `${methodName}@${relPath}`;
  if (visited.has(key)) {
    return undefined;
  }
  visited.add(key);

  return {
    method: methodName,
    file: relPath,
    line: container.range().start.line + 1,
    via: via ?? getViaContext(callNode),
  };
}

/**
 * Collect member-call callers. Each valid new caller is accepted through the
 * shared node budget ({@link BudgetTracker.tryAcceptNode}) BEFORE being
 * inserted, so the node-candidate aggregate is hard-bounded with one-over
 * semantics. The loop stops the moment the budget sentinel fires.
 */
function findMemberCallCallers(
  parsed: ParsedFile,
  sym: string,
  relPath: string,
  visited: Set<string>,
  tracker: BudgetTracker,
  effectiveMaxNodes: number,
): CallerRef[] {
  const results: CallerRef[] = [];
  try {
    const memberCalls = parsed.root.findAll({
      rule: {
        kind: 'member_expression',
        has: {
          kind: 'property_identifier',
          regex: `^${escapeRegex(sym)}$`,
        },
      },
    } as NapiConfig);

    for (const callNode of memberCalls) {
      if (
        !acceptCallerEntry(
          buildCallerEntry(callNode, sym, relPath, visited),
          results,
          tracker,
          effectiveMaxNodes,
        )
      )
        break;
    }
  } catch {
    /* skip */
  }
  return results;
}

/**
 * Collect direct-call callers. Unlike the member path, every valid caller is
 * still accepted through the node budget before insertion, closing the
 * previous gap where the direct path was unbounded.
 */
function findDirectCallCallers(
  parsed: ParsedFile,
  sym: string,
  relPath: string,
  visited: Set<string>,
  tracker: BudgetTracker,
  effectiveMaxNodes: number,
): CallerRef[] {
  const results: CallerRef[] = [];
  try {
    const directCallNodes = parsed.root.findAll(`${sym}($$$ARGS)`);

    for (const callNode of directCallNodes) {
      if (
        !acceptCallerEntry(
          buildCallerEntry(callNode, sym, relPath, visited, `${sym}(...)`),
          results,
          tracker,
          effectiveMaxNodes,
        )
      )
        break;
    }
  } catch {
    /* skip */
  }
  return results;
}

async function findCallersOfFile(
  file: string,
  lang: ResolvedLang,
  sym: string,
  workspaceRoot: string,
  visited: Set<string>,
  tracker: BudgetTracker,
  effectiveMaxNodes: number,
): Promise<CallerRef[]> {
  // The node budget is enforced per-candidate by tryAcceptNode inside the
  // member/direct loops. We deliberately do NOT early-return on the exact
  // node limit here: that would prevent observing the one-over sentinel
  // candidate when callers are spread one-per-file. tryAcceptNode stops the
  // loop and shouldVisitMoreFiles stops the file loop once the sentinel fires.
  if (tracker.signal.aborted || tracker.truncated) {
    return [];
  }
  const outcome = await parseFile(file, lang);
  if (!outcome.ok) {
    tracker.recordFileOmission(outcome.reason);
    return [];
  }

  const relPath = makeRelative(file, workspaceRoot);
  const memberResults = findMemberCallCallers(
    outcome,
    sym,
    relPath,
    visited,
    tracker,
    effectiveMaxNodes,
  );
  const directResults = findDirectCallCallers(
    outcome,
    sym,
    relPath,
    visited,
    tracker,
    effectiveMaxNodes,
  );
  return [...memberResults, ...directResults];
}

export async function executeCallers(
  symbol: string,
  lang: ResolvedLang,
  searchPath: string,
  workspaceRoot: string,
  depth: number,
  maxNodes: number,
  signal: AbortSignal,
  budget: AnalysisBudget,
): Promise<AnalysisResult> {
  const tracker = new BudgetTracker(budget, signal);
  const visited = new Set<string>();
  // The node-candidate budget is the smaller of the requested maxNodes and
  // the finite record budget, so callers traversal is always hard-bounded.
  const effectiveMaxNodes = Math.min(maxNodes, budget.recordBudget);

  const findCallersOf = async (
    sym: string,
    currentDepth: number,
  ): Promise<CallerEntry[]> => {
    if (signal.aborted) {
      tracker.markAborted();
      return [];
    }
    // Exact-limit stays complete: when the node budget is exactly reached
    // (no extra candidate observed) traversal simply stops without marking
    // partial — only a one-over candidate (observed through tryAcceptNode)
    // sets the sentinel. shouldVisitMoreFiles stops file iteration once the
    // sentinel fires.
    // Snapshot truncation at entry: reading the property directly lets TS's
    // (unsound) property narrowing hide later mid-traversal flips.
    const truncatedOnEntry = tracker.truncated;
    if (currentDepth <= 0 || truncatedOnEntry) {
      return [];
    }

    const callers: CallerEntry[] = [];

    for await (const file of iterateFiles(searchPath, lang, signal)) {
      if (!tracker.shouldVisitMoreFiles()) break;
      tracker.filesVisited++;
      const fileResults = await findCallersOfFile(
        file,
        lang,
        sym,
        workspaceRoot,
        visited,
        tracker,
        effectiveMaxNodes,
      );
      for (const r of fileResults) {
        const entry: CallerEntry = {
          method: r.method,
          file: r.file,
          line: r.line,
          via: r.via,
        };
        if (
          currentDepth > 1 &&
          tracker.nodesObserved < effectiveMaxNodes &&
          !tracker.truncated
        ) {
          entry.callers = await findCallersOf(r.method, currentDepth - 1);
        }
        callers.push(entry);
      }
    }

    return callers;
  };

  const results = await findCallersOf(symbol, depth);

  if (signal.aborted) {
    tracker.markAborted();
  }

  // For callers/callees the node-candidate budget IS the record budget
  // (effectiveMaxNodes = min(maxNodes, recordBudget)), so the node counters
  // are reported as the record counters too. recordBudget reflects the
  // effective maximum, not the raw configured recordBudget.
  return {
    mode: 'callers',
    symbol,
    truncated: tracker.truncated,
    partial: tracker.truncated,
    partialReason: tracker.partialReason,
    fileBudget: budget.fileBudget,
    recordBudget: effectiveMaxNodes,
    filesVisited: tracker.filesVisited,
    recordsRetained: tracker.nodesRetained,
    recordsObserved: tracker.nodesObserved,
    nodesRetained: tracker.nodesRetained,
    nodesObserved: tracker.nodesObserved,
    oversizedFiles: tracker.oversizedFiles,
    unparseableFiles: tracker.unparseableFiles,
    countInexact: tracker.countInexact,
    results,
  };
}
