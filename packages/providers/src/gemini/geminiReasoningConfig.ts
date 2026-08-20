/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ReasoningEffort,
  ReasoningEffortMap,
  ReasoningEffortWireFormat,
  ReasoningEnabledMap,
  ReasoningEnabledWireFormat,
} from '@vybestack/llxprt-code-settings';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import {
  isPlainRecord,
  readEffortMap,
  readEffortWireFormat,
  readEnabledMap,
  readEnabledWireFormat,
  readOptionalBoolean,
  readOptionalEffort,
  readOptionalPositiveInteger,
  selectBehaviorValue,
} from '../reasoning/reasoning-behavior-parsing.js';
import type { DumpMode } from '../utils/dumpContext.js';
import { shouldDumpSDKContext } from '../utils/dumpSDKContext.js';

export interface ReasoningConfig {
  readonly enabled: boolean | undefined;
  readonly includeInResponse: boolean;
  readonly stripFromContext: 'all' | 'allButLast' | 'none';
  readonly effort: ReasoningEffort | undefined;
  readonly maxTokens: number | undefined;
  readonly effortWireFormat: ReasoningEffortWireFormat;
  readonly enabledWireFormat: ReasoningEnabledWireFormat;
  readonly effortMap: ReasoningEffortMap | undefined;
  readonly enabledMap: ReasoningEnabledMap | undefined;
}

export type StripPolicy = ReasoningConfig['stripFromContext'];

/** Maps generic effort to the existing Gemini 3 thinking-level ladder. */
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
    case 'max':
      return 'HIGH';
    default:
      return undefined;
  }
}

/** Strictly extract Gemini reasoning configuration from the invocation snapshot. */
export function extractReasoningConfig(
  options: NormalizedGenerateChatOptions,
): ReasoningConfig {
  const modelBehavior = options.invocation.modelBehavior;
  const ephemerals = options.invocation.ephemerals;
  const legacyReasoning = readLegacyReasoningObject(ephemerals['reasoning']);

  return {
    enabled: readOptionalBoolean(
      selectBehaviorValue(
        modelBehavior,
        'reasoning.enabled',
        selectLegacyValue(ephemerals, legacyReasoning, 'enabled'),
      ),
      'reasoning.enabled',
    ),
    includeInResponse: readIncludeInResponse(options, legacyReasoning),
    stripFromContext: readStripFromContext(options, legacyReasoning),
    effort: readOptionalEffort(
      selectBehaviorValue(
        modelBehavior,
        'reasoning.effort',
        selectLegacyValue(ephemerals, legacyReasoning, 'effort'),
      ),
    ),
    maxTokens: readOptionalPositiveInteger(
      selectBehaviorValue(
        modelBehavior,
        'reasoning.maxTokens',
        selectLegacyValue(ephemerals, legacyReasoning, 'maxTokens'),
      ),
      'reasoning.maxTokens',
    ),
    effortWireFormat: readEffortWireFormat(
      modelBehavior['reasoning.effortWireFormat'],
    ),
    enabledWireFormat: readEnabledWireFormat(
      modelBehavior['reasoning.enabledWireFormat'],
    ),
    effortMap: readEffortMap(modelBehavior['reasoning.effortMap']),
    enabledMap: readEnabledMap(modelBehavior['reasoning.enabledMap']),
  };
}

function readLegacyReasoningObject(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isPlainRecord(value)) {
    throw new Error('legacy reasoning ephemeral must be a JSON object');
  }
  return value;
}

/**
 * Legacy fallback precedence for generic reasoning values: the dotted
 * ephemeral key wins, then the nested legacy `reasoning` object member.
 */
function selectLegacyValue(
  ephemerals: Readonly<Record<string, unknown>>,
  legacyReasoning: Readonly<Record<string, unknown>> | undefined,
  key: string,
): unknown {
  const dotted = ephemerals[`reasoning.${key}`];
  return dotted !== undefined ? dotted : legacyReasoning?.[key];
}

function readIncludeInResponse(
  options: NormalizedGenerateChatOptions,
  legacyReasoning: Readonly<Record<string, unknown>> | undefined,
): boolean {
  const cliValue =
    options.invocation.cliSettings['reasoning.includeInResponse'];
  const legacyValue = selectLegacyValue(
    options.invocation.ephemerals,
    legacyReasoning,
    'includeInResponse',
  );
  return (
    readOptionalBoolean(
      cliValue === undefined ? legacyValue : cliValue,
      'reasoning.includeInResponse',
    ) !== false
  );
}

function readStripFromContext(
  options: NormalizedGenerateChatOptions,
  legacyReasoning: Readonly<Record<string, unknown>> | undefined,
): StripPolicy {
  const cliValue = options.invocation.cliSettings['reasoning.stripFromContext'];
  const value =
    cliValue === undefined
      ? selectLegacyValue(
          options.invocation.ephemerals,
          legacyReasoning,
          'stripFromContext',
        )
      : cliValue;
  if (value === undefined) {
    return 'all';
  }
  if (value === 'all' || value === 'allButLast' || value === 'none') {
    return value;
  }
  throw new Error(
    "reasoning.stripFromContext must be one of 'all', 'allButLast', or 'none'",
  );
}

/** Extract SDK context dump configuration from normalized options. */
export function extractDumpConfig(options: NormalizedGenerateChatOptions): {
  shouldDumpSuccess: boolean;
  shouldDumpError: boolean;
} {
  const dumpMode = readDumpMode(options.invocation.ephemerals.dumpcontext);
  return {
    shouldDumpSuccess: shouldDumpSDKContext(dumpMode, false),
    shouldDumpError: shouldDumpSDKContext(dumpMode, true),
  };
}

function readDumpMode(value: unknown): DumpMode | undefined {
  switch (value) {
    case 'now':
    case 'status':
    case 'on':
    case 'error':
    case 'off':
      return value;
    default:
      return undefined;
  }
}
