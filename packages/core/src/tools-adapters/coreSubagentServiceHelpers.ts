/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  canonicalizeApiQualifiedToolName as canonicalizeToolsApiQualifiedToolName,
  canonicalizeToolName as canonicalizeToolsToolName,
  INVALID_TOOL_NAME,
  ToolErrorType,
  type SubagentConfig as ToolsSubagentConfig,
  type SubagentRequest,
  type SubagentResult,
} from '@vybestack/llxprt-code-tools';
import type { Config } from '../config/config.js';
import type { SubagentConfig as CoreSubagentConfig } from '../config/types.js';
function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

interface ToolGovernanceConfig {
  getEphemeralSettings?: () => Record<string, unknown> | undefined;
  getExcludeTools?: () => string[] | undefined;
}

export interface ToolGovernance {
  allowed: Set<string>;
  /**
   * Whether an explicit allowlist was provided (even if empty).
   *
   * - `false`: no explicit allowlist → unrestricted (runtime/profile defaults
   *   apply). Disabled/excluded still block.
   * - `true`: an explicit allowlist was provided. When `allowed` is empty,
   *   this means "block all normal tools" (fail-closed).
   */
  allowedExplicit: boolean;
  disabled: Set<string>;
  excluded: Set<string>;
}

export function canonicalizeToolName(rawName: string): string {
  const canonicalName = canonicalizeToolsToolName(rawName);
  return canonicalName === INVALID_TOOL_NAME ? '' : canonicalName;
}

export function canonicalizeApiQualifiedToolName(rawName: string): string {
  const canonicalName = canonicalizeToolsApiQualifiedToolName(rawName);
  return canonicalName === INVALID_TOOL_NAME ? '' : canonicalName;
}

export function buildToolGovernance(
  config: ToolGovernanceConfig,
): ToolGovernance {
  const ephemerals =
    typeof config.getEphemeralSettings === 'function'
      ? (config.getEphemeralSettings() ?? {})
      : {};

  const allowedValue = ephemerals['tools.allowed'];
  const allowedExplicit = isStringArray(allowedValue);
  const allowedRaw: string[] = allowedExplicit ? allowedValue : [];

  let disabledRaw: string[];
  if (isStringArray(ephemerals['tools.disabled'])) {
    disabledRaw = ephemerals['tools.disabled'];
  } else if (isStringArray(ephemerals['disabled-tools'])) {
    disabledRaw = ephemerals['disabled-tools'];
  } else {
    disabledRaw = [];
  }

  const excludedRaw =
    typeof config.getExcludeTools === 'function'
      ? (config.getExcludeTools() ?? [])
      : [];

  return {
    allowed: buildGovernanceNameSet(allowedRaw),
    allowedExplicit,
    disabled: buildGovernanceNameSet(disabledRaw),
    excluded: buildGovernanceNameSet(excludedRaw),
  };
}

function buildGovernanceNameSet(rawNames: string[]): Set<string> {
  return new Set(rawNames.flatMap(getExplicitToolNameCandidates));
}

const API_TOOL_NAMESPACE_PREFIXES = new Set([
  'api',
  'function',
  'functions',
  'github',
]);

interface ParsedToolName {
  canonical: string;
  segments: string[];
  prefix: string;
}

function parseToolName(toolName: string): ParsedToolName | undefined {
  const canonical = canonicalizeToolName(toolName);
  if (canonical.length === 0) {
    return undefined;
  }

  const segments = canonical.split('.');
  const prefix = segments[0]?.toLowerCase() ?? '';
  return { canonical, segments, prefix };
}

function appendCandidate(candidates: string[], name: string): void {
  const canonical = canonicalizeToolName(name);
  if (canonical.length > 0) {
    candidates.push(canonical);
  }
}

function buildToolNameCandidates(parsed: ParsedToolName): string[] {
  const { canonical, segments, prefix } = parsed;
  const candidates = [canonical];
  const hasKnownApiPrefix = API_TOOL_NAMESPACE_PREFIXES.has(prefix);

  if (segments.length > 1 && hasKnownApiPrefix) {
    if (segments.length > 2) {
      appendCandidate(candidates, segments.slice(1).join('.'));
    }
    if (segments.length === 2 || prefix === 'api') {
      appendCandidate(candidates, segments[segments.length - 1] ?? '');
    }
  }

  return candidates;
}

export function getToolNameCandidates(toolName: string): string[] {
  const parsed = parseToolName(toolName);
  return parsed ? Array.from(new Set(buildToolNameCandidates(parsed))) : [];
}

export const getExplicitToolNameCandidates = getToolNameCandidates;

export function isToolBlocked(
  toolName: string,
  governance: ToolGovernance,
): boolean {
  const candidates = getToolNameCandidates(toolName);

  if (candidates.some((canonical) => governance.excluded.has(canonical))) {
    return true;
  }

  if (candidates.some((canonical) => governance.disabled.has(canonical))) {
    return true;
  }

  if (
    governance.allowedExplicit &&
    !candidates.some((canonical) => governance.allowed.has(canonical))
  ) {
    return true;
  }

  return false;
}

import { ContextState, type OutputObject } from '../core/subagentTypes.js';

export const DEFAULT_AGENT_ID = 'main';

export function toToolsSubagentConfig(
  config: CoreSubagentConfig,
): ToolsSubagentConfig {
  return {
    name: config.name,
    instructions: config.systemPrompt,
    systemPrompt: config.systemPrompt,
    profile: config.profile,
    updatedAt: config.updatedAt,
  };
}

export function buildContextState(
  request: SubagentRequest,
  config?: Config,
): ContextState {
  const context = new ContextState();
  context.set('task_goal', request.prompt);
  context.set('task_name', request.name);

  const sessionId = config?.getSessionId();
  if (sessionId !== undefined && sessionId.length > 0) {
    context.set('sessionId', sessionId);
  }

  for (const [key, value] of Object.entries(request.context ?? {})) {
    context.set(key, value);
  }

  context.set('task_behaviour_prompts', [
    request.prompt,
    ...(request.behaviourPrompts ?? request.behaviorPrompts ?? []),
  ]);
  return context;
}

export function stringifySubagentOutput(output: OutputObject): string {
  if (output.final_message && output.final_message.trim().length > 0) {
    return output.final_message;
  }
  if (Object.keys(output.emitted_vars).length > 0) {
    return JSON.stringify(output.emitted_vars);
  }
  return `Subagent terminated with reason ${output.terminate_reason}.`;
}

export function createErrorResult(
  error: unknown,
  fallbackMessage: string,
  agentId?: string,
): SubagentResult {
  const detail = error instanceof Error && error.message ? error.message : null;
  const displayMessage = detail
    ? `${fallbackMessage}
Details: ${detail}`
    : fallbackMessage;
  const message = detail ?? fallbackMessage;
  return {
    output: displayMessage,
    success: false,
    error: message,
    llmContent: displayMessage,
    returnDisplay: displayMessage,
    metadata: agentId
      ? {
          agentId,
          error: message,
        }
      : undefined,
    errorType: ToolErrorType.UNHANDLED_EXCEPTION,
  };
}

export function createCancelledResult(
  message: string,
  agentId?: string,
  output?: OutputObject,
): SubagentResult {
  return {
    output: message,
    success: false,
    error: message,
    llmContent: message,
    returnDisplay: message,
    metadata: {
      agentId: agentId ?? DEFAULT_AGENT_ID,
      terminateReason: output?.terminate_reason,
      emittedVars: output?.emitted_vars ?? {},
      ...(output?.final_message ? { finalMessage: output.final_message } : {}),
      cancelled: true,
    },
    errorType: ToolErrorType.EXECUTION_FAILED,
  };
}

export function formatSuccessDisplay(
  subagentName: string,
  agentId: string,
  output: OutputObject,
): string {
  const emittedVars = Object.entries(output.emitted_vars);
  const finalMessageSection = output.final_message
    ? `Final message:\n${output.final_message}`
    : 'Final message: _(none)_';
  const emittedSection =
    emittedVars.length === 0
      ? 'Emitted variables: _(none)_'
      : `Emitted variables:\n${emittedVars
          .map(([key, value]) => `- **${key}**: ${value}`)
          .join('\n')}`;

  return [
    `Subagent **${subagentName}** (\`${agentId}\`) completed with status \`${output.terminate_reason}\`.`,
    finalMessageSection,
    emittedSection,
  ].join('\n\n');
}

export function formatSuccessContent(
  agentId: string,
  output: OutputObject,
): string {
  const payload: Record<string, unknown> = {
    agent_id: agentId,
    terminate_reason: output.terminate_reason,
    emitted_vars: output.emitted_vars,
  };

  if (output.final_message !== undefined) {
    payload.final_message = output.final_message;
  }

  return JSON.stringify(payload, null, 2);
}

export function normalizeSubagentStreamingText(text: string): string {
  if (!text) {
    return '';
  }
  const lf = text.replace(/\r\n?/g, '\n');
  return lf.endsWith('\n') ? lf : lf + '\n';
}

export function resolveTimeoutSeconds(
  requestedTimeoutSeconds: number | undefined,
  defaultTimeoutSeconds: number,
  maxTimeoutSeconds: number,
): number | undefined {
  if (requestedTimeoutSeconds === -1 || defaultTimeoutSeconds === -1) {
    return undefined;
  }

  const effectiveTimeout = requestedTimeoutSeconds ?? defaultTimeoutSeconds;
  if (maxTimeoutSeconds === -1) {
    return effectiveTimeout;
  }

  return Math.min(effectiveTimeout, maxTimeoutSeconds);
}

export function buildExcludedToolNames(): Set<string> {
  return new Set(
    ['task', 'list_subagents']
      .map((name) => canonicalizeToolName(name))
      .filter((name) => name.length > 0),
  );
}

export function isExcludedToolName(
  name: string,
  excluded: Set<string>,
): boolean {
  const canonical = canonicalizeToolName(name);
  return canonical.length > 0 && excluded.has(canonical);
}
