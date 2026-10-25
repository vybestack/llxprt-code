/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { filledVersion } from './filled-version.js';
import { mapReader, type BuildContext } from './groupBuildShared.js';
import type { VersionEdit } from './groupEdits.js';
import { nativeCatchupEdits } from './native-fact-catchup.js';
import {
  ACTIVE_FACT_INDEX,
  nativeFactCoverage,
  nativeFactVersion,
  type NativeFactIndexRegistration,
  type NativeFactIndexWriter,
} from './nativeFactIndex.js';
import type { Version } from './version.js';
import type { VersionSnapshot } from './versionSnapshot.js';

interface AppendPlan {
  readonly previous: Version;
  readonly edits: readonly VersionEdit[];
}

async function catchupPlan(
  ctx: BuildContext,
  snapshot: VersionSnapshot,
  scope: string,
): Promise<AppendPlan | undefined> {
  const reader = mapReader(ctx, 'meta');
  const root = ctx.published?.roots.metaRoot ?? 0;
  const coverage = nativeFactCoverage(
    await reader.get(root, ACTIVE_FACT_INDEX),
  );
  if (coverage?.scope !== scope) return undefined;
  const previous = await filledVersion(ctx, Number(coverage.through), true);
  if (previous === undefined || previous.commitSeq === ctx.published?.commitSeq)
    return undefined;
  const edits = await nativeCatchupEdits(snapshot, previous);
  return edits === undefined ? undefined : { previous, edits };
}

export async function maintainNativeFacts(
  ctx: BuildContext,
  snapshot: VersionSnapshot,
  writer: NativeFactIndexWriter,
  registration: NativeFactIndexRegistration,
  edits: readonly VersionEdit[],
): Promise<{ readonly invalidated: boolean; readonly rebuilt: boolean }> {
  const explicit = edits.some((edit) => edit.kind === 'factIndex');
  let plan: AppendPlan | undefined;
  if (explicit) plan = await catchupPlan(ctx, snapshot, registration.scope);
  else if (ctx.published !== undefined)
    plan = { previous: ctx.published, edits };
  let appended = false;
  let invalidated = false;
  if (registration.append !== undefined && plan !== undefined) {
    appended = await registration.append(
      snapshot,
      writer,
      plan.previous,
      plan.edits,
    );
    invalidated = !appended;
  }
  const rebuilt = !appended;
  if (rebuilt) {
    const previous = await writer.get(['version']);
    const generation = nativeFactVersion(
      (previous?.[0] ?? 0) + (previous?.[1] ?? 0) * 0x1_0000_0000 + 1,
    );
    await registration.write(snapshot, writer, generation);
    await writer.set(['version'], generation);
    invalidated = false;
  }
  return { invalidated, rebuilt };
}
