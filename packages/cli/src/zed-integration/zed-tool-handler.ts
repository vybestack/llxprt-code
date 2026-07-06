/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolCallConfirmationDetails } from '@vybestack/llxprt-code-core';
import {
  ToolConfirmationOutcome,
  type ToolConfirmationPayload,
} from '@vybestack/llxprt-code-tools';
import type * as acp from '@agentclientprotocol/sdk';
import { z } from 'zod';
import { toPermissionOptions } from './zed-helpers.js';
import type {
  AgentToolCall,
  AgentToolResult,
  ToolUpdate,
} from '@vybestack/llxprt-code-agents';

type SendUpdateFn = (update: acp.SessionUpdate) => Promise<void>;
type Dict = Readonly<Record<string, unknown>>;

export async function emitToolCallStart(
  call: AgentToolCall,
  sendUpdate: SendUpdateFn,
): Promise<void> {
  await sendUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: call.id,
    status: 'in_progress',
    title: call.name,
    content: [],
    locations: buildToolLocations(call.args),
    kind: inferToolKind(call.name),
  });
}

export async function emitToolStatus(
  update: ToolUpdate,
  sendUpdate: SendUpdateFn,
): Promise<void> {
  const status = mapToolUpdateStatus(update.status);
  if (status === null) {
    return;
  }
  const text = stringifyToolOutput(update.output);
  await sendUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: update.id,
    status,
    content: text ? textContent(text) : [],
  });
}

export async function emitToolResult(
  result: AgentToolResult,
  sendUpdate: SendUpdateFn,
): Promise<void> {
  const isError = result.isError === true;
  const content = isError
    ? buildErrorContent(result)
    : buildSuccessContent(result);
  await sendUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: result.id,
    status: isError ? 'failed' : 'completed',
    content,
  });
}

function buildErrorContent(result: AgentToolResult): acp.ToolCallContent[] {
  return textContent(stringifyToolOutput(result.output));
}

export type PermissionRoundTripResult = {
  readonly decision: ToolConfirmationOutcome;
  readonly payload?: ToolConfirmationPayload;
  readonly requiresUserConfirmation?: boolean;
};

export async function requestToolConfirmation(
  sessionId: string,
  toolCallId: string,
  name: string,
  details: unknown,
  connection: acp.AgentSideConnection,
): Promise<PermissionRoundTripResult> {
  const confirmationDetails = coerceConfirmationDetails(details);
  const params: acp.RequestPermissionRequest = {
    sessionId,
    options:
      confirmationDetails === null
        ? defaultPermissionOptions()
        : toPermissionOptions(confirmationDetails),
    toolCall: {
      toolCallId,
      status: 'pending',
      title: confirmationDetails?.title ?? name,
      content: buildConfirmationContent(confirmationDetails),
      locations: buildConfirmationLocations(confirmationDetails),
      kind: inferToolKind(name),
    },
  };
  return parsePermissionOutcome(await connection.requestPermission(params));
}

function buildSuccessContent(result: AgentToolResult): acp.ToolCallContent[] {
  if (result.suppressDisplay === true) {
    return [];
  }
  const display = toDisplayContent(result.display);
  if (display !== null) {
    return [display];
  }
  return textContent(stringifyToolOutput(result.output));
}

function toDisplayContent(display: unknown): acp.ToolCallContent | null {
  const diff = coerceFileDiff(display);
  if (diff !== null) {
    return {
      type: 'diff',
      path: diff.fileName,
      oldText: diff.originalContent,
      newText: diff.newContent,
    };
  }
  const text = stringifyToolOutput(display);
  return text ? { type: 'content', content: { type: 'text', text } } : null;
}

function coerceFileDiff(display: unknown): {
  readonly fileName: string;
  readonly originalContent: string | null;
  readonly newContent: string;
} | null {
  const record = asRecord(display);
  if (record === null || typeof record.fileDiff !== 'string') {
    return null;
  }
  const { fileName, originalContent, newContent } = record;
  if (typeof fileName !== 'string') {
    return null;
  }
  if (typeof originalContent !== 'string' && originalContent !== null) {
    return null;
  }
  if (typeof newContent !== 'string') {
    return null;
  }
  return { fileName, originalContent, newContent };
}

function parsePermissionOutcome(
  output: acp.RequestPermissionResponse,
): PermissionRoundTripResult {
  if (output.outcome.outcome === 'cancelled') {
    return { decision: ToolConfirmationOutcome.Cancel };
  }
  const decision = z
    .nativeEnum(ToolConfirmationOutcome)
    .parse(output.outcome.optionId);
  const payload = parsePermissionPayload(output.outcome);
  const requiresUserConfirmation =
    decision === ToolConfirmationOutcome.SuggestEdit ||
    decision === ToolConfirmationOutcome.ModifyWithEditor;
  return {
    decision,
    ...(payload === undefined ? {} : { payload }),
    ...(requiresUserConfirmation ? { requiresUserConfirmation } : {}),
  };
}

function parsePermissionPayload(
  outcome: acp.RequestPermissionOutcome,
): ToolConfirmationPayload | undefined {
  if (outcome.outcome === 'cancelled') {
    return undefined;
  }
  const source = asRecord(readOutcomePayload(outcome)) ?? {};
  const editedCommand =
    typeof source.editedCommand === 'string'
      ? source.editedCommand.trim()
      : undefined;
  const newContent = source.newContent;
  const payload: ToolConfirmationPayload = {};
  if (editedCommand) {
    payload.editedCommand = editedCommand;
  }
  if (typeof newContent === 'string') {
    payload.newContent = newContent;
  }
  return Object.keys(payload).length === 0 ? undefined : payload;
}

function readOutcomePayload(outcome: acp.RequestPermissionOutcome): unknown {
  return asRecord(outcome)?.payload;
}

function coerceConfirmationDetails(
  details: unknown,
): ToolCallConfirmationDetails | null {
  const record = asRecord(details);
  return typeof record?.type === 'string'
    ? (details as ToolCallConfirmationDetails)
    : null;
}

function buildConfirmationContent(
  details: ToolCallConfirmationDetails | null,
): acp.ToolCallContent[] {
  if (details?.type !== 'edit') {
    return [];
  }
  return [
    {
      type: 'diff',
      path: details.fileName,
      oldText: details.originalContent,
      newText: details.newContent,
    },
  ];
}

function buildConfirmationLocations(
  details: ToolCallConfirmationDetails | null,
): acp.ToolCallLocation[] {
  const record = asRecord(details);
  const path = firstString(record, ['filePath', 'fileName']);
  return path === undefined ? [] : [buildLocation(path)];
}

function buildToolLocations(args: Dict): acp.ToolCallLocation[] {
  const paths = [
    firstString(args, [
      'absolute_path',
      'file_path',
      'path',
      'dir_path',
      'filePath',
    ]),
    ...readStringList(args.paths),
  ];
  const line = readLine(args);
  return paths
    .filter(isNonEmptyString)
    .map((path) => buildLocation(path, line));
}

function firstString(
  source: Dict | null,
  keys: readonly string[],
): string | undefined {
  return keys
    .map((key) => source?.[key])
    .find((value): value is string => isNonEmptyString(value));
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

function readLine(source: Dict): number | undefined {
  const raw = source.line_number ?? source.start_line ?? source.offset;
  const coerced =
    typeof raw === 'string' ? Number.parseInt(raw, 10) : (raw as number);
  return Number.isInteger(coerced) && coerced > 0 ? coerced : undefined;
}

function buildLocation(path: string, line?: number): acp.ToolCallLocation {
  return line === undefined ? { path } : { path, line };
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }
  const record = asRecord(output);
  if (typeof record?.content === 'string') {
    return record.content;
  }
  const error = asRecord(record?.error);
  if (typeof error?.message === 'string') {
    return error.message;
  }
  if (output === undefined || output === null) {
    return '';
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function textContent(text: string): acp.ToolCallContent[] {
  return text ? [{ type: 'content', content: { type: 'text', text } }] : [];
}

function mapToolUpdateStatus(
  status: ToolUpdate['status'],
): acp.ToolCallStatus | null {
  switch (status) {
    case 'validating':
    case 'scheduled':
    case 'awaiting-approval':
    case 'executing':
      return 'in_progress';
    case 'success':
      return 'completed';
    case 'error':
    case 'cancelled':
      return 'failed';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

const TOOL_KIND_BY_NAME = new Map<string, acp.ToolKind>([
  ...[
    'read_file',
    'read_line_range',
    'ast_read_file',
    'read_many_files',
    'read',
    'cat',
    'list_directory',
    'glob',
    'grep',
    'search_file_content',
    'ast_grep',
    'structural_analysis',
  ].map((name) => [name, 'read'] as const),
  ...[
    'write_file',
    'edit',
    'ast_edit',
    'apply_patch',
    'replace',
    'insert',
    'insert_at_line',
    'delete_line_range',
    'delete_file',
  ].map((name) => [name, 'edit'] as const),
  ...['run_shell_command', 'execute_command', 'exec'].map(
    (name) => [name, 'execute'] as const,
  ),
]);

function inferToolKind(name: string): acp.ToolKind | undefined {
  return TOOL_KIND_BY_NAME.get(name);
}

function asRecord(value: unknown): Dict | null {
  return value !== null && typeof value === 'object' ? (value as Dict) : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function defaultPermissionOptions(): acp.PermissionOption[] {
  return [
    {
      optionId: ToolConfirmationOutcome.ProceedOnce,
      name: 'Allow',
      kind: 'allow_once',
    },
    {
      optionId: ToolConfirmationOutcome.Cancel,
      name: 'Reject',
      kind: 'reject_once',
    },
  ];
}
