/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Config,
  type ToolResult,
  type ToolCallConfirmationDetails,
  type ToolConfirmationPayload,
  logToolCall,
  convertToFunctionResponse,
  ToolConfirmationOutcome,
  DEFAULT_AGENT_ID,
} from '@vybestack/llxprt-code-core';
import type {
  AgentToolControl,
  AgentToolHandle,
  AgentToolInvocation,
} from '@vybestack/llxprt-code-agents';
import type * as acp from '@agentclientprotocol/sdk';
import type { FunctionCall, Part, PartListUnion } from '@google/genai';
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
    private readonly tools: Pick<AgentToolControl, 'get'>,
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

    const handle = this.tools.get(fc.name);
    const toolErrorResponse = this.buildErrorResponse(
      fc,
      callId,
      args,
      startTime,
      handle,
      promptId,
    );

    if (!handle) {
      return toolErrorResponse(
        new Error(`Tool "${fc.name}" not found in registry.`),
      );
    }

    try {
      handle.setContext?.({
        sessionId: this.sessionId,
        interactiveMode: true,
      });

      const invocation = handle.build(args);
      const needsConfirmation = await this.requestToolPermission(
        invocation,
        handle,
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
        handle,
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
    handle: AgentToolHandle | undefined,
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
        tool_type: handle?.source === 'mcp' ? 'mcp' : 'native',
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
    invocation: AgentToolInvocation,
    handle: AgentToolHandle,
    callId: string,
    _args: Record<string, unknown>,
    abortSignal: AbortSignal,
  ): Promise<{ cancelled: boolean }> {
    const confirmationDetails:
      | ToolCallConfirmationDetails
      | false
      | null
      | undefined = (await invocation.shouldConfirmExecute(abortSignal)) as
      | ToolCallConfirmationDetails
      | false
      | null
      | undefined;

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
        locations: invocation.toolLocations() as acp.ToolCallLocation[],
        kind: handle.kind as acp.ToolKind | undefined,
      });
      return { cancelled: false };
    }

    return this.handleConfirmationOutcome(
      confirmationDetails,
      invocation,
      handle,
      callId,
    );
  }

  async handleConfirmationOutcome(
    confirmationDetails: ToolCallConfirmationDetails,
    invocation: AgentToolInvocation,
    handle: AgentToolHandle,
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
        locations: invocation.toolLocations() as acp.ToolCallLocation[],
        kind: handle.kind as acp.ToolKind | undefined,
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
    invocation: AgentToolInvocation,
    fc: FunctionCall,
    callId: string,
    args: Record<string, unknown>,
    promptId: string,
    startTime: number,
    handle: AgentToolHandle,
    abortSignal: AbortSignal,
  ): Promise<ToolRunResult> {
    const execResult = await invocation.execute(abortSignal);
    const toolResult = execResult as unknown as ToolResult;
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
      tool_type: handle.source === 'mcp' ? 'mcp' : 'native',
      agent_id: DEFAULT_AGENT_ID,
    });

    const functionResponseParts = convertToFunctionResponse(
      fc.name!,
      callId,
      execResult.llmContent as PartListUnion,
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
