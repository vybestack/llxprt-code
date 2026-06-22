/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Config,
  type ToolResult,
  type AnyToolInvocation,
  type ContextAwareTool,
  type ToolCallConfirmationDetails,
  type ToolConfirmationPayload,
  logToolCall,
  convertToFunctionResponse,
  ToolConfirmationOutcome,
  DEFAULT_AGENT_ID,
} from '@vybestack/llxprt-code-core';
import { DiscoveredMCPTool } from '@vybestack/llxprt-code-mcp';
import type * as acp from '@agentclientprotocol/sdk';
import type { FunctionCall, Part } from '@google/genai';
import { z } from 'zod';
import { toToolCallContent, toPermissionOptions } from './zed-helpers.js';
import { extractToolResultText } from './zed-content-utils.js';

export type ToolRunResult = {
  parts: Part[];
  message?: string | null;
};

interface SendUpdateFn {
  (update: acp.SessionUpdate): Promise<void>;
}

function isMissingConfirmationDetails(
  value: unknown,
): value is null | undefined {
  return value == null;
}

export class ZedToolHandler {
  constructor(
    private readonly sessionId: string,
    private readonly config: Config,
    private readonly connection: acp.AgentSideConnection,
    private readonly sendUpdate: SendUpdateFn,
  ) {}

  async runTool(
    abortSignal: AbortSignal,
    promptId: string,
    fc: FunctionCall,
  ): Promise<ToolRunResult> {
    const callId = fc.id ?? `${fc.name}-${Date.now()}`;
    const args = fc.args ?? {};

    const startTime = Date.now();

    const errorResponse = this.buildErrorResponse(
      fc,
      callId,
      args,
      startTime,
      undefined,
      promptId,
    );

    if (!fc.name) {
      return errorResponse(new Error('Missing function name'));
    }

    const toolRegistry = this.config.getToolRegistry();
    const tool = toolRegistry.getTool(fc.name);
    const toolErrorResponse = this.buildErrorResponse(
      fc,
      callId,
      args,
      startTime,
      tool as ContextAwareTool | undefined,
      promptId,
    );

    if (!tool) {
      return toolErrorResponse(
        new Error(`Tool "${fc.name}" not found in registry.`),
      );
    }

    try {
      if ('context' in tool) {
        (tool as ContextAwareTool).context = {
          sessionId: this.sessionId,
          interactiveMode: true,
        };
      }

      const invocation = tool.build(args);
      const needsConfirmation = await this.requestToolPermission(
        invocation,
        tool as ContextAwareTool,
        callId,
        args,
        abortSignal,
      );

      if (needsConfirmation.cancelled) {
        return toolErrorResponse(
          new Error(`Tool "${fc.name}" was canceled by the user.`),
        );
      }

      return await this.executeToolAndBuildResult(
        invocation,
        fc,
        callId,
        args,
        promptId,
        startTime,
        tool as ContextAwareTool,
        abortSignal,
      );
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));

      await this.sendUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: callId,
        status: 'failed',
        content: [
          { type: 'content', content: { type: 'text', text: error.message } },
        ],
      });

      return toolErrorResponse(error);
    }
  }

  private buildErrorResponse(
    fc: FunctionCall,
    callId: string,
    args: Record<string, unknown>,
    startTime: number,
    tool: ContextAwareTool | undefined,
    promptId: string,
  ): (error: Error) => ToolRunResult {
    return (error: Error): ToolRunResult => {
      const durationMs = Date.now() - startTime;
      logToolCall(this.config, {
        'event.name': 'tool_call',
        'event.timestamp': new Date().toISOString(),
        prompt_id: promptId,
        function_name: fc.name ?? '',
        function_args: args,
        duration_ms: durationMs,
        success: false,
        error: error.message,
        tool_type:
          typeof tool !== 'undefined' && tool instanceof DiscoveredMCPTool
            ? 'mcp'
            : 'native',
        agent_id: DEFAULT_AGENT_ID,
      });

      return {
        parts: [
          {
            functionCall: {
              id: callId,
              name: fc.name ?? '',
              args,
            },
          },
          {
            functionResponse: {
              id: callId,
              name: fc.name ?? '',
              response: { error: error.message },
            },
          },
        ],
        message: error.message,
      };
    };
  }

  async requestToolPermission(
    invocation: AnyToolInvocation,
    tool: ContextAwareTool,
    callId: string,
    _args: Record<string, unknown>,
    abortSignal: AbortSignal,
  ): Promise<{ cancelled: boolean }> {
    const confirmationDetails:
      | ToolCallConfirmationDetails
      | false
      | null
      | undefined = await invocation.shouldConfirmExecute(abortSignal);

    if (
      confirmationDetails === false ||
      isMissingConfirmationDetails(confirmationDetails)
    ) {
      await this.sendUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: callId,
        status: 'in_progress',
        title: invocation.getDescription(),
        content: [],
        locations: invocation.toolLocations(),
        kind: (tool as { kind?: string }).kind as acp.ToolKind | undefined,
      });
      return { cancelled: false };
    }

    return this.handleConfirmationOutcome(
      confirmationDetails,
      invocation,
      tool,
      callId,
    );
  }

  async handleConfirmationOutcome(
    confirmationDetails: ToolCallConfirmationDetails,
    invocation: AnyToolInvocation,
    tool: ContextAwareTool,
    callId: string,
  ): Promise<{ cancelled: boolean }> {
    const content: acp.ToolCallContent[] = [];

    if (confirmationDetails.type === 'edit') {
      content.push({
        type: 'diff',
        path: confirmationDetails.fileName,
        oldText: confirmationDetails.originalContent,
        newText: confirmationDetails.newContent,
      });
    }

    const params: acp.RequestPermissionRequest = {
      sessionId: this.sessionId,
      options: toPermissionOptions(confirmationDetails),
      toolCall: {
        toolCallId: callId,
        status: 'pending',
        title: invocation.getDescription(),
        content,
        locations: invocation.toolLocations(),
        kind: (tool as { kind?: string }).kind as acp.ToolKind | undefined,
      },
    };

    const output = await this.connection.requestPermission(params);
    const { outcome, payload } = this.parsePermissionOutput(output);

    await confirmationDetails.onConfirm(outcome, payload);

    switch (outcome) {
      case ToolConfirmationOutcome.Cancel:
        return { cancelled: true };
      case ToolConfirmationOutcome.SuggestEdit:
        if (confirmationDetails.type !== 'exec' || !payload?.editedCommand) {
          return { cancelled: true };
        }
        break;
      case ToolConfirmationOutcome.ProceedOnce:
      case ToolConfirmationOutcome.ProceedAlways:
      case ToolConfirmationOutcome.ProceedAlwaysAndSave:
      case ToolConfirmationOutcome.ProceedAlwaysServer:
      case ToolConfirmationOutcome.ProceedAlwaysTool:
      case ToolConfirmationOutcome.ModifyWithEditor:
        break;
      default: {
        const resultOutcome: never = outcome;
        throw new Error(`Unexpected: ${resultOutcome}`);
      }
    }

    return { cancelled: false };
  }

  parsePermissionOutput(output: acp.RequestPermissionResponse): {
    outcome: ToolConfirmationOutcome;
    payload: ToolConfirmationPayload | undefined;
  } {
    let outcome: ToolConfirmationOutcome;
    let payload: ToolConfirmationPayload | undefined;

    if (output.outcome.outcome === 'cancelled') {
      outcome = ToolConfirmationOutcome.Cancel;
    } else {
      outcome = z
        .nativeEnum(ToolConfirmationOutcome)
        .parse(output.outcome.optionId);
      const selectedOutcome = output.outcome as {
        payload?: { editedCommand?: string };
      };
      const editedCommand = selectedOutcome.payload?.editedCommand?.trim();
      if (typeof editedCommand === 'string' && editedCommand.length > 0) {
        payload = { editedCommand };
      }
    }

    return { outcome, payload };
  }

  async executeToolAndBuildResult(
    invocation: AnyToolInvocation,
    fc: FunctionCall,
    callId: string,
    args: Record<string, unknown>,
    promptId: string,
    startTime: number,
    tool: ContextAwareTool,
    abortSignal: AbortSignal,
  ): Promise<ToolRunResult> {
    const toolResult: ToolResult = await invocation.execute(abortSignal);
    const content = toToolCallContent(toolResult);

    await this.sendUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: callId,
      status: 'completed',
      content: content ? [content] : [],
    });

    const durationMs = Date.now() - startTime;
    logToolCall(this.config, {
      'event.name': 'tool_call',
      'event.timestamp': new Date().toISOString(),
      function_name: fc.name!,
      function_args: args,
      duration_ms: durationMs,
      success: true,
      prompt_id: promptId,
      tool_type: tool instanceof DiscoveredMCPTool ? 'mcp' : 'native',
      agent_id: DEFAULT_AGENT_ID,
    });

    const functionResponseParts = convertToFunctionResponse(
      fc.name!,
      callId,
      toolResult.llmContent,
      this.config,
    );
    const message = extractToolResultText(toolResult);

    return {
      parts: [
        {
          functionCall: {
            id: callId,
            name: fc.name!,
            args,
          },
        },
        ...functionResponseParts,
      ],
      message,
    };
  }
}
