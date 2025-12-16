/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ToolCallRequestInfo,
  type ToolCallResponseInfo,
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
  type ToolCall,
} from './coreToolScheduler.js';
import { EmojiFilter, type FilterResult } from '../filters/EmojiFilter.js';

/**
 * Global emoji filter instance for reuse across tool calls
 */
let emojiFilter: EmojiFilter | null = null;

/**
 * Gets or creates the emoji filter instance based on current configuration
 * Always checks current configuration to ensure filter is up-to-date
 */
function getOrCreateFilter(config: ToolExecutionConfig): EmojiFilter {
  // Get emojifilter from ephemeral settings or default to 'auto'
  const mode =
    (config.getEphemeralSetting('emojifilter') as
      | 'allowed'
      | 'auto'
      | 'warn'
      | 'error') || 'auto';

  /**
   * @requirement REQ-004.1 - Silent filtering in auto mode
   * Use mode directly from settings
   */
  const filterMode: 'allowed' | 'auto' | 'warn' | 'error' = mode;

  // Always create a new filter to ensure current configuration is applied
  // Tool execution is infrequent enough that this performance cost is acceptable
  const filterConfig = { mode: filterMode };
  emojiFilter = new EmojiFilter(filterConfig);

  return emojiFilter;
}

/**
 * Filters file modification tool arguments
 */
function filterFileModificationArgs(
  filter: EmojiFilter,
  toolName: string,
  args: Record<string, unknown>,
): FilterResult {
  // Never filter file paths - they might legitimately contain emojis
  // Only filter the content being written to files

  if (
    toolName === 'edit_file' ||
    toolName === 'edit' ||
    toolName === 'replace' ||
    toolName === 'replace_all'
  ) {
    const oldString = args?.old_string as string;
    const newString = args?.new_string as string;

    // CRITICAL: Never filter old_string - it must match exactly what's in the file
    // Only filter new_string to prevent emojis from being written
    const newResult = filter.filterFileContent(newString, toolName);

    if (newResult.blocked) {
      return {
        filtered: null,
        emojiDetected: true,
        blocked: true,
        error: 'Cannot write emojis to code files',
      };
    }

    return {
      filtered: {
        ...args,
        // Preserve file_path unchanged - never filter paths
        file_path: args.file_path,
        // MUST preserve old_string exactly for matching
        old_string: oldString,
        // Filter new_string to remove emojis
        new_string: newResult.filtered,
      },
      emojiDetected: newResult.emojiDetected,
      blocked: false,
      systemFeedback: newResult.systemFeedback,
    };
  }

  if (toolName === 'write_file' || toolName === 'create_file') {
    const content = args.content as string;
    const result = filter.filterFileContent(content, toolName);

    if (result.blocked) {
      return result;
    }

    return {
      filtered: {
        ...args,
        // Preserve file_path unchanged - never filter paths
        file_path: args.file_path,
        content: result.filtered,
      },
      emojiDetected: result.emojiDetected,
      blocked: false,
      systemFeedback: result.systemFeedback,
    };
  }

  // Fallback for other tools
  return filter.filterToolArgs(args);
}

/**
 * Executes a single tool call non-interactively.
 * It does not handle confirmations, multiple calls, or live updates.
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

export async function executeToolCall(
  config: ToolExecutionConfig,
  toolCallRequest: ToolCallRequestInfo,
  abortSignal?: AbortSignal,
): Promise<CompletedToolCall> {
  const startTime = Date.now();

  const agentId = toolCallRequest.agentId ?? DEFAULT_AGENT_ID;
  toolCallRequest.agentId = agentId;

  const internalAbortController = new AbortController();
  if (abortSignal) {
    if (abortSignal.aborted) {
      internalAbortController.abort();
    } else {
      abortSignal.addEventListener(
        'abort',
        () => internalAbortController.abort(),
        { once: true },
      );
    }
  }

  const filter = getOrCreateFilter(config);
  let filteredRequest = toolCallRequest;
  let systemFeedback: string | undefined;

  try {
    const filtered = applyEmojiFiltering(filter, toolCallRequest);
    filteredRequest = filtered.filteredRequest;
    systemFeedback = filtered.systemFeedback;
  } catch (e) {
    return createErrorCompletedToolCall(
      toolCallRequest,
      e instanceof Error ? e : new Error(String(e)),
      ToolErrorType.INVALID_TOOL_PARAMS,
      Date.now() - startTime,
    );
  }

  const schedulerConfig = createSchedulerConfigForNonInteractive(config);

  let completionResolver: ((calls: CompletedToolCall[]) => void) | null = null;
  const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
    completionResolver = resolve;
  });

  let awaitingApprovalResolver: ((call: ToolCall) => void) | null = null;
  const awaitingApprovalPromise = new Promise<ToolCall>((resolve) => {
    awaitingApprovalResolver = resolve;
  });

  const scheduler = new CoreToolScheduler({
    config: schedulerConfig as unknown as Config,
    toolContextInteractiveMode: false,
    getPreferredEditor: () => undefined,
    onEditorClose: () => {},
    onAllToolCallsComplete: async (completedToolCalls) => {
      completionResolver?.(completedToolCalls);
    },
    onToolCallsUpdate: (toolCalls) => {
      try {
        const awaiting = toolCalls.find(
          (call) => call.status === 'awaiting_approval',
        );
        if (awaiting && awaitingApprovalResolver) {
          awaitingApprovalResolver(awaiting);
          awaitingApprovalResolver = null;
        }
      } catch {
        // Callback must be non-throwing.
      }
    },
  });

  try {
    const effectiveSignal = internalAbortController.signal;
    await scheduler.schedule([filteredRequest], effectiveSignal);

    const raceResult = await Promise.race([
      completionPromise.then((calls) => ({ kind: 'complete' as const, calls })),
      awaitingApprovalPromise.then((call) => ({
        kind: 'awaiting' as const,
        call,
      })),
    ]);

    if (raceResult.kind === 'awaiting') {
      internalAbortController.abort();
      scheduler.cancelAll();
      return createErrorCompletedToolCall(
        toolCallRequest,
        new Error(
          'Non-interactive tool execution reached awaiting_approval; treat as policy denial (no user interaction is possible).',
        ),
        ToolErrorType.POLICY_VIOLATION,
        Date.now() - startTime,
      );
    }

    const completedCalls = raceResult.calls;
    if (completedCalls.length !== 1) {
      throw new Error('Non-interactive executor expects exactly one tool call');
    }

    const completed = completedCalls[0];

    if (systemFeedback) {
      appendSystemFeedbackToResponse(completed.response, systemFeedback);
    }

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
    if (internalAbortController.signal.aborted) {
      scheduler.cancelAll();
    }
    scheduler.dispose();
  }
}

type EmojiFilteringResult = {
  filteredRequest: ToolCallRequestInfo;
  systemFeedback?: string;
};

function applyEmojiFiltering(
  filter: EmojiFilter,
  request: ToolCallRequestInfo,
): EmojiFilteringResult {
  const isSearchTool = [
    'shell',
    'bash',
    'exec',
    'run_shell_command',
    'grep',
    'search_file_content',
    'glob',
    'find',
    'ls',
    'list_directory',
    'read_file',
    'read_many_files',
  ].includes(request.name);

  if (isSearchTool) {
    return { filteredRequest: request };
  }

  const isFileModTool = [
    'edit_file',
    'edit',
    'write_file',
    'create_file',
    'replace',
    'replace_all',
  ].includes(request.name);

  const filterResult = isFileModTool
    ? filterFileModificationArgs(filter, request.name, request.args)
    : filter.filterToolArgs(request.args);

  if (filterResult.blocked) {
    throw new Error(filterResult.error || 'Tool execution blocked');
  }

  const filteredArgs =
    filterResult.filtered !== null && typeof filterResult.filtered === 'object'
      ? (filterResult.filtered as Record<string, unknown>)
      : request.args;

  if (filteredArgs === request.args && !filterResult.systemFeedback) {
    return { filteredRequest: request };
  }

  return {
    filteredRequest: {
      ...request,
      args: filteredArgs,
    },
    systemFeedback: filterResult.systemFeedback,
  };
}

function createNonInteractivePolicyEngine(
  policyEngine: PolicyEngine | undefined,
): PolicyEngine {
  if (!policyEngine) {
    return new PolicyEngine({
      rules: [],
      defaultDecision: PolicyDecision.DENY,
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

function createSchedulerConfigForNonInteractive(
  config: ToolExecutionConfig,
): SchedulerConfigMethods {
  const policyEngine = createNonInteractivePolicyEngine(
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
        {
          functionCall: {
            id: request.callId,
            name: request.name,
            args: request.args,
          },
        },
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

function appendSystemFeedbackToResponse(
  response: ToolCallResponseInfo,
  systemFeedback: string,
): void {
  const reminder = `\n\n<system-reminder>\n${systemFeedback}\n</system-reminder>`;

  if (response.error) {
    response.error = new Error(`${response.error.message}${reminder}`);
    if (response.resultDisplay) {
      response.resultDisplay = `${response.resultDisplay}${reminder}`;
    }

    const functionResponsePart = response.responseParts.find(
      (part) => part.functionResponse?.response,
    );
    const responseObj = functionResponsePart?.functionResponse?.response as
      | { error?: unknown }
      | undefined;
    if (responseObj && typeof responseObj.error === 'string') {
      responseObj.error = `${responseObj.error}${reminder}`;
    }

    return;
  }

  const functionResponsePart = response.responseParts.find(
    (part) => part.functionResponse?.response,
  );
  const responseObj = functionResponsePart?.functionResponse?.response as
    | { output?: unknown }
    | undefined;

  if (responseObj && typeof responseObj.output === 'string') {
    responseObj.output = `${responseObj.output}${reminder}`;
  }
}
