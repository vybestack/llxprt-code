/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  FileDiff,
  logToolCall,
  ToolCallRequestInfo,
  ToolCallResponseInfo,
  ToolErrorType,
  ToolResult,
  DEFAULT_AGENT_ID,
} from '../index.js';
import { Part } from '@google/genai';
import { DiscoveredMCPTool } from '../tools/mcp-tool.js';
import type { Config } from '../config/config.js';
import { convertToFunctionResponse } from './coreToolScheduler.js';
import { ToolCallDecision } from '../telemetry/types.js';
import { EmojiFilter, FilterResult } from '../filters/EmojiFilter.js';
import { DebugLogger } from '../debug/index.js';

/**
 * Global emoji filter instance for reuse across tool calls
 */
let emojiFilter: EmojiFilter | null = null;

const logger = new DebugLogger('llxprt:tool-executor');

function buildToolGovernance(config: ToolExecutionConfig): {
  allowed: Set<string>;
  disabled: Set<string>;
  excluded: Set<string>;
} {
  const ephemerals =
    typeof config.getEphemeralSettings === 'function'
      ? config.getEphemeralSettings() || {}
      : {};

  const allowedRaw = Array.isArray(ephemerals['tools.allowed'])
    ? (ephemerals['tools.allowed'] as string[])
    : [];
  const disabledRaw = Array.isArray(ephemerals['tools.disabled'])
    ? (ephemerals['tools.disabled'] as string[])
    : Array.isArray(ephemerals['disabled-tools'])
      ? (ephemerals['disabled-tools'] as string[])
      : [];
  const excludedRaw = config.getExcludeTools?.() ?? [];

  const normalize = (name: string) => name.trim().toLowerCase();

  return {
    allowed: new Set(allowedRaw.map(normalize)),
    disabled: new Set(disabledRaw.map(normalize)),
    excluded: new Set(excludedRaw.map(normalize)),
  };
}

function isToolBlocked(
  toolName: string,
  governance: ReturnType<typeof buildToolGovernance>,
): boolean {
  const canonical = toolName.trim().toLowerCase();
  if (governance.excluded.has(canonical)) {
    return true;
  }
  if (governance.disabled.has(canonical)) {
    return true;
  }
  if (governance.allowed.size > 0 && !governance.allowed.has(canonical)) {
    return true;
  }
  return false;
}

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
    toolName === 'replace'
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
>;

export async function executeToolCall(
  config: ToolExecutionConfig,
  toolCallRequest: ToolCallRequestInfo,
  abortSignal?: AbortSignal,
): Promise<ToolCallResponseInfo> {
  const agentId = toolCallRequest.agentId ?? DEFAULT_AGENT_ID;
  toolCallRequest.agentId = agentId;
  const toolRegistry = config.getToolRegistry();
  const governance = buildToolGovernance(config);
  const startTime = Date.now();
  const telemetryConfig: Pick<
    Config,
    'getSessionId' | 'getTelemetryLogPromptsEnabled'
  > = {
    getSessionId: () => config.getSessionId(),
    getTelemetryLogPromptsEnabled: () => config.getTelemetryLogPromptsEnabled(),
  };

  if (isToolBlocked(toolCallRequest.name, governance)) {
    const error = new Error(
      `Tool "${toolCallRequest.name}" is disabled in the current profile.`,
    );
    const durationMs = Date.now() - startTime;
    logToolCall(telemetryConfig, {
      'event.name': 'tool_call',
      'event.timestamp': new Date().toISOString(),
      function_name: toolCallRequest.name,
      function_args: toolCallRequest.args,
      duration_ms: durationMs,
      success: false,
      error: error.message,
      prompt_id: toolCallRequest.prompt_id,
      tool_type: 'native',
      agent_id: agentId,
    });
    return {
      callId: toolCallRequest.callId,
      error,
      errorType: ToolErrorType.TOOL_DISABLED,
      resultDisplay: error.message,
      responseParts: [
        {
          functionCall: {
            id: toolCallRequest.callId,
            name: toolCallRequest.name,
            args: toolCallRequest.args,
          },
        },
        {
          functionResponse: {
            id: toolCallRequest.callId,
            name: toolCallRequest.name,
            response: { error: error.message },
          },
        },
      ],
      agentId,
    };
  }

  const tool = toolRegistry.getTool(toolCallRequest.name);
  if (!tool) {
    const error = new Error(
      `Tool "${toolCallRequest.name}" not found in registry.`,
    );
    const durationMs = Date.now() - startTime;
    logToolCall(telemetryConfig, {
      'event.name': 'tool_call',
      'event.timestamp': new Date().toISOString(),
      function_name: toolCallRequest.name,
      function_args: toolCallRequest.args,
      duration_ms: durationMs,
      success: false,
      error: error.message,
      prompt_id: toolCallRequest.prompt_id,
      tool_type: 'native',
      agent_id: agentId,
    });
    // Ensure the response structure matches what the API expects for an error
    // Include both tool call and error response
    return {
      callId: toolCallRequest.callId,
      responseParts: [
        // Tool call
        {
          functionCall: {
            id: toolCallRequest.callId,
            name: toolCallRequest.name,
            args: toolCallRequest.args,
          },
        },
        // Error response
        {
          functionResponse: {
            id: toolCallRequest.callId,
            name: toolCallRequest.name,
            response: { error: error.message },
          },
        },
      ],
      resultDisplay: error.message,
      error,
      errorType: ToolErrorType.TOOL_NOT_REGISTERED,
      agentId,
    };
  }

  try {
    // Get emoji filter instance
    const filter = getOrCreateFilter(config);

    // Check if this is a search tool that should bypass filtering
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
    ].includes(toolCallRequest.name);

    let filteredArgs = toolCallRequest.args;
    let systemFeedback: string | undefined;

    // Search tools need unfiltered access for finding emojis
    if (!isSearchTool) {
      // Check if this is a file modification tool
      const isFileModTool = [
        'edit_file',
        'edit',
        'write_file',
        'create_file',
        'replace',
        'replace_all',
      ].includes(toolCallRequest.name);

      // Filter tool arguments
      let filterResult: FilterResult;
      if (isFileModTool) {
        filterResult = filterFileModificationArgs(
          filter,
          toolCallRequest.name,
          toolCallRequest.args,
        );
      } else {
        filterResult = filter.filterToolArgs(toolCallRequest.args);
      }

      // Handle blocking in error mode
      if (filterResult.blocked) {
        const durationMs = Date.now() - startTime;
        logToolCall(telemetryConfig, {
          'event.name': 'tool_call',
          'event.timestamp': new Date().toISOString(),
          function_name: toolCallRequest.name,
          function_args: toolCallRequest.args,
          duration_ms: durationMs,
          success: false,
          error: filterResult.error,
          prompt_id: toolCallRequest.prompt_id,
          tool_type:
            typeof tool !== 'undefined' && tool instanceof DiscoveredMCPTool
              ? 'mcp'
              : 'native',
          agent_id: agentId,
        });

        return {
          callId: toolCallRequest.callId,
          responseParts: [
            // Tool call
            {
              functionCall: {
                id: toolCallRequest.callId,
                name: toolCallRequest.name,
                args: toolCallRequest.args,
              },
            },
            // Error response
            {
              functionResponse: {
                id: toolCallRequest.callId,
                name: toolCallRequest.name,
                response: { error: filterResult.error },
              },
            },
          ],
          resultDisplay: filterResult.error || 'Tool execution blocked',
          error: new Error(filterResult.error || 'Tool execution blocked'),
          errorType: ToolErrorType.INVALID_TOOL_PARAMS,
          agentId,
        };
      }

      // Use filtered arguments
      filteredArgs = filterResult.filtered as Record<string, unknown>;
      systemFeedback = filterResult.systemFeedback;
    }

    // Directly execute without confirmation or live output handling
    const effectiveAbortSignal = abortSignal ?? new AbortController().signal;
    const toolResult: ToolResult = await tool.buildAndExecute(
      filteredArgs,
      effectiveAbortSignal,
      // No live output callback for non-interactive mode
    );

    const tool_output = toolResult.llmContent;

    const tool_display = toolResult.returnDisplay;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let metadata: { [key: string]: any } = {};
    if (
      toolResult.error === undefined &&
      typeof tool_display === 'object' &&
      tool_display !== null &&
      'diffStat' in tool_display
    ) {
      const diffStat = (tool_display as FileDiff).diffStat;
      if (diffStat) {
        metadata = {
          ai_added_lines: diffStat.ai_added_lines,
          ai_removed_lines: diffStat.ai_removed_lines,
          user_added_lines: diffStat.user_added_lines,
          user_removed_lines: diffStat.user_removed_lines,
        };
      }
    }
    const durationMs = Date.now() - startTime;
    logToolCall(telemetryConfig, {
      'event.name': 'tool_call',
      'event.timestamp': new Date().toISOString(),
      function_name: toolCallRequest.name,
      function_args: toolCallRequest.args,
      duration_ms: durationMs,
      success: toolResult.error === undefined,
      error:
        toolResult.error === undefined ? undefined : toolResult.error.message,
      error_type:
        toolResult.error === undefined ? undefined : toolResult.error.type,
      prompt_id: toolCallRequest.prompt_id,
      metadata,
      decision: ToolCallDecision.AUTO_ACCEPT,
      tool_type:
        typeof tool !== 'undefined' && tool instanceof DiscoveredMCPTool
          ? 'mcp'
          : 'native',
      agent_id: agentId,
    });

    // Add system feedback for warn mode if emojis were detected and filtered
    let finalLlmContent = tool_output;
    if (systemFeedback) {
      finalLlmContent = `${tool_output}\n\n<system-reminder>\n${systemFeedback}\n</system-reminder>`;
    }

    const finalResponse = convertToFunctionResponse(
      toolCallRequest.name,
      toolCallRequest.callId,
      finalLlmContent,
      config,
    );

    // Return BOTH the tool call and response as an array
    // This ensures they're always paired and added to history atomically
    const responseParts = [
      // First, the tool call from the model
      {
        functionCall: {
          id: toolCallRequest.callId,
          name: toolCallRequest.name,
          args: toolCallRequest.args,
        },
      },
      // Then, spread the tool response(s) since convertToFunctionResponse returns Part[]
      ...finalResponse,
    ] as Part[];

    logger.debug(
      () =>
        `Returning paired tool call and response for ${toolCallRequest.name} (${toolCallRequest.callId})`,
    );

    return {
      callId: toolCallRequest.callId,
      responseParts,
      resultDisplay: tool_display,
      error:
        toolResult.error === undefined
          ? undefined
          : new Error(toolResult.error.message),
      errorType:
        toolResult.error === undefined ? undefined : toolResult.error.type,
      agentId,
    };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    const durationMs = Date.now() - startTime;
    logToolCall(telemetryConfig, {
      'event.name': 'tool_call',
      'event.timestamp': new Date().toISOString(),
      function_name: toolCallRequest.name,
      function_args: toolCallRequest.args,
      duration_ms: durationMs,
      success: false,
      error: error.message,
      error_type: ToolErrorType.UNHANDLED_EXCEPTION,
      prompt_id: toolCallRequest.prompt_id,
      decision: ToolCallDecision.AUTO_ACCEPT,
      tool_type:
        typeof tool !== 'undefined' && tool instanceof DiscoveredMCPTool
          ? 'mcp'
          : 'native',
      agent_id: agentId,
    });
    return {
      callId: toolCallRequest.callId,
      responseParts: [
        // Tool call
        {
          functionCall: {
            id: toolCallRequest.callId,
            name: toolCallRequest.name,
            args: toolCallRequest.args,
          },
        },
        // Error response
        {
          functionResponse: {
            id: toolCallRequest.callId,
            name: toolCallRequest.name,
            response: { error: error.message },
          },
        },
      ],
      resultDisplay: error.message,
      error,
      errorType: ToolErrorType.UNHANDLED_EXCEPTION,
      agentId,
    };
  }
}
