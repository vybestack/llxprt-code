/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  ApprovalPublicationError,
  type ApprovalLifecycleRecord,
  type ApprovalLifecycleWriter,
} from '@vybestack/llxprt-code-core/scheduler/approval-lifecycle.js';

import { serializableApprovalDetails } from '@vybestack/llxprt-code-core/scheduler/approval-lifecycle.js';
import type { ToolCallRequestInfo } from '@vybestack/llxprt-code-core/core/turn.js';
import type { WaitingToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import {
  ToolConfirmationOutcome,
  type ToolCallConfirmationDetails,
  type ToolConfirmationPayload,
} from '@vybestack/llxprt-code-tools';

export async function publishApprovalRequest(
  request: ToolCallRequestInfo,
  details: ToolCallConfirmationDetails,
  signal: AbortSignal,
  writer: ApprovalLifecycleWriter | undefined,
): Promise<void> {
  const serialized = serializableApprovalDetails(details);
  await publishApproval(
    { request, details: serialized, status: 'awaiting_approval' },
    writer,
  );
  if (!signal.aborted) return;
  await publishApproval(
    {
      request,
      details: serialized,
      status: 'cancelled',
      outcome: ToolConfirmationOutcome.Cancel,
      aborted: true,
    },
    writer,
  );
  signal.throwIfAborted();
}

export async function publishApprovalDecision(
  call: WaitingToolCall,
  outcome: ToolConfirmationOutcome,
  signal: AbortSignal,
  payload: ToolConfirmationPayload | undefined,
  writer: ApprovalLifecycleWriter | undefined,
): Promise<void> {
  let status: ApprovalLifecycleRecord['status'] = 'scheduled';
  if (signal.aborted || outcome === ToolConfirmationOutcome.Cancel)
    status = 'cancelled';
  else if (outcome === ToolConfirmationOutcome.ModifyWithEditor)
    status = 'modifying';
  await publishApproval(
    {
      request: call.request,
      details: serializableApprovalDetails(call.confirmationDetails),
      status,
      outcome,
      payload,
      aborted: signal.aborted,
    },
    writer,
  );
}

export async function publishApproval(
  record: ApprovalLifecycleRecord,
  writer: ApprovalLifecycleWriter | undefined,
): Promise<void> {
  if (record.request.journalIdentity === undefined) return;
  if (writer === undefined)
    throw new ApprovalPublicationError(
      'Journal approval has no lifecycle writer',
    );
  try {
    await writer(record);
  } catch (cause) {
    throw new ApprovalPublicationError(
      cause instanceof Error ? cause.message : String(cause),
      { cause },
    );
  }
}
