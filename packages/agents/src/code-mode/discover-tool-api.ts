/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `discover_tool_api` tool (issue #4084): lists the tools a code mode
 * script may call and describes selected ones as TypeScript declarations,
 * with the API revision `execute_tool_script` can pin. It reads the caller's
 * own admitted selection through the scheduler's nested-execution port; it
 * never executes or authorizes anything.
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
  DISCOVER_TOOL_API,
  SCRIPT_CALLABLE_TOOLS,
} from './script-tool-surface.js';
import {
  MAX_DECLARATION_BYTES,
  computeApiRevision,
  generateDeclarations,
  readScriptApi,
  type ScriptApiTool,
} from './tool-declarations.js';
import { docText } from './schema-to-typescript.js';

export interface DiscoverToolApiParams {
  readonly operation: 'list' | 'describe';
  readonly tools?: readonly string[];
  readonly offset?: number;
}

/** Names per list page; the v1 set fits in one page. */
export const LIST_PAGE_SIZE = 25;
const SHORT_DESCRIPTION_CHARS = 160;

const DESCRIPTION = [
  'Shows what an execute_tool_script program can call. operation "list" returns the callable tool names with short descriptions; operation "describe" with `tools` returns TypeScript declarations of their arguments and results (tools["name"](args) resolves to ScriptToolResult) and the api_revision to pass to execute_tool_script.',
  "Call it before writing a script when you are not sure of a tool's argument names. It runs nothing.",
].join(' ');

const schema = {
  type: 'object',
  properties: {
    operation: {
      type: 'string',
      enum: ['list', 'describe'],
      description:
        'list: names and short descriptions; describe: declarations for `tools`.',
    },
    tools: {
      type: 'array',
      items: { type: 'string' },
      description: `For describe: tool names to declare (at most ${SCRIPT_CALLABLE_TOOLS.length}).`,
    },
    offset: {
      type: 'integer',
      minimum: 0,
      description: 'For list: index of the first name to return (default 0).',
    },
  },
  required: ['operation'],
};

function jsonResult(
  value: Record<string, unknown>,
  summary: string,
): ToolResult {
  return { llmContent: JSON.stringify(value), returnDisplay: summary };
}

function failure(code: string, message: string): ToolResult {
  const llmContent = JSON.stringify({ ok: false, error: { code, message } });
  return {
    llmContent,
    returnDisplay: `${code}: ${message}`,
    error: { message: llmContent, type: ToolErrorType.INVALID_TOOL_PARAMS },
  };
}

function listPage(
  api: readonly ScriptApiTool[],
  revision: string,
  offset: number,
): ToolResult {
  const page = api.slice(offset, offset + LIST_PAGE_SIZE).map((tool) => ({
    name: tool.name,
    description: docText(tool.description, SHORT_DESCRIPTION_CHARS),
  }));
  const next = offset + page.length;
  return jsonResult(
    {
      ok: true,
      api_revision: revision,
      tools: page,
      total: api.length,
      ...(next < api.length ? { next_offset: next } : {}),
    },
    `${page.length} of ${api.length} script-callable tools`,
  );
}

function describe(
  api: readonly ScriptApiTool[],
  revision: string,
  names: readonly string[],
): ToolResult {
  if (names.length === 0 || new Set(names).size !== names.length)
    return failure(
      'INVALID_TOOLS',
      'describe needs `tools`: each tool name once.',
    );
  const selected: ScriptApiTool[] = [];
  for (const name of names) {
    const tool = api.find((entry) => entry.name === name);
    if (tool === undefined)
      return failure(
        SCRIPT_CALLABLE_TOOLS.includes(name)
          ? 'TOOL_NOT_ADMITTED'
          : 'TOOL_NOT_SCRIPTABLE',
        `"${name}" is not callable from scripts here. Use operation "list" to see the callable tools.`,
      );
    selected.push(tool);
  }
  const { source, diagnostics } = generateDeclarations(selected);
  if (Buffer.byteLength(source, 'utf8') > MAX_DECLARATION_BYTES)
    return failure(
      'DECLARATIONS_TOO_LARGE',
      `The declarations exceed ${MAX_DECLARATION_BYTES} bytes; describe fewer tools at a time.`,
    );
  return jsonResult(
    { ok: true, api_revision: revision, declarations: source, diagnostics },
    `Declared ${selected.map((tool) => tool.name).join(', ')}`,
  );
}

class DiscoverToolApiInvocation extends BaseToolInvocation<
  DiscoverToolApiParams,
  ToolResult
> {
  constructor(params: DiscoverToolApiParams, messageBus: IToolMessageBus) {
    super(params, messageBus, DISCOVER_TOOL_API, 'Discover tool API');
  }

  getDescription(): string {
    return this.params.operation === 'list'
      ? 'List script-callable tools'
      : `Describe ${(this.params.tools ?? []).join(', ')}`;
  }

  async execute(
    _signal: AbortSignal,
    _updateOutput?: (update: LiveOutputUpdate) => void,
    _terminalColumns?: number,
    _terminalRows?: number,
    _setPidCallback?: (pid: number) => void,
    scope?: ToolExecutionScope,
  ): Promise<ToolResult> {
    const port = scope?.nestedExecution;
    if (scope === undefined || !(port instanceof NestedExecutionPort))
      throw new Error(
        `${DISCOVER_TOOL_API} runs only inside a scheduler that supplies a nested-execution scope.`,
      );
    const { composition } = port;
    const api = readScriptApi(composition, scope.hookRestrictedAllowedTools);
    const revision = computeApiRevision(api, composition.readCodeModeLimits());
    return this.params.operation === 'list'
      ? listPage(api, revision, this.params.offset ?? 0)
      : describe(api, revision, this.params.tools ?? []);
  }
}

export class DiscoverToolApiTool extends BaseDeclarativeTool<
  DiscoverToolApiParams,
  ToolResult
> {
  static readonly Name = DISCOVER_TOOL_API;

  constructor(messageBus: IToolMessageBus) {
    // Kind.Think like execute_tool_script: it reads the caller's own tool
    // registrations and has no effect, so it asks for no confirmation.
    super(
      DISCOVER_TOOL_API,
      'Discover tool API',
      DESCRIPTION,
      Kind.Think,
      schema,
      false,
      false,
      messageBus,
    );
  }

  protected createInvocation(
    params: DiscoverToolApiParams,
    messageBus?: IToolMessageBus,
  ): ToolInvocation<DiscoverToolApiParams, ToolResult> {
    if (messageBus === undefined)
      throw new Error(`${DISCOVER_TOOL_API} requires a message bus.`);
    return new DiscoverToolApiInvocation(params, messageBus);
  }
}
