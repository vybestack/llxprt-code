/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ToolCallRequestInfo } from '../core/turn.js';
import type { SerializableConfirmationDetails } from '../confirmation-bus/types.js';
import type {
  ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  ToolConfirmationPayload,
} from '@vybestack/llxprt-code-tools';

export interface ApprovalLifecycleRecord {
  readonly request: Pick<
    ToolCallRequestInfo,
    'callId' | 'name' | 'args' | 'journalIdentity'
  >;
  readonly details: SerializableConfirmationDetails;
  readonly status:
    | 'awaiting_approval'
    | 'scheduled'
    | 'cancelled'
    | 'modifying';
  readonly aborted?: boolean;
  readonly outcome?: ToolConfirmationOutcome;
  readonly payload?: ToolConfirmationPayload;
}

export class ApprovalPublicationError extends Error {}

export type ApprovalLifecycleWriter = (
  record: ApprovalLifecycleRecord,
) => Promise<void>;

export function serializableApprovalDetails(
  details: ToolCallConfirmationDetails | SerializableConfirmationDetails,
): SerializableConfirmationDetails {
  const { title } = details;
  switch (details.type) {
    case 'info':
      return {
        type: 'info',
        title,
        prompt: details.prompt,
        urls: details.urls,
      };
    case 'exec':
      return {
        type: 'exec',
        title,
        command: details.command,
        rootCommand: details.rootCommand,
        rootCommands: details.rootCommands,
      };
    case 'edit':
      return {
        type: 'edit',
        title,
        fileName: details.fileName,
        filePath: details.filePath,
        fileDiff: details.fileDiff,
        originalContent: details.originalContent,
        newContent: details.newContent,
      };
    case 'mcp':
      return {
        type: 'mcp',
        title,
        serverName: details.serverName,
        toolName: details.toolName,
        toolDisplayName: details.toolDisplayName,
      };
    default:
      throw new Error('Unknown approval details');
  }
}
