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
  type ToolExecutionScope,
  type ToolInvocation,
  type ToolResult,
} from '@vybestack/llxprt-code-tools';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import { NestedExecutionPort } from '../scheduler/nested-execution.js';
import {
  CodeModeRunOwner,
  type CodeModeRunReport,
  type ScriptRunDisplay,
} from './code-mode-run-owner.js';
import {
  formatToolScriptCard,
  type ToolScriptRunView,
} from './tool-script-card.js';
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

function toToolResult(
  summary: ScriptSummary,
  card: string | undefined,
): ToolResult {
  const llmContent = JSON.stringify(summary);
  const ok = summary['ok'] === true;
  const display =
    card ??
    (ok
      ? `Script finished after ${String(summary['callCount'])} tool call(s).`
      : `Script failed: ${llmContent}`);
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
  return toToolResult(
    {
      ok: false,
      error: { code, message },
      callCount: 0,
      partial: false,
      completedCalls: [],
      logs: [],
    },
    undefined,
  );
}

/** One plain line of terminal output per card line, for live updates. */
function toAnsiLines(text: string): LiveOutputUpdate {
  return {
    mode: 'replace',
    data: text.split('\n').map((line) => [
      {
        text: line,
        bold: false,
        italic: false,
        underline: false,
        dim: false,
        inverse: false,
        fg: '',
        bg: '',
      },
    ]),
  };
}

class ExecuteToolScriptInvocation extends BaseToolInvocation<
  ExecuteToolScriptParams,
  ToolResult
> {
  constructor(
    params: ExecuteToolScriptParams,
    messageBus: IToolMessageBus,
    private readonly createRuntime: CodeModeRuntimeFactory,
    private readonly display: ScriptRunDisplay | undefined,
  ) {
    super(params, messageBus, EXECUTE_TOOL_SCRIPT, 'Execute tool script');
  }

  getDescription(): string {
    return `${this.params.purpose} [tools: ${this.params.tools.join(', ')}]`;
  }

  async execute(
    signal: AbortSignal,
    updateOutput?: (update: LiveOutputUpdate) => void,
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
    let latest: ToolScriptRunView | undefined;
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
      display: this.display,
      onProgress: (view) => {
        latest = view;
        updateOutput?.(
          toAnsiLines(
            formatToolScriptCard(view, { source: this.params.source }),
          ),
        );
      },
    });
    const report = await owner.run(signal);
    const summary = summarize(report);
    const card =
      latest === undefined
        ? undefined
        : formatToolScriptCard(latest, {
            source: this.params.source,
            ...(report.result.ok
              ? { result: JSON.stringify(report.result.value) }
              : {}),
          });
    return toToolResult(summary, card);
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
    private readonly display?: ScriptRunDisplay,
  ) {
    // Kind.Think, like `task`: the script tool has no effect of its own, so
    // it asks for no confirmation (the default policy also allows it). Every
    // call the script makes is authorized and, where policy asks, approved
    // on its own; a policy rule can still deny the script tool.
    super(
      EXECUTE_TOOL_SCRIPT,
      'Execute tool script',
      'Runs a short JavaScript program that calls read/search tools and foreground shell commands as async functions, loops over and filters their results in a sandbox, and returns one compact JSON value. Use it for mechanical gathering over many files or commands; read content directly when you need to see it yourself. Every tool call the script makes goes through the normal policy and approval checks.',
      Kind.Think,
      schema,
      false,
      true,
      messageBus,
    );
  }

  /**
   * The same tool bound to the session's child display, so its runs show
   * nested calls and approvals there and publish their script records.
   */
  withScriptDisplay(display: ScriptRunDisplay): ExecuteToolScriptTool {
    if (this.messageBus === undefined)
      throw new Error(`${EXECUTE_TOOL_SCRIPT} requires a message bus.`);
    return new ExecuteToolScriptTool(
      this.messageBus,
      this.createRuntime,
      display,
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
      this.display,
    );
  }
}
