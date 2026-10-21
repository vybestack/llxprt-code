/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import type { ToolRank } from '@vybestack/llxprt-code-core/journal/tool-ranking-tree.js';
import { historyMutationFailure } from '@vybestack/llxprt-code-core/services/history/historyMutationEffects.js';
import type {
  ToolResultTruncatorDeps,
  ToolResponseTruncationResult,
} from './toolResultTruncator.js';
import type { OnePassTruncatorDeps } from './toolResponseOnePass.js';
import { openNativeToolRanking } from './native-tool-ranking.js';
import { publishNativeToolResponses } from './native-tool-publication.js';

export async function truncateNativePendingToolResponses(
  deps: ToolResultTruncatorDeps,
  limit: number,
): Promise<ToolResponseTruncationResult | undefined> {
  const model = deps.getRuntimeModel();
  const input: OnePassTruncatorDeps = {
    ...deps,
    rankingRevision: deps.historyService.toolRankingRevision(model),
    pendingContents: [],
  };
  const snapshot = await openNativeToolRanking(input);
  if (snapshot === undefined) return undefined;
  let outcome:
    | { readonly result: ToolResponseTruncationResult }
    | { readonly failure: unknown };
  try {
    outcome = { result: await shed(deps, input, snapshot, limit) };
  } catch (error) {
    outcome = { failure: error };
  }
  const cleanup: unknown[] = [];
  try {
    await snapshot.close();
  } catch (error) {
    cleanup.push(error);
  }
  if ('failure' in outcome)
    throw historyMutationFailure(outcome.failure, cleanup);
  if (cleanup.length > 0) throw cleanup[0];
  return outcome.result;
}

async function shed(
  deps: ToolResultTruncatorDeps,
  input: OnePassTruncatorDeps,
  snapshot: VersionSnapshot,
  limit: number,
): Promise<ToolResponseTruncationResult> {
  let current = deps.historyService.historyMutationGuard();
  const tree = await snapshot.toolRanking(input.rankingRevision);
  const header = await tree.header();
  let previous: ToolRank | undefined;
  let firstHistory = Infinity;
  let filtered = false;
  let replacedCount = 0;
  for await (const rank of tree.ordered(header.root)) {
    deps.signal?.throwIfAborted();
    if (!current())
      return {
        replacedCount,
        projected: await deps.computeProjected(),
        success: false,
      };
    firstHistory = Math.min(firstHistory, rank.ordinal);
    const replaced = await publishNativeToolResponses(input, {
      snapshot,
      tree,
      previous,
      last: rank,
      firstHistory,
      lastParent: header.lastParent,
      filtered,
    });
    filtered ||= replaced > 0;
    current = deps.historyService.historyMutationGuard();
    previous = rank;
    if (replaced === 0) continue;
    replacedCount += replaced;
    await deps.historyService.waitForTokenUpdates();
    deps.resetBaseline();
    const projected = await deps.computeProjected();
    if (projected <= limit) return { replacedCount, projected, success: true };
  }
  return {
    replacedCount,
    projected: await deps.computeProjected(),
    success: false,
  };
}
