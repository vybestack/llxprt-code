/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ToolErrorType,
  type SubagentConfig as ToolsSubagentConfig,
  type SubagentRequest,
  type SubagentResult,
} from '@vybestack/llxprt-code-tools';
import type { Config } from '../config/config.js';
import type { SubagentConfig as CoreSubagentConfig } from '../config/types.js';
import { ContextState, type OutputObject } from '../core/subagentTypes.js';
import { canonicalizeToolName } from '../core/toolGovernance.js';

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

  const sessionId = config?.getSessionId?.();
  if (sessionId && sessionId.length > 0) {
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
  const emittedVars = Object.entries(output.emitted_vars ?? {});
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
    emitted_vars: output.emitted_vars ?? {},
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
