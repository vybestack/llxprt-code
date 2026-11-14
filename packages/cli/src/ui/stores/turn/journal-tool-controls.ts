/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  HistoryItem,
  HistoryItemWithoutId,
  IndividualToolCallDisplay,
} from '../../types.js';
import { ToolCallStatus } from '../../types.js';

function sameRequest(
  a: IndividualToolCallDisplay,
  b: IndividualToolCallDisplay,
): boolean {
  if (a.journalIdentity === undefined || b.journalIdentity === undefined)
    return false;
  return (
    a.journalIdentity.transcriptId === b.journalIdentity.transcriptId &&
    a.journalIdentity.attemptId === b.journalIdentity.attemptId &&
    a.callId === b.callId
  );
}

function activeControl(
  tool: IndividualToolCallDisplay,
  pending: readonly HistoryItemWithoutId[],
): IndividualToolCallDisplay | undefined {
  for (const item of pending) {
    if (item.type !== 'tool_group') continue;
    const control = item.tools.find((candidate) =>
      sameRequest(tool, candidate),
    );
    if (
      control &&
      (control.status === ToolCallStatus.Confirming ||
        control.status === ToolCallStatus.Executing ||
        control.status === ToolCallStatus.Pending)
    )
      return control;
  }
  return undefined;
}

export function withJournalToolControls<T extends HistoryItem>(
  item: T,
  pending: readonly HistoryItemWithoutId[],
  inlineApprovals = true,
): T {
  if (item.type !== 'tool_group') return item;
  return {
    ...item,
    tools: item.tools.map((tool) => {
      const control = activeControl(tool, pending);
      return control === undefined
        ? tool
        : {
            ...tool,
            name: control.name,
            description: control.description,
            status: control.status,
            confirmationDetails: inlineApprovals
              ? control.confirmationDetails
              : undefined,
            ptyId: control.ptyId,
          };
    }),
  };
}

/** Approval input stays mounted independently of journal paging and child journals. */
export function journalApprovals(
  pending: readonly HistoryItemWithoutId[],
): Array<Extract<HistoryItemWithoutId, { type: 'tool_group' }>> {
  return pending.flatMap((item) => {
    if (item.type !== 'tool_group') return [];
    return item.tools.flatMap((tool) =>
      tool.status === ToolCallStatus.Confirming &&
      tool.confirmationDetails !== undefined
        ? [{ ...item, tools: [tool] }]
        : [],
    );
  });
}
