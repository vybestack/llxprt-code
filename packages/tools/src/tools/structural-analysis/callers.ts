/**
 * Callers analysis mode for the structural-analysis tool.
 *
 * @plan PLAN-20260211-ASTGREP.P09
 */

import type { NapiConfig } from '@ast-grep/napi';
import type { SgNode } from '@ast-grep/napi';
import type {
  ParsedFile,
  AnalysisResult,
  TraversalContext,
  ResolvedLang,
} from './types.js';
import {
  escapeRegex,
  getFiles,
  parseFile,
  makeRelative,
  findFunctionContainer,
  getContainerName,
  getViaContext,
} from './helpers.js';

interface CallerRef {
  method: string;
  file: string;
  line: number;
  via: string;
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

function findMemberCallCallers(
  parsed: ParsedFile,
  sym: string,
  relPath: string,
  visited: Set<string>,
  ctx: TraversalContext,
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
      if (ctx.nodesVisited >= ctx.maxNodes) {
        ctx.truncated = true;
        break;
      }

      const entry = buildCallerEntry(callNode, sym, relPath, visited);
      if (entry !== undefined) {
        ctx.nodesVisited++;
        results.push(entry);
      }
    }
  } catch {
    /* skip */
  }
  return results;
}

function findDirectCallCallers(
  parsed: ParsedFile,
  sym: string,
  relPath: string,
  visited: Set<string>,
  ctx: TraversalContext,
): CallerRef[] {
  const results: CallerRef[] = [];
  try {
    const directCallNodes = parsed.root.findAll(`${sym}($$$ARGS)`);

    for (const callNode of directCallNodes) {
      const entry = buildCallerEntry(
        callNode,
        sym,
        relPath,
        visited,
        `${sym}(...)`,
      );
      if (entry !== undefined) {
        ctx.nodesVisited++;
        results.push(entry);
      }
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
  ctx: TraversalContext,
): Promise<CallerRef[]> {
  if (ctx.signal.aborted || ctx.nodesVisited >= ctx.maxNodes) return [];
  const parsed = await parseFile(file, lang);
  if (!parsed) return [];

  const relPath = makeRelative(file, workspaceRoot);
  const memberResults = findMemberCallCallers(
    parsed,
    sym,
    relPath,
    visited,
    ctx,
  );
  const directResults = findDirectCallCallers(
    parsed,
    sym,
    relPath,
    visited,
    ctx,
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
): Promise<AnalysisResult> {
  const files = await getFiles(searchPath, lang);
  const visited = new Set<string>();
  let nodesVisited = 0;
  let truncated = false;

  const findCallersOf = async (
    sym: string,
    currentDepth: number,
  ): Promise<CallerEntry[]> => {
    if (currentDepth <= 0 || nodesVisited >= maxNodes || signal.aborted) {
      if (nodesVisited >= maxNodes) truncated = true;
      return [];
    }

    const callers: CallerEntry[] = [];
    const ctx: TraversalContext = { nodesVisited, maxNodes, truncated, signal };
    const syncTraversalState = (): void => {
      nodesVisited = ctx.nodesVisited;
      truncated = ctx.truncated;
    };

    for (const file of files) {
      const fileResults = await findCallersOfFile(
        file,
        lang,
        sym,
        workspaceRoot,
        visited,
        ctx,
      );
      for (const r of fileResults) {
        const entry: CallerEntry = {
          method: r.method,
          file: r.file,
          line: r.line,
          via: r.via,
        };
        if (currentDepth > 1 && ctx.nodesVisited < maxNodes) {
          syncTraversalState();
          entry.callers = await findCallersOf(r.method, currentDepth - 1);
          ctx.nodesVisited = nodesVisited;
          ctx.truncated = truncated;
        }
        callers.push(entry);
      }
    }

    nodesVisited = ctx.nodesVisited;
    truncated = ctx.truncated;
    return callers;
  };

  const results = await findCallersOf(symbol, depth);

  return {
    mode: 'callers',
    symbol,
    truncated,
    results,
  };
}
