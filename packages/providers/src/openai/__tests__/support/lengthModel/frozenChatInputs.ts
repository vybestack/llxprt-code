/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: maps the settings of a frozen chat case (the ephemerals
 * the real send read) and the route of its format to the settings the chat
 * length model takes.
 */

import type { ToolFormat } from '@vybestack/llxprt-code-tools/IToolFormatter.js';
import type { FrozenSettings } from '../../../../__tests__/support/frozenWire/frozenCases.js';
import type { StripPolicy } from './chatDrops.js';
import type { ChatSettings } from './chatUnitFacts.js';
import type { KimiNameRule } from './kimiIdFacts.js';

const TOOL_FORMATS: Readonly<Partial<Record<string, ToolFormat>>> = {
  'openai-chat-plain': 'openai',
  'openai-chat-kimi': 'kimi',
  'openai-chat-mistral': 'mistral',
};

function stripOf(value: unknown): StripPolicy {
  if (value === undefined) return 'none';
  if (value === 'none' || value === 'all' || value === 'allButLast') {
    return value;
  }
  throw new Error(`unknown reasoning.stripFromContext ${String(value)}`);
}

function includeOf(value: unknown): boolean {
  if (value === undefined || typeof value === 'boolean') return value === true;
  throw new Error(`expected a boolean setting, saw ${String(value)}`);
}

export function chatSettingsOf(
  formatId: string,
  ephemerals: Readonly<Record<string, unknown>>,
  kimiRule: KimiNameRule = 'lastEligible',
): ChatSettings {
  const toolFormat = TOOL_FORMATS[formatId];
  if (toolFormat === undefined) throw new Error(`no chat format ${formatId}`);
  return {
    toolFormat,
    strip: stripOf(ephemerals['reasoning.stripFromContext']),
    includeInContext: includeOf(ephemerals['reasoning.includeInContext']),
    kimiRule,
  };
}

export function frozenChatSettings(
  formatId: string,
  settings: FrozenSettings,
  kimiRule: KimiNameRule = 'lastEligible',
): ChatSettings {
  return chatSettingsOf(formatId, settings.ephemerals, kimiRule);
}

/**
 * The system instruction the wire-body harness sends when a case draws none:
 * the call options helper fills it in, so the frozen bodies carry it.
 */
export const HARNESS_SYSTEM_INSTRUCTION = 'test system prompt';

export function frozenSystemInstruction(settings: FrozenSettings): string {
  return settings.systemInstruction ?? HARNESS_SYSTEM_INSTRUCTION;
}
