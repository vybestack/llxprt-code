/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ToolCallRequestInfo,
  ToolErrorType,
  DEFAULT_AGENT_ID,
} from '../index.js';
import { type Part } from '@google/genai';
import { type Config, ApprovalMode } from '../config/config.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { PolicyDecision } from '../policy/types.js';
import {
  CoreToolScheduler,
  type CompletedToolCall,
} from './coreToolScheduler.js';
import { loadDefaultPolicies } from '../policy/toml-loader.js';

/**
 * Configuration subset required for non-interactive tool execution.
 */
export type ToolExecutionConfig = Pick<
  Config,
  | 'getToolRegistry'
  | 'getEphemeralSettings'
  | 'getEphemeralSetting'
  | 'getExcludeTools'
  | 'getSessionId'
  | 'getTelemetryLogPromptsEnabled'
> &
  Partial<
    Pick<
      Config,
      | 'getAllowedTools'
      | 'getApprovalMode'
      | 'getMessageBus'
      | 'getPolicyEngine'
    >
  >;

/**
 * Executes a single tool call non-interactively by leveraging the CoreToolScheduler.
 *
 * This is a thin wrapper that:
 * 1. Creates a temporary CoreToolScheduler with a non-interactive PolicyEngine
 * 2. Schedules the tool call
 * 3. Returns the completed result
 *
 * Non-interactive mode means:
 * - Tools that require user approval (ASK_USER) are automatically rejected as policy violations
 *   (handled by PolicyEngine with nonInteractive: true)
 * - No live output updates are provided
 * - The scheduler is disposed after execution
 *
 * Note: Emoji filtering is handled by the individual tools (edit.ts, write-file.ts)
 * so it is not duplicated here.
 */
export async function executeToolCall(
  config: ToolExecutionConfig,
  toolCallRequest: ToolCallRequestInfo,
  abortSignal?: AbortSignal,
): Promise<CompletedToolCall> {
  const startTime = Date.now();

  const agentId = toolCallRequest.agentId ?? DEFAULT_AGENT_ID;
  toolCallRequest.agentId = agentId;

  const internalAbortController = new AbortController();
  let parentAbortHandler: (() => void) | null = null;
  if (abortSignal) {
    if (abortSignal.aborted) {
      internalAbortController.abort();
    } else {
      parentAbortHandler = (): void => internalAbortController.abort();
      abortSignal.addEventListener('abort', parentAbortHandler, { once: true });
    }
  }

  const schedulerConfig = await createSchedulerConfigForNonInteractive(config);

  let completionResolver: ((calls: CompletedToolCall[]) => void) | null = null;
  const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
    completionResolver = resolve;
  });

  const scheduler = new CoreToolScheduler({
    config: schedulerConfig as unknown as Config,
    toolContextInteractiveMode: false,
    getPreferredEditor: () => undefined,
    onEditorClose: () => {},
    onAllToolCallsComplete: async (completedToolCalls) => {
      completionResolver?.(completedToolCalls);
    },
  });

  try {
    const effectiveSignal = internalAbortController.signal;
    await scheduler.schedule([toolCallRequest], effectiveSignal);

    const completedCalls = await completionPromise;
    if (completedCalls.length !== 1) {
      throw new Error('Non-interactive executor expects exactly one tool call');
    }

    const completed = completedCalls[0];

    if (!completed.response.agentId) {
      completed.response.agentId = agentId;
    }

    return completed;
  } catch (e) {
    return createErrorCompletedToolCall(
      toolCallRequest,
      e instanceof Error ? e : new Error(String(e)),
      ToolErrorType.UNHANDLED_EXCEPTION,
      Date.now() - startTime,
    );
  } finally {
    if (abortSignal && parentAbortHandler) {
      abortSignal.removeEventListener('abort', parentAbortHandler);
    }
    if (internalAbortController.signal.aborted) {
      scheduler.cancelAll();
    }
    scheduler.dispose();
  }
}

/**
 * Creates a PolicyEngine configured for non-interactive mode.
 * In non-interactive mode, ASK_USER decisions are converted to DENY.
 */
async function createNonInteractivePolicyEngine(
  policyEngine: PolicyEngine | undefined,
): Promise<PolicyEngine> {
  if (!policyEngine) {
    // Load default policies to ensure safe tools like todo_read/todo_write are allowed
    const defaultRules = await loadDefaultPolicies();
    return new PolicyEngine({
      rules: defaultRules,
      defaultDecision: PolicyDecision.ASK_USER, // Will convert to DENY for ASK_USER in nonInteractive mode
      nonInteractive: true,
    });
  }

  if (policyEngine.isNonInteractive()) {
    return policyEngine;
  }

  return new PolicyEngine({
    rules: [...policyEngine.getRules()],
    defaultDecision: policyEngine.getDefaultDecision(),
    nonInteractive: true,
  });
}

type SchedulerConfigMethods = Pick<
  Config,
  | 'getToolRegistry'
  | 'getEphemeralSettings'
  | 'getEphemeralSetting'
  | 'getExcludeTools'
  | 'getSessionId'
  | 'getTelemetryLogPromptsEnabled'
  | 'getAllowedTools'
  | 'getApprovalMode'
  | 'getMessageBus'
  | 'getPolicyEngine'
>;

async function createSchedulerConfigForNonInteractive(
  config: ToolExecutionConfig,
): Promise<SchedulerConfigMethods> {
  const policyEngine = await createNonInteractivePolicyEngine(
    config.getPolicyEngine?.(),
  );
  const messageBus = config.getMessageBus?.() ?? new MessageBus(policyEngine);

  return {
    getToolRegistry: () => config.getToolRegistry(),
    getEphemeralSettings: () => config.getEphemeralSettings(),
    getEphemeralSetting: (key: string) => config.getEphemeralSetting(key),
    getExcludeTools: () => config.getExcludeTools(),
    getSessionId: () => config.getSessionId(),
    getTelemetryLogPromptsEnabled: () => config.getTelemetryLogPromptsEnabled(),
    getAllowedTools: () => config.getAllowedTools?.(),
    getApprovalMode: () => config.getApprovalMode?.() ?? ApprovalMode.DEFAULT,
    getMessageBus: () => messageBus,
    getPolicyEngine: () => policyEngine,
  };
}

function createErrorCompletedToolCall(
  request: ToolCallRequestInfo,
  error: Error,
  errorType: ToolErrorType,
  durationMs: number,
): CompletedToolCall {
  return {
    status: 'error',
    request,
    response: {
      callId: request.callId,
      agentId: request.agentId ?? DEFAULT_AGENT_ID,
      error,
      errorType,
      resultDisplay: error.message,
      responseParts: [
        // Only functionResponse — the functionCall is already recorded in
        // history from the model's assistant message (Issue #244).
        {
          functionResponse: {
            id: request.callId,
            name: request.name,
            response: { error: error.message },
          },
        },
      ] as Part[],
    },
    durationMs,
  };
}
