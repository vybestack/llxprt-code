/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  ApprovalMode,
} from '@vybestack/llxprt-code-core';
import type * as acp from '@agentclientprotocol/sdk';
import { z } from 'zod';

export function parseZedAuthMethodId(
  methodId: string,
  availableProfiles: string[],
): string {
  if (availableProfiles.length === 0) {
    throw new Error('No profiles available for selection');
  }
  return z.enum(availableProfiles as [string, ...string[]]).parse(methodId);
}

/**
 * Structural input for {@link toToolCallContent}: the display/error fields of
 * a tool execution result. Both the core `ToolResult` and the public
 * `AgentToolExecResult` (from `@vybestack/llxprt-code-agents`) satisfy it, so
 * Zed code can pass either without casts.
 */
export interface ToolCallContentInput {
  readonly returnDisplay?: unknown;
  readonly error?: unknown;
}

function getErrorMessage(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return undefined;
}

interface FileDiffDisplay {
  fileDiff: string;
  fileName: string;
  originalContent: string | null;
  newContent: string;
}

function isFileDiffDisplay(value: object): value is FileDiffDisplay {
  // returnDisplay is now typed `unknown` (it may be an AgentToolExecResult from
  // the public API surface), so an object carrying only `fileDiff` must NOT be
  // treated as a full FileDiffDisplay — that would yield `path: undefined` and
  // invalid ACP diff content. Require every field the diff branch dereferences.
  return (
    'fileDiff' in value &&
    'fileName' in value &&
    'originalContent' in value &&
    'newContent' in value
  );
}

export function toToolCallContent(
  toolResult: ToolCallContentInput,
): acp.ToolCallContent | null {
  const errorMessage = getErrorMessage(toolResult.error);
  if (errorMessage !== undefined && errorMessage.length > 0) {
    throw new Error(errorMessage);
  }

  const returnDisplay = toolResult.returnDisplay;
  // Preserve old falsy empty string return null behavior
  if (returnDisplay === '') {
    return null;
  }
  if (typeof returnDisplay === 'string') {
    return {
      type: 'content',
      content: { type: 'text', text: returnDisplay },
    };
  }
  if (typeof returnDisplay !== 'object' || returnDisplay === null) {
    return null;
  }
  if (isFileDiffDisplay(returnDisplay)) {
    return {
      type: 'diff',
      path: returnDisplay.fileName,
      oldText: returnDisplay.originalContent,
      newText: returnDisplay.newContent,
    };
  }
  const content =
    'content' in returnDisplay &&
    typeof (returnDisplay as { content: unknown }).content === 'string'
      ? (returnDisplay as { content: string }).content
      : '';
  return {
    type: 'content',
    content: { type: 'text', text: content },
  };
}

const basicPermissionOptions = [
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
] as const;

export function toPermissionOptions(
  confirmation: ToolCallConfirmationDetails,
): acp.PermissionOption[] {
  switch (confirmation.type) {
    case 'edit':
      return [
        {
          optionId: ToolConfirmationOutcome.ProceedAlways,
          name: 'Allow All Edits',
          kind: 'allow_always',
        },
        ...basicPermissionOptions,
      ];
    case 'exec':
      return [
        {
          optionId: ToolConfirmationOutcome.ProceedAlways,
          name: `Always Allow ${confirmation.rootCommand}`,
          kind: 'allow_always',
        },
        ...basicPermissionOptions,
      ];
    case 'mcp':
      return [
        {
          optionId: ToolConfirmationOutcome.ProceedAlwaysServer,
          name: `Always Allow ${confirmation.serverName}`,
          kind: 'allow_always',
        },
        {
          optionId: ToolConfirmationOutcome.ProceedAlwaysTool,
          name: `Always Allow ${confirmation.toolName}`,
          kind: 'allow_always',
        },
        ...basicPermissionOptions,
      ];
    case 'info':
      return [
        {
          optionId: ToolConfirmationOutcome.ProceedAlways,
          name: `Always Allow`,
          kind: 'allow_always',
        },
        ...basicPermissionOptions,
      ];
    default: {
      const unreachable: never = confirmation;
      throw new Error(`Unexpected: ${unreachable}`);
    }
  }
}

export function buildAvailableModes(): acp.SessionMode[] {
  return [
    {
      id: ApprovalMode.DEFAULT,
      name: 'Default',
      description: 'Prompts for approval',
    },
    {
      id: ApprovalMode.AUTO_EDIT,
      name: 'Auto Edit',
      description: 'Auto-approves edit tools',
    },
    {
      id: ApprovalMode.YOLO,
      name: 'YOLO',
      description: 'Auto-approves all tools',
    },
  ];
}
