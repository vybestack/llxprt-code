/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { shouldDumpSDKContext } from '../utils/dumpSDKContext.js';

type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ReasoningConfig {
  enabled: boolean;
  includeInResponse: boolean;
  stripFromContext: 'all' | 'allButLast' | 'none';
  effort: ReasoningEffort | undefined;
  maxTokens: number | undefined;
}

export type StripPolicy = ReasoningConfig['stripFromContext'];

/**
 * Maps a reasoning effort level to the corresponding Gemini 3.x thinkingLevel
 * string. Returns undefined when no effort is specified, allowing the API to
 * use its default.
 */
export function mapReasoningEffortToThinkingLevel(
  effort: ReasoningEffort | undefined,
): string | undefined {
  if (effort === undefined) {
    return undefined;
  }
  switch (effort) {
    case 'minimal':
    case 'low':
      return 'LOW';
    case 'medium':
      return 'MEDIUM';
    case 'high':
    case 'xhigh':
      return 'HIGH';
    default:
      return undefined;
  }
}

/**
 * Extract reasoning configuration from normalized options. Reads from
 * invocation model behaviors, CLI settings, and ephemerals, preserving the
 * legacy fallback precedence.
 */
export function extractReasoningConfig(
  options: NormalizedGenerateChatOptions,
): ReasoningConfig {
  const earlyEphemerals = options.invocation.ephemerals;
  const reasoningObj = (earlyEphemerals as Record<string, unknown>)[
    'reasoning'
  ] as Record<string, unknown> | undefined;
  const enabled =
    options.invocation.getModelBehavior<boolean>('reasoning.enabled') ??
    ((earlyEphemerals as Record<string, unknown>)['reasoning.enabled'] ===
      true ||
      reasoningObj?.enabled === true);
  const includeInResponse =
    options.invocation.getCliSetting<boolean>('reasoning.includeInResponse') ??
    ((earlyEphemerals as Record<string, unknown>)[
      'reasoning.includeInResponse'
    ] !== false &&
      reasoningObj?.includeInResponse !== false);
  const cliStripFromContext = options.invocation.getCliSetting<
    'all' | 'allButLast' | 'none'
  >('reasoning.stripFromContext');
  const ephemeralStripFromContext = (
    earlyEphemerals as Record<string, unknown>
  )['reasoning.stripFromContext'] as 'all' | 'allButLast' | 'none' | undefined;
  const objectStripFromContext = reasoningObj?.stripFromContext as
    | 'all'
    | 'allButLast'
    | 'none'
    | undefined;
  const stripFromContext =
    cliStripFromContext ??
    ephemeralStripFromContext ??
    objectStripFromContext ??
    'all';
  const effort =
    options.invocation.getModelBehavior<ReasoningEffort>('reasoning.effort') ??
    ((earlyEphemerals as Record<string, unknown>)['reasoning.effort'] as
      | ReasoningEffort
      | undefined) ??
    (reasoningObj?.effort as ReasoningEffort | undefined);
  const maxTokens =
    options.invocation.getModelBehavior<number>('reasoning.maxTokens') ??
    ((earlyEphemerals as Record<string, unknown>)['reasoning.maxTokens'] as
      | number
      | undefined) ??
    (reasoningObj?.maxTokens as number | undefined);
  return { enabled, includeInResponse, stripFromContext, effort, maxTokens };
}

/**
 * Extract dump SDK context config from normalized options.
 */
export function extractDumpConfig(options: NormalizedGenerateChatOptions): {
  shouldDumpSuccess: boolean;
  shouldDumpError: boolean;
} {
  const dumpMode = options.invocation.ephemerals.dumpcontext as Parameters<
    typeof shouldDumpSDKContext
  >[0];
  return {
    shouldDumpSuccess: shouldDumpSDKContext(dumpMode, false),
    shouldDumpError: shouldDumpSDKContext(dumpMode, true),
  };
}
