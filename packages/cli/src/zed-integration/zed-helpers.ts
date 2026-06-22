/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ToolResult,
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

export function toToolCallContent(
  toolResult: ToolResult,
): acp.ToolCallContent | null {
  if (toolResult.error?.message) {
    throw new Error(toolResult.error.message);
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
  if (typeof returnDisplay !== 'object') {
    return null;
  }
  if ('fileDiff' in returnDisplay) {
    return {
      type: 'diff',
      path: returnDisplay.fileName,
      oldText: returnDisplay.originalContent,
      newText: returnDisplay.newContent,
    };
  }
  const content =
    'content' in returnDisplay && typeof returnDisplay.content === 'string'
      ? returnDisplay.content
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
