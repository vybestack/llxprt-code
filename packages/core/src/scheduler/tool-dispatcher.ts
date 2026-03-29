/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @internal
 * Handles tool resolution, governance checks, invocation building, and typo
 * suggestions. Extracted from CoreToolScheduler as part of the Phase 1
 * decomposition (issue 1580).
 */

import type { ToolCallRequestInfo } from '../core/turn.js';
import type { AnyDeclarativeTool, AnyToolInvocation } from '../tools/tools.js';
import type { ToolCall } from './types.js';
import type { ToolGovernance } from '../core/toolGovernance.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import type { Config } from '../config/config.js';
import { createErrorResponse } from '../utils/generateContentResponseUtilities.js';
import { setToolContext } from './utils.js';
import { ToolErrorType } from '../tools/tool-error.js';
import { isToolBlocked } from '../core/toolGovernance.js';
import { DEFAULT_AGENT_ID } from '../core/turn.js';
import levenshtein from 'fast-levenshtein';

export class ToolDispatcher {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly config: Config,
  ) {}

  /**
   * Resolves and validates a batch of tool call requests, returning the
   * corresponding ToolCall state objects (either ValidatingToolCall or
   * ErroredToolCall). This is a pure synchronous operation — no async
   * confirmation logic is performed here.
   */
  resolveAndValidate(
    requests: ToolCallRequestInfo[],
    governance: ToolGovernance,
    interactiveMode: boolean,
  ): ToolCall[] {
    return requests.map((reqInfo): ToolCall => {
      if (isToolBlocked(reqInfo.name, governance)) {
        const errorMessage = `Tool "${reqInfo.name}" is disabled in the current profile.`;
        return {
          status: 'error',
          request: reqInfo,
          response: createErrorResponse(
            reqInfo,
            new Error(errorMessage),
            ToolErrorType.TOOL_DISABLED,
          ),
          durationMs: 0,
        };
      }

      const toolInstance = this.toolRegistry.getTool(reqInfo.name);
      if (toolInstance == null) {
        const suggestion = this.getToolSuggestion(reqInfo.name);
        const errorMessage = `Tool "${reqInfo.name}" could not be loaded.${suggestion}`;
        return {
          status: 'error',
          request: reqInfo,
          response: createErrorResponse(
            reqInfo,
            new Error(errorMessage),
            ToolErrorType.TOOL_NOT_REGISTERED,
          ),
          durationMs: 0,
        };
      }

      setToolContext(
        toolInstance,
        this.config.getSessionId(),
        reqInfo.agentId ?? DEFAULT_AGENT_ID,
        interactiveMode,
      );

      const invocationOrError = this.buildInvocation(
        toolInstance,
        reqInfo.args,
      );
      if (invocationOrError instanceof Error) {
        return {
          status: 'error',
          request: reqInfo,
          tool: toolInstance,
          response: createErrorResponse(
            reqInfo,
            invocationOrError,
            ToolErrorType.INVALID_TOOL_PARAMS,
          ),
          durationMs: 0,
        };
      }

      return {
        status: 'validating',
        request: reqInfo,
        tool: toolInstance,
        invocation: invocationOrError,
        startTime: Date.now(),
      };
    });
  }

  /**
   * Attempts to build a tool invocation from the given args. Returns the
   * invocation on success, or an Error (never throws) on failure.
   */
  buildInvocation(
    tool: AnyDeclarativeTool,
    args: object,
  ): AnyToolInvocation | Error {
    try {
      return tool.build(args);
    } catch (e) {
      if (e instanceof Error) {
        return e;
      }
      return new Error(String(e));
    }
  }

  /**
   * Builds a friendly suggestion message when a tool name is not found,
   * using Levenshtein distance to find close matches.
   */
  getToolSuggestion(unknownToolName: string, topN = 3): string {
    const allToolNames = this.toolRegistry.getAllToolNames();
    if (!allToolNames.length) {
      return '';
    }

    const matches = allToolNames
      .map((toolName) => ({
        name: toolName,
        distance: levenshtein.get(unknownToolName, toolName),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, topN);

    if (!matches.length || matches[0].distance === Infinity) {
      return '';
    }

    const suggestedNames = matches.map((match) => `"${match.name}"`).join(', ');
    return matches.length > 1
      ? ` Did you mean one of: ${suggestedNames}?`
      : ` Did you mean ${suggestedNames}?`;
  }
}
