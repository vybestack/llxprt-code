/**
 * Callees analysis mode for the structural-analysis tool.
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
  extractCalleeName,
  deduplicateCallRanges,
  findFunctionContainer,
} from './helpers.js';
import { type AnalysisBudget, BudgetTracker } from './budget.js';

interface CalleeRef {
  text: string;
  file: string;
  line: number;
  calleeNode?: SgNode;
}

export interface CalleeEntry {
  text: string;
  file: string;
  line: number;
  callees?: CalleeEntry[];
}

async function findCalleesOfFile(
  file: string,
  lang: ResolvedLang,
  sym: string,
  workspaceRoot: string,
  visited: Set<string>,
  tracker: BudgetTracker,
  effectiveMaxNodes: number,
): Promise<CalleeRef[]> {
  // The node budget is enforced per-candidate by tryAcceptNode inside
  // collectCalleesFromContainer. We do NOT early-return on the exact node
  // limit here so the one-over sentinel can be observed when callees are
  // spread one-per-file across the workspace.
  if (tracker.signal.aborted || tracker.truncated) {
    return [];
  }
  const outcome = await parseFile(file, lang);
  if (!outcome.ok) {
    tracker.recordFileOmission(outcome.reason);
    return [];
  }

  const relPath = makeRelative(file, workspaceRoot);
  return collectCalleeRefs(
    outcome,
    sym,
    relPath,
    visited,
    tracker,
    effectiveMaxNodes,
  );
}

/**
 * Collects callee references from a single parsed file by locating every
 * function-like container whose name matches `sym`, regardless of how it is
 * declared (function, generator, arrow bound to a const, or class/object method).
 */
function collectCalleeRefs(
  parsed: ParsedFile,
  sym: string,
  relPath: string,
  visited: Set<string>,
  tracker: BudgetTracker,
  effectiveMaxNodes: number,
): CalleeRef[] {
  const results: CalleeRef[] = [];
  for (const container of findNamedContainers(parsed, sym)) {
    collectCalleesFromContainer(
      container,
      relPath,
      visited,
      tracker,
      effectiveMaxNodes,
      results,
    );
  }
  return results;
}

/**
 * Finds function-like container nodes whose declared name matches `sym`.
 * Covers function_declaration, generator_function_declaration,
 * method_definition, and variable-bound function expressions — arrow_function,
 * function_expression and generator_function — each matched via its
 * variable_declarator binding so the const name is the lookup key, but the
 * inner function node itself is returned — NOT the declarator. Returning the
 * inner node is deliberate: collectCalleesFromContainer keeps a call only when
 * its nearest enclosing function-container (per findFunctionContainer) IS the
 * container node. findFunctionContainer recognises those function kinds as
 * function-container kinds but not variable_declarator, so returning the
 * declarator would make every call inside the body vanish (its nearest function
 * container would be the inner function node, whose range never matches the
 * declarator's). Do not "simplify" this back to returning the declarator.
 */
function findNamedContainers(parsed: ParsedFile, sym: string): SgNode[] {
  const escaped = escapeRegex(sym);
  const rules: Array<{ kind: string; nameKind: string }> = [
    { kind: 'function_declaration', nameKind: 'identifier' },
    { kind: 'generator_function_declaration', nameKind: 'identifier' },
    { kind: 'method_definition', nameKind: 'property_identifier' },
  ];

  const containers: SgNode[] = [];
  for (const { kind, nameKind } of rules) {
    try {
      const matches = parsed.root.findAll({
        rule: {
          kind,
          has: { kind: nameKind, regex: `^${escaped}$` },
        },
      } as NapiConfig);
      for (const m of matches) containers.push(m);
    } catch {
      // Rule names TS node kinds; ast-grep throws for languages whose grammar lacks them.
    }
  }

  // Variable-bound function expressions (arrow_function, function_expression,
  // generator_function): match the variable_declarator that binds them so the
  // const name is the lookup key. Return the inner function node itself (not
  // the declarator) so the nearest-enclosing-container comparison in
  // collectCalleesFromContainer lines up: the nearest function container of a
  // call inside the body is the inner function node, not the declarator.
  const declaratorFunctionKinds = [
    'arrow_function',
    'function_expression',
    'generator_function',
  ] as const;
  try {
    const declarators = parsed.root.findAll({
      rule: {
        kind: 'variable_declarator',
        all: [
          { has: { kind: 'identifier', regex: `^${escaped}$` } },
          {
            has: {
              any: declaratorFunctionKinds.map((k) => ({ kind: k })),
            },
          },
        ],
      },
    } as NapiConfig);
    for (const d of declarators) {
      const fn = d
        .children()
        .find((c: SgNode) =>
          (declaratorFunctionKinds as readonly string[]).includes(
            String(c.kind()),
          ),
        );
      if (fn) containers.push(fn);
    }
  } catch {
    // Rule names TS node kinds; ast-grep throws for languages whose grammar lacks them.
  }

  return containers;
}

/**
 * Checks a single call-expression node and returns a CalleeRef if it belongs
 * directly to the target container (its nearest function-like container),
 * or null if it should be skipped (nested in a different function or already
 * visited). Node-budget acceptance happens in the caller loop (before
 * insertion), not in this function.
 *
 * Extracted so the caller loop uses zero `continue` statements.
 */
function tryCollectCallee(
  node: SgNode,
  containerStart: number,
  containerEnd: number,
  relPath: string,
  visited: Set<string>,
): CalleeRef | null {
  const nearest = findFunctionContainer(node);
  if (nearest === null) {
    return null;
  }
  if (
    nearest.range().start.index !== containerStart ||
    nearest.range().end.index !== containerEnd
  ) {
    return null;
  }
  const callText = node.text().substring(0, 200);
  const key = `${callText}@${relPath}@${node.range().start.index}`;
  if (visited.has(key)) {
    return null;
  }
  visited.add(key);
  return {
    text: callText,
    file: relPath,
    line: node.range().start.line + 1,
    calleeNode: node,
  };
}

/**
 * Collects outermost call expressions that belong directly to a single
 * container node. Only calls whose NEAREST enclosing function-like container
 * is the target container are kept, so calls inside nested functions are not
 * misattributed to the outer container. Containers are compared by range
 * index (node identity is not reliable across ast-grep queries).
 *
 * Every callee insertion is accepted through the shared node budget
 * ({@link BudgetTracker.tryAcceptNode}) BEFORE being pushed, so the
 * node-candidate aggregate is hard-bounded with one-over semantics.
 */
function collectCalleesFromContainer(
  containerNode: SgNode,
  relPath: string,
  visited: Set<string>,
  tracker: BudgetTracker,
  effectiveMaxNodes: number,
  results: CalleeRef[],
): void {
  const callMatches = containerNode.findAll({
    rule: { kind: 'call_expression' },
  } as NapiConfig);
  const outermost = deduplicateCallRanges(callMatches);

  const containerStart = containerNode.range().start.index;
  const containerEnd = containerNode.range().end.index;

  for (const { node } of outermost) {
    const ref = tryCollectCallee(
      node,
      containerStart,
      containerEnd,
      relPath,
      visited,
    );
    if (ref !== null) {
      if (!tracker.tryAcceptNode(effectiveMaxNodes)) break;
      results.push(ref);
    }
  }
}

export async function executeCallees(
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
  // the finite record budget, so callees traversal is always hard-bounded.
  const effectiveMaxNodes = Math.min(maxNodes, budget.recordBudget);

  const findCalleesOf = async (
    sym: string,
    currentDepth: number,
  ): Promise<CalleeEntry[]> => {
    if (signal.aborted) {
      tracker.markAborted();
      return [];
    }
    // Exact-limit stays complete: reaching the node budget without observing
    // an extra candidate does not mark the result partial. The per-candidate
    // tryAcceptNode (inside collectCalleesFromContainer) observes the one-over
    // sentinel; shouldVisitMoreFiles then stops file iteration.
    if (currentDepth <= 0 || tracker.truncated) {
      return [];
    }

    const callees: CalleeEntry[] = [];

    for await (const file of iterateFiles(searchPath, lang, signal)) {
      if (!tracker.shouldVisitMoreFiles()) break;
      tracker.filesVisited++;

      const calleeResults = await findCalleesOfFile(
        file,
        lang,
        sym,
        workspaceRoot,
        visited,
        tracker,
        effectiveMaxNodes,
      );

      for (const r of calleeResults) {
        callees.push(
          await buildCalleeEntry(
            r,
            sym,
            currentDepth,
            tracker,
            effectiveMaxNodes,
            findCalleesOf,
          ),
        );
      }
    }

    return callees;
  };

  const results = await findCalleesOf(symbol, depth);

  if (signal.aborted) {
    tracker.markAborted();
  }

  // For callers/callees the node-candidate budget IS the record budget
  // (effectiveMaxNodes = min(maxNodes, recordBudget)), so the node counters
  // are reported as the record counters too. recordBudget reflects the
  // effective maximum, not the raw configured recordBudget.
  return {
    mode: 'callees',
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

/**
 * Builds a single CalleeEntry, recursing into named callees when depth allows.
 */
async function buildCalleeEntry(
  r: CalleeRef,
  sym: string,
  currentDepth: number,
  tracker: BudgetTracker,
  effectiveMaxNodes: number,
  recurse: (sym: string, currentDepth: number) => Promise<CalleeEntry[]>,
): Promise<CalleeEntry> {
  const entry: CalleeEntry = {
    text: r.text,
    file: r.file,
    line: r.line,
  };
  const calleeName = r.calleeNode ? extractCalleeName(r.calleeNode) : null;
  const mayRecurse = currentDepth > 1 && !tracker.truncated;
  if (
    mayRecurse &&
    tracker.nodesObserved < effectiveMaxNodes &&
    calleeName &&
    calleeName !== sym
  ) {
    entry.callees = await recurse(calleeName, currentDepth - 1);
  }
  return entry;
}
