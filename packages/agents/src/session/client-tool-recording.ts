/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import type {
  HistoryService,
  ToolCallRequestInfo,
} from '@vybestack/llxprt-code-core';

export async function recordClientRequests(
  history: HistoryService | null,
  requests: ToolCallRequestInfo | ToolCallRequestInfo[],
): Promise<ToolCallRequestInfo[]> {
  if (history === null)
    throw new Error('Client tools require initialized session history');
  const calls = Array.isArray(requests) ? requests : [requests];
  const initiated = calls.filter((call) => call.isClientInitiated);
  if (initiated.length === 0) return calls;
  const arrival = await history.openResponseArrival({
    id: `client-${randomUUID()}`,
    submissionId: 'client-tools',
  });
  for (const call of initiated)
    await arrival.append({
      type: 'tool_call',
      id: call.callId,
      name: call.name,
      parameters: call.args,
    });
  await arrival.seal({});
  return calls.map((call) =>
    call.isClientInitiated
      ? { ...call, journalIdentity: arrival.identity }
      : call,
  );
}
