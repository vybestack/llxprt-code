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
  type ScriptRunDisplay,
} from './code-mode-run-owner.js';
import {
  scriptEnvelope,
  type ScriptEnvelope,
} from './script-result-envelope.js';
import {
  formatToolScriptCard,
  type ToolScriptRunView,
} from './tool-script-card.js';
import { QuickJsProcessRuntime } from './quickjs-process-runtime.js';
import type { CodeModeLimits, CodeModeRuntime } from './runtime-contract.js';
import { boundWallTimeout } from './code-mode-settings.js';
import { computeApiRevision, readScriptApi } from './tool-declarations.js';
import {
  EXECUTE_TOOL_SCRIPT,
  SCRIPT_CALLABLE_TOOLS,
  preflightScriptTools,
} from './script-tool-surface.js';

export interface ExecuteToolScriptParams {
  readonly source: string;
  readonly tools: readonly string[];
  /**
   * Optional. When present it must equal the caller's current script API
   * revision (what `discover_tool_api` returned), or the run fails with
   * API_CHANGED before it starts.
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
        'JavaScript async function body (no imports, no TypeScript). Call tools as `await tools["name"](args)`; each call resolves to {ok:true,value,completeness} or {ok:false,error:{code,message}}. Text tools give value {text}; run_shell_command gives {stdout,stderr,exitCode,streamsMerged}. `return` one JSON value.',
    },
    tools: {
      type: 'array',
      items: { type: 'string' },
      description: `Exact names of the tools the script calls, each once; empty if it calls none. Allowed: ${SCRIPT_CALLABLE_TOOLS.join(', ')}.`,
    },
    api_revision: {
      type: 'string',
      description:
        'Optional api_revision from discover_tool_api. When given, the run fails with API_CHANGED if the tools changed since.',
    },
    purpose: {
      type: 'string',
      description: 'One short sentence saying what the script gathers.',
    },
  },
  required: ['source', 'tools', 'purpose'],
};

/** Factory for the sandbox runtime of one run, under that run's limits. */
export type CodeModeRuntimeFactory = (
  limits: Partial<CodeModeLimits>,
) => CodeModeRuntime;

const EXECUTE_DESCRIPTION = [
  'Runs a short JavaScript program (an async function body) in a sandbox. The program calls read/search tools and foreground shell commands as `await tools["name"](args)`, loops over, filters, joins and counts their results, and returns one compact JSON value. Only that value enters the conversation.',
  'Use it for mechanical gathering: the same lookup over many files, commits or directories, joins across tool outputs, counting, or large outputs you do not need to read yourself.',
  'Do not use it for one small lookup, or for content you must read yourself to edit or explain: call that tool directly.',
  'List every tool the script calls in `tools`. Scripts cannot write files, start agents or reach the network; every call they make goes through the normal policy and approval checks. discover_tool_api gives the exact argument and result types.',
  'Example:',
  'const counts = {};',
  'for (const dir of ["packages/core/src", "packages/cli/src"]) {',
  '  const r = await tools["run_shell_command"]({ command: `git ls-files ${dir} | wc -l` });',
  '  if (!r.ok) throw new Error(r.error.message);',
  '  counts[dir] = Number(r.value.stdout.trim());',
  '}',
  'return counts;',
].join('\n');

interface ScriptFailure {
  readonly code: string;
  readonly message: string;
}

/**
 * The envelope is already fitted to the call's model output budget, so it
 * is marked bounded: the scheduler hands it to the model whole. On failure
 * the envelope is the model-facing error content and the terse message marks
 * the failure; a run that started shows its card rather than that message.
 */
function toToolResult(
  envelope: ScriptEnvelope,
  failure: ScriptFailure | undefined,
  card: string | undefined,
): ToolResult {
  const llmContent = JSON.stringify(envelope);
  if (failure === undefined)
    return {
      llmContent,
      returnDisplay:
        card ??
        `Script finished after ${String(envelope['callCount'])} tool call(s).`,
      boundedOutput: true,
    };
  const message = `Script failed with ${failure.code}: ${failure.message}`;
  return {
    llmContent,
    returnDisplay: card ?? message,
    boundedOutput: true,
    error: { message, type: ToolErrorType.EXECUTION_FAILED },
    displayOnError: card !== undefined,
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
    { code, message },
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
    const { composition } = port;
    const limits = composition.readCodeModeLimits();
    const revision = this.params.api_revision;
    if (revision !== undefined) {
      const current = computeApiRevision(
        readScriptApi(composition, scope.hookRestrictedAllowedTools),
        limits,
      );
      if (current !== revision)
        return preflightFailure(
          'API_CHANGED',
          `The script API changed since revision ${revision}; it is now ${current}. Call discover_tool_api again, or leave out api_revision.`,
        );
    }
    let latest: ToolScriptRunView | undefined;
    const owner = new CodeModeRunOwner({
      runtime: this.createRuntime({
        maxCalls: limits.maxCalls,
        maxResultBytes: limits.maxResultBytes,
        wallTimeoutMs: boundWallTimeout(
          limits.wallTimeoutMs,
          composition.readDeadline(),
        ),
      }),
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
    const envelope = scriptEnvelope(report);
    const card =
      latest === undefined
        ? undefined
        : formatToolScriptCard(latest, {
            source: this.params.source,
            ...(report.result.ok
              ? { result: JSON.stringify(report.result.value) }
              : {}),
          });
    return toToolResult(
      envelope,
      report.result.ok ? undefined : report.result.error,
      card,
    );
  }
}

export class ExecuteToolScriptTool extends BaseDeclarativeTool<
  ExecuteToolScriptParams,
  ToolResult
> {
  static readonly Name = EXECUTE_TOOL_SCRIPT;

  constructor(
    messageBus: IToolMessageBus,
    private readonly createRuntime: CodeModeRuntimeFactory = (limits) =>
      new QuickJsProcessRuntime({ limits }),
    private readonly display?: ScriptRunDisplay,
  ) {
    // Kind.Think, like `task`: the script tool has no effect of its own, so
    // it asks for no confirmation (the default policy also allows it). Every
    // call the script makes is authorized and, where policy asks, approved
    // on its own; a policy rule can still deny the script tool.
    super(
      EXECUTE_TOOL_SCRIPT,
      'Execute tool script',
      EXECUTE_DESCRIPTION,
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
