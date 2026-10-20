/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecordAppender } from './groupAppender.js';
import type { BuildContext, BuiltGroup } from './groupBuildShared.js';
import type { GroupPlan, Segment } from './groupPlanTypes.js';
import { buildFromSegments } from './groupSegmentBuild.js';
import type { MutationCode } from './recordKinds.js';

export { mapReader } from './groupBuildShared.js';
export type { BuildContext, BuiltGroup } from './groupBuildShared.js';

export function buildGroup(
  ctx: BuildContext,
  plan: GroupPlan,
  mutation: MutationCode,
  appender: RecordAppender,
): Promise<BuiltGroup> {
  if (plan.segments !== undefined) {
    return buildFromSegments(ctx, plan, plan.segments, mutation, appender);
  }
  const kept: Segment[] = [
    ...(plan.base.rows === 0
      ? []
      : [
          {
            kind: 'existing',
            source: plan.base,
            from: 0,
            to: plan.base.rows,
          } satisfies Segment,
        ]),
    ...(plan.range === undefined
      ? []
      : [{ kind: 'existing', ...plan.range } satisfies Segment]),
  ];
  const fresh: Segment[] = plan.newRows.map(({ label, draft }) => ({
    kind: 'fresh',
    label,
    draft,
    role: 'append',
  }));
  return buildFromSegments(ctx, plan, [...kept, ...fresh], mutation, appender);
}
