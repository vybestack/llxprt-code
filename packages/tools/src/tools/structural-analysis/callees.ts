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
  getFiles,
  parseFile,
  makeRelative,
  extractCalleeName,
  deduplicateCallRanges,
  findFunctionContainer,
} from './helpers.js';

interface CalleeRef {
  text: string;
  file: string;
  line: number;
  calleeNode?: SgNode;
}

interface CalleeCtx {
  nodesVisited: number;
  maxNodes: number;
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
  ctx: CalleeCtx,
  signal: AbortSignal,
): Promise<CalleeRef[]> {
  if (signal.aborted || ctx.nodesVisited >= ctx.maxNodes) return [];
  const parsed = await parseFile(file, lang);
  if (!parsed) return [];

  const relPath = makeRelative(file, workspaceRoot);
  return collectCalleeRefs(parsed, sym, relPath, visited, ctx);
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
  ctx: CalleeCtx,
): CalleeRef[] {
  const results: CalleeRef[] = [];
  for (const container of findNamedContainers(parsed, sym)) {
    collectCalleesFromContainer(container, relPath, visited, ctx, results);
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
 * visited). The maxNodes traversal limit is enforced upstream in
 * findCalleesOfFile, not in this function.
 *
 * Extracted so the caller loop uses zero `continue` statements.
 */
function tryCollectCallee(
  node: SgNode,
  containerStart: number,
  containerEnd: number,
  relPath: string,
  visited: Set<string>,
  ctx: CalleeCtx,
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
  ctx.nodesVisited++;
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
 */
function collectCalleesFromContainer(
  containerNode: SgNode,
  relPath: string,
  visited: Set<string>,
  ctx: CalleeCtx,
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
      ctx,
    );
    if (ref !== null) {
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
): Promise<AnalysisResult> {
  const files = await getFiles(searchPath, lang);
  const visited = new Set<string>();
  let nodesVisited = 0;
  let truncated = false;

  const findCalleesOf = async (
    sym: string,
    currentDepth: number,
  ): Promise<CalleeEntry[]> => {
    if (currentDepth <= 0 || nodesVisited >= maxNodes || signal.aborted) {
      if (nodesVisited >= maxNodes) truncated = true;
      return [];
    }

    const callees: CalleeEntry[] = [];
    const ctx: CalleeCtx = { nodesVisited, maxNodes };

    for (const file of files) {
      const calleeResults = await findCalleesOfFile(
        file,
        lang,
        sym,
        workspaceRoot,
        visited,
        ctx,
        signal,
      );

      for (const r of calleeResults) {
        callees.push(
          await buildCalleeEntry(r, sym, currentDepth, ctx, findCalleesOf),
        );
      }
    }

    nodesVisited = ctx.nodesVisited;
    return callees;
  };

  const results = await findCalleesOf(symbol, depth);

  return {
    mode: 'callees',
    symbol,
    truncated,
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
  ctx: CalleeCtx,
  recurse: (sym: string, currentDepth: number) => Promise<CalleeEntry[]>,
): Promise<CalleeEntry> {
  const entry: CalleeEntry = {
    text: r.text,
    file: r.file,
    line: r.line,
  };
  const calleeName = r.calleeNode ? extractCalleeName(r.calleeNode) : null;
  if (
    currentDepth > 1 &&
    ctx.nodesVisited < ctx.maxNodes &&
    calleeName &&
    calleeName !== sym
  ) {
    entry.callees = await recurse(calleeName, currentDepth - 1);
  }
  return entry;
}
