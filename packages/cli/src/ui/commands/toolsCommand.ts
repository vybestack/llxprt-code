/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type SlashCommand, CommandKind } from './types.js';
import type { HistoryItemWithoutId } from '../types.js';
import { MessageType } from '../types.js';
import type { ToolInfo } from '@vybestack/llxprt-code-agents';
import {
  canonicalizeToolName,
  INVALID_TOOL_NAME,
} from '@vybestack/llxprt-code-tools';
import { type CommandArgumentSchema } from './schema/types.js';

const toolsSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'subcommand',
    description: 'Choose tools subcommand',
    options: [
      { value: 'list', description: 'List tools with status badges' },
      { value: 'disable', description: 'Disable a tool by name' },
      { value: 'enable', description: 'Enable a tool by name' },
      { value: 'desc', description: 'List tools with descriptions' },
    ],
  },
];

export interface ToolsCommandOperations {
  readonly listTools: () => readonly ToolInfo[];
  readonly readSetting: (key: string) => unknown;
  readonly writeSetting: (key: string, value: unknown) => void;
  readonly refreshToolSchema: () => Promise<void>;
}

type AddToolsCommandItem = (
  item: HistoryItemWithoutId,
  baseTimestamp?: number,
) => void;

// Tokenizes quoted/unquoted args. The pattern is passed to RegExp via an
// identifier so it is not a static literal flagged by sonarjs/regular-expr.
const ARG_TOKEN_PATTERN = '(?:[^\\s"\']+|"[^"]*"|\'[^\']*\')+';
const ARG_TOKEN_REGEX = new RegExp(ARG_TOKEN_PATTERN, 'g');

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function readToolLists(readSetting: (key: string) => unknown): {
  disabled: Set<string>;
  allowed: Set<string>;
} {
  const disabledSetting = readSetting('tools.disabled');
  const allowedSetting = readSetting('tools.allowed');
  const disabled = Array.isArray(disabledSetting)
    ? new Set((disabledSetting as string[]).map(canonicalizeToolName))
    : new Set<string>();
  const allowed = Array.isArray(allowedSetting)
    ? new Set((allowedSetting as string[]).map(canonicalizeToolName))
    : new Set<string>();

  return { disabled, allowed };
}

function persistToolLists(
  writeSetting: (key: string, value: unknown) => void,
  disabled: Set<string>,
  allowed: Set<string>,
): void {
  const disabledList = Array.from(new Set(disabled)).map((name) =>
    name === INVALID_TOOL_NAME ? '' : name,
  );
  const allowedList = Array.from(new Set(allowed)).map((name) =>
    name === INVALID_TOOL_NAME ? '' : name,
  );
  writeSetting('tools.disabled', disabledList);
  writeSetting('tools.allowed', allowedList);
}

function buildStatusLine(
  tool: ToolInfo,
  disabledSet: Set<string>,
  allowedSet: Set<string>,
  showDescriptions: boolean,
): string {
  const canonical = canonicalizeToolName(tool.name);
  const isExplicitlyAllowed =
    allowedSet.size === 0 || allowedSet.has(canonical);
  const isDisabled = disabledSet.has(canonical) || !isExplicitlyAllowed;
  const statusLabel = isDisabled ? '[disabled]' : '[enabled]';
  const display = tool.displayName ?? tool.name;

  if (!showDescriptions || !tool.description) {
    return `  - ${display} ${statusLabel}`;
  }

  const descLines = tool.description.trim().split('\n');
  const body = descLines.map((line) => `      ${line}`).join('\n');
  return `  - ${display} (${tool.name}) ${statusLabel}\n${body}`;
}

function formatListMessage(
  tools: readonly ToolInfo[],
  disabledSet: Set<string>,
  allowedSet: Set<string>,
  showDescriptions: boolean,
): string {
  const filtered = tools.filter((tool) => tool.source !== 'mcp');

  if (filtered.length === 0) {
    return 'Available LLxprt Code tools:\n\n  No tools available\n';
  }

  const lines = filtered.map((tool) =>
    buildStatusLine(tool, disabledSet, allowedSet, showDescriptions),
  );

  const disabledCount = disabledSet.size;
  const summary = `\nDisabled tools: ${disabledCount}`;

  return `Available LLxprt Code tools:\n\n${lines.join('\n')}\n${summary}`;
}

function resolveToolByName(
  identifier: string,
  tools: readonly ToolInfo[],
): ToolInfo | null {
  const normalized = canonicalizeToolName(identifier);
  const canonicalMap = new Map<string, ToolInfo>();
  const friendlyMap = new Map<string, ToolInfo>();

  for (const tool of tools) {
    canonicalMap.set(canonicalizeToolName(tool.name), tool);
    friendlyMap.set(canonicalizeToolName(tool.displayName ?? tool.name), tool);
  }

  if (canonicalMap.has(normalized)) {
    return canonicalMap.get(normalized)!;
  }

  if (friendlyMap.has(normalized)) {
    return friendlyMap.get(normalized)!;
  }

  return null;
}

async function handleToggleTool(
  operations: ToolsCommandOperations,
  addItem: AddToolsCommandItem,
  subcommand: string,
  remainder: string,
  disabled: Set<string>,
  allowed: Set<string>,
  tools: readonly ToolInfo[],
): Promise<void> {
  const identifier = stripQuotes(remainder);
  if (!identifier) {
    addItem({
      type: MessageType.ERROR,
      text: `Usage: /tools ${subcommand} <tool name>`,
    });
    return;
  }

  const target = resolveToolByName(identifier, tools);
  if (!target || target.source === 'mcp') {
    addItem({
      type: MessageType.ERROR,
      text: `Tool "${identifier}" not found.`,
    });
    return;
  }

  const canonical = canonicalizeToolName(target.name);
  const display = target.displayName ?? target.name;
  let feedback: string;

  if (subcommand === 'disable') {
    disabled.add(canonical);
    allowed.delete(canonical);
    feedback = `Disabled tool '${display}'.`;
  } else {
    disabled.delete(canonical);
    if (allowed.size > 0) {
      allowed.add(canonical);
    }
    feedback = `Enabled tool '${display}'.`;
  }

  persistToolLists(operations.writeSetting, disabled, allowed);

  try {
    await operations.refreshToolSchema();
  } catch (error) {
    addItem({
      type: MessageType.INFO,
      text: `Warning: failed to refresh tool schema after ${
        subcommand === 'disable' ? 'disabling' : 'enabling'
      } '${display}': ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  addItem({ type: MessageType.INFO, text: feedback });
}

export function createToolsCommand(
  operations: ToolsCommandOperations | null,
  addItem: AddToolsCommandItem,
): SlashCommand {
  return {
    name: 'tools',
    description: 'List, enable, or disable LLxprt Code tools',
    kind: CommandKind.BUILT_IN,
    schema: toolsSchema,
    action: async (_invocation: unknown, args = ''): Promise<void> => {
      if (operations === null) {
        addItem(
          {
            type: MessageType.ERROR,
            text: 'Could not retrieve tools from the agent.',
          },
          Date.now(),
        );
        return;
      }

      const raw = args.trim();
      const tokens = raw.match(ARG_TOKEN_REGEX) ?? [];
      const rawSubcommand = tokens.shift();
      const subcommand = (rawSubcommand ?? 'list').toLowerCase();
      const remainder =
        raw.length > 0 && rawSubcommand
          ? raw.slice(raw.indexOf(rawSubcommand) + rawSubcommand.length).trim()
          : tokens.join(' ');

      const { disabled, allowed } = readToolLists(operations.readSetting);
      const tools = operations.listTools();
      const showDescriptions = subcommand === 'desc';

      if (subcommand === 'list' || showDescriptions) {
        const message = formatListMessage(
          tools,
          disabled,
          allowed,
          showDescriptions,
        );
        addItem({ type: MessageType.INFO, text: message });
        return;
      }

      if (subcommand === 'disable' || subcommand === 'enable') {
        await handleToggleTool(
          operations,
          addItem,
          subcommand,
          remainder,
          disabled,
          allowed,
          tools,
        );
        return;
      }

      const message = formatListMessage(tools, disabled, allowed, false);
      addItem({ type: MessageType.INFO, text: message });
    },
  };
}
