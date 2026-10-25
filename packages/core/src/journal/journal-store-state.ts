/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RightSpine } from './rowTreeBuilder.js';
import type { GroupPlan } from './groupPlanTypes.js';

/** Labels written by an indexed group; streamed groups return none. */
export function writtenLabelsOf(plan: GroupPlan): bigint[] {
  if (plan.segments === undefined) return plan.newRows.map((row) => row.label);
  const labels: bigint[] = [];
  for (const segment of plan.segments) {
    if (segment.kind === 'fresh') labels.push(segment.label);
    if (segment.kind === 'foreign') labels.push(segment.row.entry.label);
  }
  return labels;
}

export interface SpineEntry {
  readonly rowRoot: number;
  readonly spine: RightSpine;
}
