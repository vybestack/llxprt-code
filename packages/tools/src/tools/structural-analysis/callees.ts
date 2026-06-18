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
 * Collects callee references from a single parsed file's method definitions.
 */
function collectCalleeRefs(
  parsed: ParsedFile,
  sym: string,
  relPath: string,
  visited: Set<string>,
  ctx: CalleeCtx,
): CalleeRef[] {
  const results: CalleeRef[] = [];
  try {
    const methodMatches = parsed.root.findAll({
      rule: {
        kind: 'method_definition',
        has: {
          kind: 'property_identifier',
          regex: `^${escapeRegex(sym)}$`,
        },
      },
    } as NapiConfig);

    for (const methodNode of methodMatches) {
      collectCalleesFromMethod(methodNode, relPath, visited, ctx, results);
    }
  } catch {
    /* skip */
  }
  return results;
}

/**
 * Collects outermost call expressions within a single method node.
 */
function collectCalleesFromMethod(
  methodNode: SgNode,
  relPath: string,
  visited: Set<string>,
  ctx: CalleeCtx,
  results: CalleeRef[],
): void {
  const callMatches = methodNode.findAll({
    rule: { kind: 'call_expression' },
  } as NapiConfig);
  const outermost = deduplicateCallRanges(callMatches);

  for (const { node } of outermost) {
    const callText = node.text().substring(0, 200);
    const key = `${callText}@${relPath}`;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);
    ctx.nodesVisited++;

    results.push({
      text: callText,
      file: relPath,
      line: node.range().start.line + 1,
      calleeNode: node,
    });
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
