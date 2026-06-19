/**
 * @plan:PLAN-20260608-ISSUE1585.P11
 * @requirement:REQ-INTERFACE-OWNERSHIP, REQ-API-001
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import type {
  ISubagentService,
  SubagentExecutionOptions,
  SubagentRequest,
  SubagentResult,
} from '../interfaces/ISubagentService.js';
import { ToolErrorType } from '../types/tool-error.js';

export interface TaskToolParams {
  subagent_name?: string;
  subagentName?: string;
  name?: string;
  goal_prompt?: string;
  goalPrompt?: string;
  prompt?: string;
  behaviour_prompts?: string[];
  behavior_prompts?: string[];
  behaviourPrompts?: string[];
  behaviorPrompts?: string[];
  tool_whitelist?: string[];
  toolWhitelist?: string[];
  output_spec?: Record<string, unknown>;
  outputSpec?: Record<string, unknown>;
  timeout_seconds?: number;
  timeoutSeconds?: number;
  async?: boolean;
  context?: Record<string, unknown>;
  context_vars?: Record<string, unknown>;
  contextVars?: Record<string, unknown>;
}

interface NormalizedTaskParams {
  subagentName: string;
  prompt: string;
  behaviourPrompts: string[];
  toolWhitelist?: string[];
  hasExplicitToolWhitelist: boolean;
  outputSpec?: Record<string, unknown>;
  timeoutSeconds?: number;
  async: boolean;
  context: Record<string, unknown>;
}

function normalizeStringList(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function resolveBehaviourPrompts(params: TaskToolParams): string[] | undefined {
  return (
    params.behaviour_prompts ??
    params.behavior_prompts ??
    params.behaviourPrompts ??
    params.behaviorPrompts
  );
}

function normalizeTaskParams(params: TaskToolParams): NormalizedTaskParams {
  const prompt = params.goal_prompt ?? params.goalPrompt ?? params.prompt ?? '';
  const behaviourPrompts = normalizeStringList([
    prompt,
    ...(resolveBehaviourPrompts(params) ?? []),
  ]);
  const toolWhitelist = normalizeStringList(
    params.tool_whitelist ?? params.toolWhitelist,
  );
  const hasExplicitToolWhitelist =
    Array.isArray(params.tool_whitelist) || Array.isArray(params.toolWhitelist);

  return {
    subagentName:
      params.subagent_name ?? params.subagentName ?? params.name ?? '',
    prompt,
    behaviourPrompts,
    toolWhitelist: toolWhitelist.length > 0 ? toolWhitelist : undefined,
    hasExplicitToolWhitelist,
    outputSpec: params.output_spec ?? params.outputSpec,
    timeoutSeconds: params.timeout_seconds ?? params.timeoutSeconds,
    async: params.async ?? false,
    context: params.context ?? params.context_vars ?? params.contextVars ?? {},
  };
}

function buildSubagentRequest(params: NormalizedTaskParams): SubagentRequest {
  return {
    name: params.subagentName,
    prompt: params.prompt,
    behaviourPrompts: params.behaviourPrompts,
    toolWhitelist: params.toolWhitelist,
    hasExplicitToolWhitelist: params.hasExplicitToolWhitelist,
    outputSpec: params.outputSpec,
    timeoutSeconds: params.timeoutSeconds,
    async: params.async,
    context: params.context,
  };
}

function formatTaskResult(
  subagentName: string,
  prompt: string,
  result: SubagentResult,
): string {
  const parts = [
    `Subagent ${subagentName} executed: ${prompt}`,
    result.agentId ? `Agent ID: ${result.agentId}` : '',
    result.terminateReason ? `Terminate Reason: ${result.terminateReason}` : '',
    result.output,
  ].filter((part) => part.length > 0);
  return parts.join('\n\n').trim();
}

class TaskToolInvocation extends BaseToolInvocation<
  TaskToolParams,
  ToolResult
> {
  constructor(
    params: TaskToolParams,
    private readonly subagentService: ISubagentService,
  ) {
    super(params);
  }

  override getToolName(): string {
    return TaskTool.Name;
  }

  override getDescription(): string {
    const normalized = normalizeTaskParams(this.params);
    return `Run subagent '${normalized.subagentName}' to accomplish: ${normalized.prompt}`;
  }

  override async execute(
    signal?: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const normalized = normalizeTaskParams(this.params);
    const options: SubagentExecutionOptions = { signal, updateOutput };
    const result = await this.subagentService.executeSubagent(
      buildSubagentRequest(normalized),
      options,
    );

    if (result.success) {
      const content = formatTaskResult(
        normalized.subagentName,
        normalized.prompt,
        result,
      );
      return {
        llmContent: result.llmContent ?? content,
        returnDisplay: result.returnDisplay ?? (result.output || content),
        metadata: {
          ...(result.metadata ?? {}),
          ...(result.agentId ? { agentId: result.agentId } : {}),
          ...(result.terminateReason
            ? { terminateReason: result.terminateReason }
            : {}),
          ...(result.emittedVars ? { emittedVars: result.emittedVars } : {}),
        },
      };
    }

    const message =
      result.error ?? `Subagent ${normalized.subagentName} failed`;
    return {
      llmContent: result.llmContent ?? `${normalized.subagentName}: ${message}`,
      returnDisplay: result.returnDisplay ?? message,
      metadata:
        result.metadata ??
        (result.agentId
          ? {
              agentId: result.agentId,
              error: message,
            }
          : undefined),
      error: {
        message,
        type: result.errorType ?? ToolErrorType.EXECUTION_FAILED,
      },
    };
  }
}

export class TaskTool extends BaseDeclarativeTool<TaskToolParams, ToolResult> {
  static readonly Name = 'task';

  constructor(private readonly subagentService: ISubagentService) {
    super(
      TaskTool.Name,
      'Task',
      'Launches a named subagent, streams its progress, and returns the emitted variables upon completion.',
      Kind.Execute,
      {
        type: 'object',
        properties: {
          subagent_name: {
            type: 'string',
            description: 'Name of the registered subagent to launch.',
          },
          name: {
            type: 'string',
            description: 'Alternative parameter name for subagent_name.',
          },
          goal_prompt: {
            type: 'string',
            description: 'Primary goal or prompt to pass to the subagent.',
          },
          prompt: {
            type: 'string',
            description: 'Alternative parameter name for goal_prompt.',
          },
          behaviour_prompts: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Additional behavioural prompts to append after the goal prompt.',
          },
          tool_whitelist: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Restrict the subagent to this explicit list of tools.',
          },
          output_spec: {
            type: 'object',
            description:
              'Expected output variables the subagent must emit before completing.',
          },
          timeout_seconds: {
            type: 'number',
            description: 'Optional timeout in seconds for the task execution.',
          },
          async: {
            type: 'boolean',
            description:
              'If true, launch subagent in background and return immediately.',
          },
          context: {
            type: 'object',
            description: 'Optional key/value pairs exposed to the subagent.',
          },
        },
        required: ['subagent_name', 'goal_prompt'],
      },
      false,
      true,
    );
  }

  protected override validateToolParamValues(
    params: TaskToolParams,
  ): string | null {
    const normalized = normalizeTaskParams(params);
    if (!normalized.subagentName.trim()) {
      return 'Parameter "subagent_name" must be a non-empty string.';
    }
    if (!normalized.prompt.trim()) {
      return 'Parameter "goal_prompt" must be a non-empty string.';
    }
    return null;
  }

  protected override createInvocation(
    params: TaskToolParams,
  ): ToolInvocation<TaskToolParams, ToolResult> {
    return new TaskToolInvocation(params, this.subagentService);
  }

  async execute(
    params: TaskToolParams,
    signal?: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const validation = this.validateToolParamValues(params);
    if (validation) {
      return {
        llmContent: validation,
        returnDisplay: validation,
        error: {
          message: validation,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }
    return new TaskToolInvocation(params, this.subagentService).execute(
      signal,
      updateOutput,
    );
  }
}
