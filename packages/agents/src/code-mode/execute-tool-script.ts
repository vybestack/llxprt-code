/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `execute_tool_script` tool (issue #4084): runs a model-written
 * JavaScript function body in the QuickJS sandbox, routes every tool call it
 * makes through the caller's own scheduler composition, and returns one
 * compact JSON result. Only that result enters model history.
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type IToolMessageBus,
  type LiveOutputUpdate,
  type ToolCallConfirmationDetails,
  type ToolExecutionScope,
  type ToolInvocation,
  type ToolResult,
} from '@vybestack/llxprt-code-tools';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import { NestedExecutionPort } from '../scheduler/nested-execution.js';
import {
  CodeModeRunOwner,
  type CodeModeRunReport,
} from './code-mode-run-owner.js';
import { QuickJsProcessRuntime } from './quickjs-process-runtime.js';
import type { CodeModeRuntime, JsonValue } from './runtime-contract.js';
import {
  EXECUTE_TOOL_SCRIPT,
  SCRIPT_CALLABLE_TOOLS,
  preflightScriptTools,
} from './script-tool-surface.js';

export interface ExecuteToolScriptParams {
  readonly source: string;
  readonly tools: readonly string[];
  /**
   * Accepted but not checked yet: discovery (`discover_tool_api`) and the
   * revision it hands out arrive in a later phase of #4084.
   */
  readonly api_revision?: string;
  readonly purpose: string;
}

const MAX_SOURCE_PREVIEW = 2000;

const schema = {
  type: 'object',
  properties: {
    source: {
      type: 'string',
      description:
        'JavaScript async function body. Call tools as `await tools["name"](args)`; each call resolves to {ok:true,value,completeness} or {ok:false,error:{code,message}}. Text tools give value {text}; run_shell_command gives {stdout,stderr,exitCode,streamsMerged}. `return` one JSON value.',
    },
    tools: {
      type: 'array',
      items: { type: 'string' },
      description: `Exact names of the tools the script calls. Allowed: ${SCRIPT_CALLABLE_TOOLS.join(', ')}.`,
    },
    api_revision: {
      type: 'string',
      description: 'API revision from discover_tool_api, when available.',
    },
    purpose: {
      type: 'string',
      description: 'One short sentence saying what the script gathers.',
    },
  },
  required: ['source', 'tools', 'purpose'],
};

/** Factory for the sandbox runtime of one run. */
export type CodeModeRuntimeFactory = () => CodeModeRuntime;

interface ScriptSummary {
  readonly [key: string]: JsonValue;
}

function summarize(report: CodeModeRunReport): ScriptSummary {
  const { result, completedCalls, partial } = report;
  const outcome: ScriptSummary = result.ok
    ? { ok: true, value: result.value }
    : { ok: false, error: { ...result.error } };
  return {
    ...outcome,
    callCount: result.callCount,
    partial,
    completedCalls: completedCalls.map(({ tool, status }) => ({
      tool,
      status,
    })),
    logs: [...result.logs],
  };
}

function toToolResult(summary: ScriptSummary): ToolResult {
  const llmContent = JSON.stringify(summary);
  const ok = summary['ok'] === true;
  const display = ok
    ? `Script finished after ${String(summary['callCount'])} tool call(s).`
    : `Script failed: ${llmContent}`;
  return {
    llmContent,
    returnDisplay: display,
    ...(ok
      ? {}
      : {
          error: {
            message: llmContent,
            type: ToolErrorType.EXECUTION_FAILED,
          },
        }),
  };
}

function preflightFailure(code: string, message: string): ToolResult {
  return toToolResult({
    ok: false,
    error: { code, message },
    callCount: 0,
    partial: false,
    completedCalls: [],
    logs: [],
  });
}

class ExecuteToolScriptInvocation extends BaseToolInvocation<
  ExecuteToolScriptParams,
  ToolResult
> {
  constructor(
    params: ExecuteToolScriptParams,
    messageBus: IToolMessageBus,
    private readonly createRuntime: CodeModeRuntimeFactory,
  ) {
    super(params, messageBus, EXECUTE_TOOL_SCRIPT, 'Execute tool script');
  }

  getDescription(): string {
    return `${this.params.purpose} [tools: ${this.params.tools.join(', ')}]`;
  }

  override async shouldConfirmExecute(): Promise<ToolCallConfirmationDetails> {
    const source =
      this.params.source.length > MAX_SOURCE_PREVIEW
        ? `${this.params.source.slice(0, MAX_SOURCE_PREVIEW)}\n…`
        : this.params.source;
    return {
      type: 'info',
      title: 'Run tool script',
      prompt: `${this.params.purpose}\n\nTools: ${this.params.tools.join(', ')}\n\n${source}\n\nEach tool call the script makes is still checked and approved on its own.`,
      onConfirm: async () => undefined,
    };
  }

  async execute(
    signal: AbortSignal,
    _updateOutput?: (update: LiveOutputUpdate) => void,
    _terminalColumns?: number,
    _terminalRows?: number,
    _setPidCallback?: (pid: number) => void,
    scope?: ToolExecutionScope,
  ): Promise<ToolResult> {
    const port = scope?.nestedExecution;
    if (scope === undefined || !(port instanceof NestedExecutionPort))
      throw new Error(
        `${EXECUTE_TOOL_SCRIPT} runs only inside a scheduler that supplies a nested-execution scope.`,
      );
    const preflight = preflightScriptTools(
      this.params.tools,
      port.composition,
      scope.hookRestrictedAllowedTools,
    );
    if (!preflight.ok)
      return preflightFailure(preflight.code, preflight.message);
    const owner = new CodeModeRunOwner({
      runtime: this.createRuntime(),
      request: {
        language: 'javascript',
        source: this.params.source,
        tools: [...this.params.tools],
        apiRevision: this.params.api_revision ?? '',
        purpose: this.params.purpose,
      },
      scope,
      port,
    });
    return toToolResult(summarize(await owner.run(signal)));
  }
}

export class ExecuteToolScriptTool extends BaseDeclarativeTool<
  ExecuteToolScriptParams,
  ToolResult
> {
  static readonly Name = EXECUTE_TOOL_SCRIPT;

  constructor(
    messageBus: IToolMessageBus,
    private readonly createRuntime: CodeModeRuntimeFactory = () =>
      new QuickJsProcessRuntime(),
  ) {
    super(
      EXECUTE_TOOL_SCRIPT,
      'Execute tool script',
      'Runs a short JavaScript program that calls read/search tools and foreground shell commands as async functions, loops over and filters their results in a sandbox, and returns one compact JSON value. Use it for mechanical gathering over many files or commands; read content directly when you need to see it yourself. Every tool call the script makes goes through the normal policy and approval checks.',
      Kind.Execute,
      schema,
      false,
      false,
      messageBus,
    );
  }

  protected createInvocation(
    params: ExecuteToolScriptParams,
    messageBus?: IToolMessageBus,
  ): ToolInvocation<ExecuteToolScriptParams, ToolResult> {
    if (messageBus === undefined)
      throw new Error(`${EXECUTE_TOOL_SCRIPT} requires a message bus.`);
    return new ExecuteToolScriptInvocation(
      params,
      messageBus,
      this.createRuntime,
    );
  }
}
