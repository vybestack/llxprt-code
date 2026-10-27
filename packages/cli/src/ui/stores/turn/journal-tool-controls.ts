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

export function hasJournalToolApproval(
  item: HistoryItem,
  pending: readonly HistoryItemWithoutId[],
): boolean {
  return (
    item.type === 'tool_group' &&
    item.tools.some(
      (tool) =>
        activeControl(tool, pending)?.status === ToolCallStatus.Confirming,
    )
  );
}

export function withJournalToolControls<T extends HistoryItem>(
  item: T,
  pending: readonly HistoryItemWithoutId[],
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
            status: control.status,
            confirmationDetails: control.confirmationDetails,
            ptyId: control.ptyId,
          };
    }),
  };
}
