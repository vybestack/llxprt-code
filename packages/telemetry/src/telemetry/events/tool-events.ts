/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CompletedToolCallShape,
  HookEventName,
  HookInput,
  HookExecutionResult,
} from '../../internal/interfaces.js';
import {
  getDecisionFromOutcome,
  type ToolCallDecision,
} from '../tool-call-decision.js';
import { hasDiffStat, isMcpToolTelemetryShape } from './provider-context.js';

const DEFAULT_AGENT_ID = 'primary';

export class ToolCallEvent {
  'event.name': 'tool_call';
  'event.timestamp': string;
  function_name: string;
  function_args: Record<string, unknown>;
  duration_ms: number;
  success: boolean;
  decision?: ToolCallDecision;
  error?: string;
  error_type?: string;
  prompt_id: string;
  tool_type: 'native' | 'mcp';
  metadata?: Record<string, unknown>;
  agent_id: string;

  constructor(call: CompletedToolCallShape) {
    this['event.name'] = 'tool_call';
    this['event.timestamp'] = new Date().toISOString();
    this.function_name = call.request.name;
    this.function_args = call.request.args;
    this.duration_ms = call.durationMs ?? 0;
    this.success = call.status === 'success';
    this.decision =
      call.outcome !== undefined
        ? getDecisionFromOutcome(call.outcome)
        : undefined;
    this.error = call.response.error?.message;
    this.error_type = call.response.errorType;
    this.prompt_id = call.request.prompt_id;
    this.tool_type = isMcpToolTelemetryShape(call.tool) ? 'mcp' : 'native';
    this.agent_id = call.request.agentId ?? DEFAULT_AGENT_ID;

    const resultDisplay = call.response.resultDisplay;
    if (call.status === 'success' && hasDiffStat(resultDisplay)) {
      const { diffStat } = resultDisplay;
      if (diffStat !== undefined) {
        this.metadata = {
          ai_added_lines: diffStat.ai_added_lines,
          ai_removed_lines: diffStat.ai_removed_lines,
          user_added_lines: diffStat.user_added_lines,
          user_removed_lines: diffStat.user_removed_lines,
        };
      }
    }
  }
}

function resolveHookName(
  command: string | undefined,
  name: string | undefined,
): string {
  if (command !== undefined && command !== '') return command;
  if (name !== undefined && name !== '') return name;
  return '';
}

export class HookCallEvent {
  'event.name': 'hook_call';
  'event.timestamp': string;
  hook_event_name: HookEventName;
  hook_name: string;
  hook_input: HookInput;
  hook_output: HookInput | Record<string, unknown>;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  success: boolean;
  error: string;

  constructor(
    eventName: HookEventName,
    input: HookInput,
    result: HookExecutionResult,
  ) {
    this['event.name'] = 'hook_call';
    this['event.timestamp'] = new Date().toISOString();
    this.hook_event_name = eventName;
    this.hook_name = resolveHookName(
      result.hookConfig.command,
      result.hookConfig.name,
    );
    this.hook_input = input;
    this.hook_output =
      (result.output as Record<string, unknown> | undefined) ?? {};
    this.exit_code = result.exitCode ?? 0;
    this.stdout = result.stdout ?? '';
    this.stderr = result.stderr ?? '';
    this.duration_ms = result.duration;
    this.success = result.success;
    this.error = result.error?.message ?? '';
  }
}

export class ToolOutputTruncatedEvent {
  eventName: 'tool_output_truncated';
  prompt_id: string;
  tool_name: string;
  original_content_length: number;
  truncated_content_length: number;
  threshold: number;
  lines?: number;

  constructor(
    promptId: string,
    params: {
      toolName: string;
      originalContentLength: number;
      truncatedContentLength: number;
      threshold: number;
      lines?: number;
    },
  ) {
    this.eventName = 'tool_output_truncated';
    this.prompt_id = promptId;
    this.tool_name = params.toolName;
    this.original_content_length = params.originalContentLength;
    this.truncated_content_length = params.truncatedContentLength;
    this.threshold = params.threshold;
    this.lines = params.lines;
  }
}

export enum FileOperation {
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
}

export class FileOperationEvent {
  tool_name: string;
  operation: FileOperation | string;
  lines?: number;
  mimetype?: string;
  extension?: string;
  programming_language?: string;

  constructor(
    toolName: string,
    operation: FileOperation | string,
    lines?: number,
    mimetype?: string,
    extension?: string,
    programmingLanguage?: string,
  ) {
    this.tool_name = toolName;
    this.operation = operation;
    this.lines = lines;
    this.mimetype = mimetype;
    this.extension = extension;
    this.programming_language = programmingLanguage;
  }
}
