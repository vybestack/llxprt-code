/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

/**
 * Payload for the `tool_script_event` event (issue #4084): operational record
 * of one code mode script run, written for display and audit. A run writes a
 * `started` record, one `call` record per nested tool call it made, and a
 * `finished` record. These records never enter model history: the model sees
 * only the `execute_tool_script` call and its single response, and replay
 * collects them separately so a resumed session can redraw the script card
 * without running the script again.
 *
 * The script source is not repeated here; it is the `source` argument of the
 * recorded `execute_tool_script` call. Argument summaries are bounded.
 */

export const TOOL_SCRIPT_ARGS_SUMMARY_MAX = 240;
export const TOOL_SCRIPT_ERROR_MESSAGE_MAX = 500;

const identity = {
  runId: z.string().min(1),
  parentCallId: z.string().min(1),
  time: z.string(),
};

export const ToolScriptCallStatusSchema = z.enum([
  'ok',
  'failed',
  'denied',
  'approval_required',
  'cancelled',
]);

export const ToolScriptApprovalSchema = z.enum([
  'not_required',
  'approved',
  'denied',
  'unavailable',
]);

export const ToolScriptStartedPayloadSchema = z
  .object({
    phase: z.literal('started'),
    ...identity,
    agentId: z.string(),
    purpose: z.string(),
    tools: z.array(z.string()),
  })
  .strict();

export const ToolScriptCallPayloadSchema = z
  .object({
    phase: z.literal('call'),
    ...identity,
    sequence: z.number().int().positive(),
    callId: z.string().min(1),
    tool: z.string(),
    argsSummary: z.string().max(TOOL_SCRIPT_ARGS_SUMMARY_MAX),
    approval: ToolScriptApprovalSchema,
    status: ToolScriptCallStatusSchema,
    completeness: z.enum(['complete', 'partial', 'unknown']).optional(),
    resultBytes: z.number().int().nonnegative(),
  })
  .strict();

export const ToolScriptFinishedPayloadSchema = z
  .object({
    phase: z.literal('finished'),
    ...identity,
    ok: z.boolean(),
    /** Named failure code; absent when the script completed. */
    errorCode: z.string().optional(),
    errorMessage: z.string().max(TOOL_SCRIPT_ERROR_MESSAGE_MAX).optional(),
    callCount: z.number().int().nonnegative(),
    partial: z.boolean(),
    inputBytes: z.number().int().nonnegative(),
    finalBytes: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
  })
  .strict();

export const ToolScriptEventPayloadSchema = z.discriminatedUnion('phase', [
  ToolScriptStartedPayloadSchema,
  ToolScriptCallPayloadSchema,
  ToolScriptFinishedPayloadSchema,
]);

export type ToolScriptEventPayload = z.infer<
  typeof ToolScriptEventPayloadSchema
>;
export type ToolScriptStartedPayload = z.infer<
  typeof ToolScriptStartedPayloadSchema
>;
export type ToolScriptCallPayload = z.infer<typeof ToolScriptCallPayloadSchema>;
export type ToolScriptFinishedPayload = z.infer<
  typeof ToolScriptFinishedPayloadSchema
>;
export type ToolScriptCallStatus = z.infer<typeof ToolScriptCallStatusSchema>;
export type ToolScriptApproval = z.infer<typeof ToolScriptApprovalSchema>;

/** Where replay collects script records, and how it reports bad ones. */
export interface ToolScriptEventSink {
  readonly toolScriptEvents: ToolScriptEventPayload[];
  malformedCount: number;
  readonly warnings: string[];
}

/**
 * Replay handling of one `tool_script_event` line: a valid record is
 * collected for display and audit; it never touches history.
 */
export function collectToolScriptEvent(
  payload: unknown,
  sink: ToolScriptEventSink,
  lineNumber: number,
): void {
  const parsed = ToolScriptEventPayloadSchema.safeParse(payload);
  if (parsed.success) {
    sink.toolScriptEvents.push(parsed.data);
    return;
  }
  sink.malformedCount++;
  sink.warnings.push(
    `Line ${lineNumber}: malformed tool_script_event, skipping`,
  );
}
