/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  ApprovalMode,
  resolveEffectiveContextLimit,
  resolveProviderReportedLimit,
  resolveUserContextLimit,
  type Config,
} from '@vybestack/llxprt-code-core';
import type {
  AgentEvent,
  DoneReason,
  ThoughtSummary,
} from '@vybestack/llxprt-code-agents';
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
 * Maps an Agent-API {@link DoneReason} to the ACP {@link acp.StopReason} the Zed
 * client expects. Terminal failure reasons (`error`, `hook-stopped`) have no
 * clean stop reason and throw so the prompt path surfaces them as errors. Kept
 * here (a pure mapper alongside the other Zed mapping helpers) so zedIntegration.ts
 * stays within its max-lines budget.
 */
export function mapDoneReasonToStopReason(reason: DoneReason): acp.StopReason {
  switch (reason) {
    case 'stop':
    case 'loop-detected':
      return 'end_turn';
    case 'aborted':
      return 'cancelled';
    case 'max-turns':
      return 'max_turn_requests';
    case 'context-overflow':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    case 'error':
    case 'hook-stopped':
      throw new Error(`Agent stopped with terminal reason: ${reason}`);
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
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

/**
 * Builds the ACP session `modes` block (available modes + the session's current
 * mode) shared by the newSession and loadSession (disk-resume AND #1604
 * re-attach) responses. Typed via the response's `modes` field so it stays exact
 * without importing a possibly-renamed acp type. Centralized here so the mode
 * advertisement is identical across all three response paths.
 */
export function buildSessionModes(
  currentModeId: ApprovalMode,
): acp.LoadSessionResponse['modes'] {
  return {
    availableModes: buildAvailableModes(),
    currentModeId,
  };
}

/**
 * Flattens an Agent-API {@link ThoughtSummary} into the display text the Zed
 * thought-chunk carries: the non-empty subject/description joined by a space.
 * Pure mapper kept alongside the other Zed event mappers so zedIntegration.ts
 * stays within its max-lines budget.
 */
export function extractThoughtText(thought: ThoughtSummary): string {
  const parts = [thought.subject, thought.description].filter(
    (v) => v.length > 0,
  );
  return parts.join(' ');
}

/**
 * Translates an Agent `error` event into an Error for the prompt path, carrying
 * the upstream numeric `status` (when present) so downstream 429 handling can
 * still detect a rate-limit. Pure; extracted here to keep zedIntegration.ts thin.
 */
export function translateErrorEvent(
  event: Extract<AgentEvent, { type: 'error' }>,
): Error {
  const error = new Error(event.error.message);
  if (event.error.status !== undefined) {
    Object.assign(error, { status: event.error.status });
  }
  return error;
}

/**
 * Translates an Agent `idle-timeout` event into an Error carrying its message.
 * Pure; extracted here to keep zedIntegration.ts within its max-lines budget.
 */
export function translateIdleTimeout(
  event: Extract<AgentEvent, { type: 'idle-timeout' }>,
): Error {
  return new Error(event.error.message);
}

/**
 * Renders the pre-delivery debug line for a session/update notification: the
 * update kind plus the text length when the update carries text content. Pure;
 * extracted here to keep zedIntegration.ts within its max-lines budget.
 */
export function describeSessionUpdateForLog(update: acp.SessionUpdate): string {
  const chars =
    'content' in update && update.content && 'text' in update.content
      ? `(${update.content.text.length} chars)`
      : '';
  return `sendUpdate: ${update.sessionUpdate} ${chars}`;
}

/**
 * Builds the usage_update session notification for a turn's usage metadata
 * (issue #1607): `used` is the total tokens now in context (the response's
 * cumulative totalTokenCount) and `size` is the configured context-window
 * limit, so the client can render consumption against the real window rather
 * than against itself. When a provider omits cumulative `totalTokenCount`, the
 * candidate count is retained as a lower-bound fallback rather than suppressing
 * usage entirely; it represents only this completion, so it may under-report
 * context consumption but never overstates it. Returns null when the metadata
 * carries no usable count. `size` is clamped up to `used` so a mid-flight limit
 * change can never report used > size on the wire.
 */
export function buildUsageUpdate(
  usage: {
    readonly totalTokenCount?: number;
    readonly candidatesTokenCount?: number;
  },
  contextWindowSize: number,
): acp.SessionUpdate | null {
  const used = usage.totalTokenCount ?? usage.candidatesTokenCount ?? 0;
  if (used === 0) {
    return null;
  }
  return {
    sessionUpdate: 'usage_update',
    used,
    size: Math.max(contextWindowSize, used),
  };
}

/**
 * Resolves the effective context-window size for Zed usage updates, using the
 * shared core resolver so there is a single source of truth for the
 * user-override → provider-limit → model-name precedence (issues #2251 / #2815).
 */
export function resolveZedContextWindowSize(config: Config): number {
  let providerLimit: number | undefined;
  try {
    providerLimit = resolveProviderReportedLimit(
      config
        .getContentGeneratorConfig()
        ?.providerManager?.getActiveProvider()
        ?.getContextLimit?.(),
    );
  } catch {
    providerLimit = undefined;
  }
  return resolveEffectiveContextLimit(
    config.getModel(),
    resolveUserContextLimit(config.getEphemeralSetting('context-limit')),
    providerLimit,
  );
}
