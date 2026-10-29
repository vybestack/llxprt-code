/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ApprovalLifecycleRecord } from '@vybestack/llxprt-code-core/scheduler/approval-lifecycle.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

export async function persistApprovalLifecycle(
  record: ApprovalLifecycleRecord,
  history: Pick<HistoryService, 'appendDisplay'> | null,
  origin?: object,
): Promise<void> {
  const identity = record.request.journalIdentity;
  if (identity === undefined) return;
  if (history === null)
    throw new Error('Journal approval has no history owner');
  await history.appendDisplay(
    {
      type: 'tool-approval',
      attemptId: identity.attemptId,
      callId: record.request.callId,
      format: 'json',
    },
    JSON.stringify({
      ...record,
      request: {
        callId: record.request.callId,
        name: record.request.name,
        args: record.request.args,
        journalIdentity: identity,
      },
    }),
    origin,
  );
}
