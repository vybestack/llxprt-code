/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type CommandContext,
  type SlashCommand,
  CommandKind,
} from './types.js';
import { MessageType } from '../types.js';
import type {
  AnyDeclarativeTool,
  SettingsService,
} from '@vybestack/llxprt-code-core';
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
      { value: 'descriptions', description: 'Alias for desc' },
    ],
  },
];

const normalizeToolName = (name: string): string => name.trim().toLowerCase();

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

function getSettingsService(context: CommandContext): SettingsService | null {
  const config = context.services.config;
  if (config && typeof config.getSettingsService === 'function') {
    return config.getSettingsService();
  }
  return null;
}

function readToolLists(context: CommandContext): {
  disabled: Set<string>;
  allowed: Set<string>;
} {
  const settings = getSettingsService(context);
  const config = context.services.config;

  const read = (key: string): unknown => {
    if (settings) {
      return settings.get(key);
    }
    if (config && typeof config.getEphemeralSetting === 'function') {
      return config.getEphemeralSetting(key);
    }
    return undefined;
  };

  const disabled = Array.isArray(read('tools.disabled'))
    ? new Set((read('tools.disabled') as string[]).map(normalizeToolName))
    : new Set<string>();

  const allowed = Array.isArray(read('tools.allowed'))
    ? new Set((read('tools.allowed') as string[]).map(normalizeToolName))
    : new Set<string>();

  const legacy = read('disabled-tools');
  if (Array.isArray(legacy)) {
    for (const name of legacy as string[]) {
      disabled.add(normalizeToolName(name));
    }
  }

  return { disabled, allowed };
}

function persistToolLists(
  context: CommandContext,
  disabled: Set<string>,
  allowed: Set<string>,
): void {
  const disabledList = Array.from(new Set(disabled)).map((name) => name);
  const allowedList = Array.from(new Set(allowed)).map((name) => name);
  const config = context.services.config;
  const settings = getSettingsService(context);

  if (settings) {
    settings.set('tools.disabled', disabledList);
    settings.set('disabled-tools', disabledList);
    settings.set('tools.allowed', allowedList);
  }

  if (config) {
    if (typeof config.setEphemeralSetting === 'function') {
      config.setEphemeralSetting('tools.disabled', disabledList);
      config.setEphemeralSetting('disabled-tools', disabledList);
      config.setEphemeralSetting('tools.allowed', allowedList);
    }
    if (typeof config.getEphemeralSettings === 'function') {
      const ephemerals = config.getEphemeralSettings();
      if (ephemerals) {
        ephemerals['tools.disabled'] = disabledList;
        ephemerals['disabled-tools'] = disabledList;
        ephemerals['tools.allowed'] = allowedList;
      }
    }
  }
}

function buildStatusLine(
  tool: AnyDeclarativeTool,
  disabledSet: Set<string>,
  allowedSet: Set<string>,
  showDescriptions: boolean,
): string {
  const canonical = normalizeToolName(tool.name);
  const isExplicitlyAllowed =
    allowedSet.size === 0 || allowedSet.has(canonical);
  const isDisabled = disabledSet.has(canonical) || !isExplicitlyAllowed;
  const statusLabel = isDisabled ? '[disabled]' : '[enabled]';

  if (!showDescriptions || !tool.description) {
    return `  - ${tool.displayName} ${statusLabel}`;
  }

  const descLines = tool.description.trim().split('\n');
  const body = descLines.map((line) => `      ${line}`).join('\n');
  return `  - ${tool.displayName} (${tool.name}) ${statusLabel}\n${body}`;
}

function formatListMessage(
  tools: AnyDeclarativeTool[],
  disabledSet: Set<string>,
  allowedSet: Set<string>,
  showDescriptions: boolean,
): string {
  const filtered = tools.filter((tool) => !('serverName' in tool));

  if (filtered.length === 0) {
    return 'Available Gemini CLI tools:\n\n  No tools available\n';
  }

  const lines = filtered.map((tool) =>
    buildStatusLine(tool, disabledSet, allowedSet, showDescriptions),
  );

  const disabledCount = disabledSet.size;
  const summary = `\nDisabled tools: ${disabledCount}`;

  return `Available Gemini CLI tools:\n\n${lines.join('\n')}\n${summary}`;
}

function resolveToolByName(
  identifier: string,
  tools: AnyDeclarativeTool[],
): AnyDeclarativeTool | null {
  const normalized = normalizeToolName(identifier);
  const canonicalMap = new Map<string, AnyDeclarativeTool>();
  const friendlyMap = new Map<string, AnyDeclarativeTool>();

  for (const tool of tools) {
    canonicalMap.set(normalizeToolName(tool.name), tool);
    friendlyMap.set(normalizeToolName(tool.displayName), tool);
  }

  if (canonicalMap.has(normalized)) {
    return canonicalMap.get(normalized)!;
  }

  if (friendlyMap.has(normalized)) {
    return friendlyMap.get(normalized)!;
  }

  return null;
}

export const toolsCommand: SlashCommand = {
  name: 'tools',
  description: 'List, enable, or disable Gemini CLI tools',
  kind: CommandKind.BUILT_IN,
  schema: toolsSchema,
  action: async (context: CommandContext, args = ''): Promise<void> => {
    const config = context.services.config;
    const toolRegistry = await config?.getToolRegistry();

    if (!toolRegistry) {
      context.ui.addItem(
        {
          type: MessageType.ERROR,
          text: 'Could not retrieve tool registry.',
        },
        Date.now(),
      );
      return;
    }

    const raw = args.trim();
    const tokens = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
    const rawSubcommand = tokens.shift();
    const subcommand = (rawSubcommand ?? 'list').toLowerCase();
    const remainder =
      raw.length > 0 && rawSubcommand
        ? raw.slice(raw.indexOf(rawSubcommand) + rawSubcommand.length).trim()
        : tokens.join(' ');

    const { disabled, allowed } = readToolLists(context);
    const tools = toolRegistry.getAllTools();

    const showDescriptions =
      subcommand === 'desc' || subcommand === 'descriptions';

    if (subcommand === 'list' || showDescriptions) {
      const message = formatListMessage(
        tools,
        disabled,
        allowed,
        showDescriptions,
      );
      context.ui.addItem({ type: MessageType.INFO, text: message }, Date.now());
      return;
    }

    if (subcommand === 'disable' || subcommand === 'enable') {
      const identifier = stripQuotes(remainder);
      if (!identifier) {
        context.ui.addItem(
          {
            type: MessageType.ERROR,
            text: `Usage: /tools ${subcommand} <tool name>`,
          },
          Date.now(),
        );
        return;
      }

      const target = resolveToolByName(identifier, tools);
      if (!target || 'serverName' in target) {
        context.ui.addItem(
          {
            type: MessageType.ERROR,
            text: `Tool "${identifier}" not found.`,
          },
          Date.now(),
        );
        return;
      }

      const canonical = normalizeToolName(target.name);
      let feedback: string;

      if (subcommand === 'disable') {
        disabled.add(canonical);
        allowed.delete(canonical);
        feedback = `Disabled tool '${target.displayName}'.`;
      } else {
        disabled.delete(canonical);
        if (allowed.size > 0) {
          allowed.add(canonical);
        }
        feedback = `Enabled tool '${target.displayName}'.`;
      }

      persistToolLists(context, disabled, allowed);

      const geminiClient =
        typeof config?.getGeminiClient === 'function'
          ? config.getGeminiClient()
          : undefined;

      if (geminiClient && typeof geminiClient.setTools === 'function') {
        try {
          await geminiClient.setTools();
        } catch (error) {
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Warning: failed to refresh Gemini tool schema after ${
                subcommand === 'disable' ? 'disabling' : 'enabling'
              } '${target.displayName}': ${error instanceof Error ? error.message : String(error)}`,
            },
            Date.now(),
          );
        }
      }

      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: feedback,
        },
        Date.now(),
      );
      return;
    }

    const message = formatListMessage(tools, disabled, allowed, false);
    context.ui.addItem({ type: MessageType.INFO, text: message }, Date.now());
  },
};
