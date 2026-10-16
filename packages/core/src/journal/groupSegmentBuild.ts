/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { RecordAppender } from './groupAppender.js';
import type { BuildContext, BuiltGroup } from './groupBuildShared.js';
import { buildIncremental } from './groupIncremental.js';
import type { GroupPlan, Segment } from './groupPlanTypes.js';
import { buildRebuilt } from './groupRebuild.js';
import type { MutationCode } from './recordKinds.js';
import { hasActiveSlot } from './version.js';

/**
 * Whether the new row sequence is a path copy of the tree of `plan.base`:
 * every row that is not replaced in place is still there, and the rows that
 * differ are entries or purged rows with the label of the row they replace
 * (or rows added). A dropped row, a summary, a streamed replace and rows of
 * another version break it.
 */
function isPathCopy(plan: GroupPlan, segments: readonly Segment[]): boolean {
  if (plan.rebuilt) return false;
  let kept = 0;
  let replaced = 0;
  for (const segment of segments) {
    switch (segment.kind) {
      case 'existing':
        if (segment.source !== plan.base) return false;
        kept += segment.to - segment.from;
        break;
      case 'entry':
        replaced += 1;
        break;
      case 'fresh':
        if (segment.role === 'purge') replaced += 1;
        else if (segment.role !== 'append' && segment.role !== 'insert') {
          return false;
        }
        break;
      case 'stream':
        return false;
      default: {
        const unknown: never = segment;
        throw new JournalFormatError(
          `Unknown segment ${JSON.stringify(unknown)}`,
        );
      }
    }
  }
  return kept + replaced === plan.base.rows;
}

/**
 * Builds a group whose rows were described as segments (design 4.4 to 4.6).
 * A path copy of the base with added or in-place rows takes the incremental
 * route; everything else, and an insert whose facts cannot be added in order,
 * is a rebuild of the whole history.
 */
export async function buildFromSegments(
  ctx: BuildContext,
  plan: GroupPlan,
  segments: readonly Segment[],
  mutation: MutationCode,
  appender: RecordAppender,
): Promise<BuiltGroup> {
  const writesRows = segments.some(
    (segment) => segment.kind === 'fresh' || segment.kind === 'stream',
  );
  if (writesRows && hasActiveSlot(plan.base.slots)) {
    throw new JournalFormatError(
      'A format slot is active, and filling its summaries is not part of this edit',
    );
  }
  if (isPathCopy(plan, segments)) {
    const built = await buildIncremental(
      ctx,
      plan,
      segments,
      mutation,
      appender,
    );
    if (built !== undefined) return built;
  }
  return buildRebuilt(ctx, plan, segments, mutation, appender);
}
