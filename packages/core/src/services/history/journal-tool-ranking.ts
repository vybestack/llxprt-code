/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  ToolRankingPolicy,
  ToolRankingOverlay,
} from '../../journal/tool-ranking-fill.js';
import type { VersionEdit } from '../../journal/groupEdits.js';
import type { DensityFilePolicy } from '../../journal/density-file-facts.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { CommittedGroup } from '../../journal/journalStore.js';
import { waitForDetachedCapture } from './journalDetachedCapture.js';
import { historyMutationFailure } from './historyMutationEffects.js';

interface RankingHost {
  readonly wait: () => Promise<void>;
  readonly exclusive: <T>(action: () => Promise<T>) => Promise<T>;
  readonly commit: (edits: readonly VersionEdit[]) => Promise<CommittedGroup>;
  readonly snapshot: () => Promise<VersionSnapshot>;
}
export interface PolicySnapshotOpener {
  (
    policy: ToolRankingPolicy,
    overlay?: ToolRankingOverlay,
  ): Promise<VersionSnapshot>;
  files(policy: DensityFilePolicy): Promise<VersionSnapshot>;
}
export function openJournalToolRanking(
  host: RankingHost,
): PolicySnapshotOpener {
  const open = async (
    edits: readonly VersionEdit[],
  ): Promise<VersionSnapshot> => {
    await host.wait();
    return host.exclusive(async () => {
      const group = await host.commit(edits);
      await group.close();
      return host.snapshot();
    });
  };
  return Object.assign(
    (policy: ToolRankingPolicy, overlay?: ToolRankingOverlay) =>
      open([{ kind: 'toolRanking', policy, overlay }]),
    {
      files: (policy: DensityFilePolicy) =>
        open([{ kind: 'densityFiles', policy }]),
    },
  );
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
