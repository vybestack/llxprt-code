/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  ToolRankingPolicy,
  ToolRankingOverlay,
} from '../../journal/tool-ranking-fill.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { CommittedGroup } from '../../journal/journalStore.js';
import { waitForDetachedCapture } from './journalDetachedCapture.js';
import { historyMutationFailure } from './historyMutationEffects.js';

interface RankingHost {
  readonly wait: () => Promise<void>;
  readonly exclusive: <T>(action: () => Promise<T>) => Promise<T>;
  readonly commit: (
    policy: ToolRankingPolicy,
    overlay: ToolRankingOverlay | undefined,
  ) => Promise<CommittedGroup>;
  readonly snapshot: () => Promise<VersionSnapshot>;
}
export function openJournalToolRanking(
  host: RankingHost,
): (
  policy: ToolRankingPolicy,
  overlay?: ToolRankingOverlay,
) => Promise<VersionSnapshot> {
  return async (policy, overlay) => {
    await host.wait();
    return host.exclusive(async () => {
      const group = await host.commit(policy, overlay);
      await group.close();
      return host.snapshot();
    });
  };
}
export async function oldToolResponseRanking(): Promise<undefined> {
  return undefined;
}
export function captureSettledJournalSnapshot(
  wait: () => Promise<void>,
  snapshot: () => Promise<VersionSnapshot>,
  assertSettled: (snapshot: VersionSnapshot) => void,
): (
  settle: () => Promise<void>,
  signal?: AbortSignal,
) => Promise<VersionSnapshot> {
  return async (settle, signal) => {
    await waitForDetachedCapture(wait, signal);
    const saved = await snapshot();
    try {
      await waitForDetachedCapture(settle, signal);
      await waitForDetachedCapture(wait, signal);
      assertSettled(saved);
    } catch (error) {
      const cleanup: unknown[] = [];
      try {
        await saved.close();
      } catch (failure) {
        cleanup.push(failure);
      }
      throw historyMutationFailure(error, cleanup);
    }
    return saved;
  };
}
