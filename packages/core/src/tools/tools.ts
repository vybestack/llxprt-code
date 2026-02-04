/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type FunctionCall,
  type FunctionDeclaration,
  type PartListUnion,
} from '@google/genai';
import { type ToolContext, type ContextAwareTool } from './tool-context.js';
import { ToolErrorType } from './tool-error.js';
import { type DiffUpdateResult } from '../ide/ideContext.js';
import { SchemaValidator } from '../utils/schemaValidator.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type ToolConfirmationResponse,
} from '../confirmation-bus/types.js';
import {
  ToolConfirmationOutcome,
  type ToolConfirmationPayload,
} from './tool-confirmation-types.js';
import { randomUUID } from 'node:crypto';
import type { AnsiOutput } from '../utils/terminalSerializer.js';

export { ToolConfirmationOutcome } from './tool-confirmation-types.js';
export type { ToolConfirmationPayload } from './tool-confirmation-types.js';

/**
 * Represents a validated and ready-to-execute tool call.
 * An instance of this is created by a `ToolBuilder`.
 */
export interface ToolInvocation<
  TParams extends object,
  TResult extends ToolResult,
> {
  /**
   * The validated parameters for this specific invocation.
   */
  params: TParams;

  /**
   * Gets a pre-execution description of the tool operation.
   *
   * @returns A markdown string describing what the tool will do.
   */
  getDescription(): string;

  /**
   * Determines what file system paths the tool will affect.
   * @returns A list of such paths.
   */
  toolLocations(): ToolLocation[];

  /**
   * Determines if the tool should prompt for confirmation before execution.
   * @returns Confirmation details or false if no confirmation is needed.
   */
  shouldConfirmExecute(
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false>;

  /**
   * Executes the tool with the validated parameters.
   * @param signal AbortSignal for tool cancellation.
   * @param updateOutput Optional callback to stream output.
   * @param terminalColumns Optional terminal width for PTY mode.
   * @param terminalRows Optional terminal height for PTY mode.
   * @param setPidCallback Optional callback to propagate PTY PID.
   * @returns Result of the tool execution.
   */
  execute(
    signal: AbortSignal,
    updateOutput?: (output: string | AnsiOutput) => void,
    terminalColumns?: number,
    terminalRows?: number,
    setPidCallback?: (pid: number) => void,
  ): Promise<TResult>;
}

/**
 * A convenience base class for ToolInvocation.
 */
export abstract class BaseToolInvocation<
  TParams extends object,
  TResult extends ToolResult,
> implements ToolInvocation<TParams, TResult>
{
  constructor(
    readonly params: TParams,
    protected readonly messageBus?: MessageBus,
    readonly _toolName?: string,
    readonly _toolDisplayName?: string,
    readonly _serverName?: string,
  ) {}

  abstract getDescription(): string;

  toolLocations(): ToolLocation[] {
    return [];
  }

  /**
   * Returns confirmation details for this tool invocation.
   * Tools that require confirmation should override this method.
   * @returns Confirmation details or null if no confirmation needed.
   */
  protected getConfirmationDetails(): ToolCallConfirmationDetails | null {
    return null;
  }

  /**
   * Attempts to obtain a policy decision via message bus.
   *
   * Semantics:
   * - `'ALLOW'`: auto-proceed
   * - `'DENY'`: tool must not execute
   * - `'ASK_USER'`: fall back to legacy tool confirmation UI
   */
  protected getMessageBusDecision(
    abortSignal: AbortSignal,
  ): Promise<'ALLOW' | 'DENY' | 'ASK_USER'> {
    if (!this.messageBus) {
      // No bus wired: allow and let per-tool legacy confirmation logic decide.
      return Promise.resolve('ALLOW');
    }

    if (abortSignal.aborted) {
      return Promise.resolve('DENY');
    }

    const correlationId = randomUUID();
    const toolCall: FunctionCall = {
      name: this.getToolName(),
      args: this.params as Record<string, unknown>,
    };

    return new Promise<'ALLOW' | 'DENY' | 'ASK_USER'>((resolve) => {
      let timeoutId: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        abortSignal.removeEventListener('abort', abortHandler);
        this.messageBus?.unsubscribe(
          MessageBusType.TOOL_CONFIRMATION_RESPONSE,
          responseHandler,
        );
      };

      const abortHandler = () => {
        cleanup();
        resolve('DENY');
      };

      const responseHandler = (response: ToolConfirmationResponse) => {
        if (response.correlationId !== correlationId) {
          return;
        }

        cleanup();

        if (response.requiresUserConfirmation) {
          resolve('ASK_USER');
          return;
        }

        const confirmed =
          response.confirmed ??
          (response.outcome !== undefined
            ? response.outcome !== ToolConfirmationOutcome.Cancel &&
              response.outcome !== ToolConfirmationOutcome.ModifyWithEditor
            : false);

        resolve(confirmed ? 'ALLOW' : 'DENY');
      };

      abortSignal.addEventListener('abort', abortHandler);

      // Default to ASK_USER if the bus doesn't answer promptly.
      timeoutId = setTimeout(() => {
        cleanup();
        resolve('ASK_USER');
      }, 30000);

      this.messageBus?.subscribe(
        MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        responseHandler,
      );

      try {
        this.messageBus?.publish({
          type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
          toolCall,
          correlationId,
          serverName: this.getServerName(),
        });
      } catch {
        cleanup();
        resolve('ALLOW');
      }
    });
  }

  /**
   * Returns the tool name for this invocation.
   * Subclasses can override to provide a specific tool name.
   */
  protected getToolName(): string {
    return this._toolName ?? 'unknown';
  }

  /**
   * Returns the server name for MCP tools.
   * Regular tools should return undefined.
   */
  protected getServerName(): string | undefined {
    return this._serverName;
  }

  /**
   * Returns metadata used by the policy engine/message bus.
   */
  getPolicyContext(): {
    toolName: string;
    args: Record<string, unknown>;
    serverName?: string;
  } {
    return {
      toolName: this.getToolName(),
      args: this.params as Record<string, unknown>,
      serverName: this.getServerName(),
    };
  }

  shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    return Promise.resolve(false);
  }

  abstract execute(
    signal: AbortSignal,
    updateOutput?: (output: string | AnsiOutput) => void,
    terminalColumns?: number,
    terminalRows?: number,
    setPidCallback?: (pid: number) => void,
  ): Promise<TResult>;
}

/**
 * A type alias for a tool invocation where the specific parameter and result types are not known.
 */
export type AnyToolInvocation = ToolInvocation<object, ToolResult>;

/**
 * Interface for a tool builder that validates parameters and creates invocations.
 */
export interface ToolBuilder<
  TParams extends object,
  TResult extends ToolResult,
> {
  /**
   * The internal name of the tool (used for API calls).
   */
  name: string;

  /**
   * The user-friendly display name of the tool.
   */
  displayName: string;

  /**
   * Description of what the tool does.
   */
  description: string;

  /**
   * The kind of tool for categorization and permissions
   */
  kind: Kind;

  /**
   * Function declaration schema from @google/genai.
   */
  schema: FunctionDeclaration;

  /**
   * Whether the tool's output should be rendered as markdown.
   */
  isOutputMarkdown: boolean;

  /**
   * Whether the tool supports live (streaming) output.
   */
  canUpdateOutput: boolean;

  /**
   * Validates raw parameters and builds a ready-to-execute invocation.
   * @param params The raw, untrusted parameters from the model.
   * @returns A valid `ToolInvocation` if successful. Throws an error if validation fails.
   */
  build(params: TParams): ToolInvocation<TParams, TResult>;
}

/**
 * New base class for tools that separates validation from execution.
 * New tools should extend this class.
 */
export abstract class DeclarativeTool<
  TParams extends object,
  TResult extends ToolResult,
> implements ToolBuilder<TParams, TResult>
{
  protected messageBus?: MessageBus;

  constructor(
    readonly name: string,
    readonly displayName: string,
    readonly description: string,
    readonly kind: Kind,
    readonly parameterSchema: unknown,
    readonly isOutputMarkdown: boolean = true,
    readonly canUpdateOutput: boolean = false,
    messageBus?: MessageBus,
  ) {
    this.messageBus = messageBus;
  }

  /**
   * Sets the message bus for this tool.
   * Called by ToolRegistry after tool construction.
   */
  setMessageBus(messageBus: MessageBus): void {
    this.messageBus = messageBus;
  }

  get schema(): FunctionDeclaration {
    // Strip requireOne from the schema before sending to the model
    // The requireOne property is used internally for validation but not sent to the model
    if (this.parameterSchema && typeof this.parameterSchema === 'object') {
      const schemaClone = {
        ...(this.parameterSchema as Record<string, unknown>),
      };
      delete schemaClone.requireOne;
      return {
        name: this.name,
        description: this.description,
        parametersJsonSchema: schemaClone,
      };
    }
    return {
      name: this.name,
      description: this.description,
      parametersJsonSchema: this.parameterSchema,
    };
  }

  /**
   * Validates the raw tool parameters.
   * Subclasses should override this to add custom validation logic
   * beyond the JSON schema check.
   * @param params The raw parameters from the model.
   * @returns An error message string if invalid, null otherwise.
   */
  validateToolParams(_params: TParams): string | null {
    // Base implementation can be extended by subclasses.
    return null;
  }

  /**
   * The core of the new pattern. It validates parameters and, if successful,
   * returns a `ToolInvocation` object that encapsulates the logic for the
   * specific, validated call.
   * @param params The raw, untrusted parameters from the model.
   * @returns A `ToolInvocation` instance.
   */
  abstract build(params: TParams): ToolInvocation<TParams, TResult>;

  /**
   * A convenience method that builds and executes the tool in one step.
   * Throws an error if validation fails.
   * @param params The raw, untrusted parameters from the model.
   * @param signal AbortSignal for tool cancellation.
   * @param updateOutput Optional callback to stream output.
   * @returns The result of the tool execution.
   */
  async buildAndExecute(
    params: TParams,
    signal: AbortSignal,
    updateOutput?: (output: string | AnsiOutput) => void,
  ): Promise<TResult> {
    const invocation = this.build(params);
    return invocation.execute(signal, updateOutput);
  }

  /**
   * Similar to `build` but never throws.
   * @param params The raw, untrusted parameters from the model.
   * @returns A `ToolInvocation` instance.
   */
  private silentBuild(
    params: TParams,
  ): ToolInvocation<TParams, TResult> | Error {
    try {
      return this.build(params);
    } catch (e) {
      if (e instanceof Error) {
        return e;
      }
      return new Error(String(e));
    }
  }

  /**
   * A convenience method that builds and executes the tool in one step.
   * Never throws.
   * @param params The raw, untrusted parameters from the model.
   * @params abortSignal a signal to abort.
   * @returns The result of the tool execution.
   */
  async validateBuildAndExecute(
    params: TParams,
    abortSignal: AbortSignal,
  ): Promise<ToolResult> {
    const invocationOrError = this.silentBuild(params);
    if (invocationOrError instanceof Error) {
      const errorMessage = invocationOrError.message;
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${errorMessage}`,
        returnDisplay: errorMessage,
        error: {
          message: errorMessage,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    try {
      return await invocationOrError.execute(abortSignal);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error: Tool call execution failed. Reason: ${errorMessage}`,
        returnDisplay: errorMessage,
        error: {
          message: errorMessage,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }
}

/**
 * New base class for declarative tools that separates validation from execution.
 * New tools should extend this class, which provides a `build` method that
 * validates parameters before deferring to a `createInvocation` method for
 * the final `ToolInvocation` object instantiation.
 */
export abstract class BaseDeclarativeTool<
  TParams extends object,
  TResult extends ToolResult,
> extends DeclarativeTool<TParams, TResult> {
  build(params: TParams): ToolInvocation<TParams, TResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      throw new Error(validationError);
    }
    return this.createInvocation(params, this.messageBus);
  }

  override validateToolParams(params: TParams): string | null {
    const errors = SchemaValidator.validate(
      this.schema.parametersJsonSchema,
      params,
    );

    if (errors) {
      return errors;
    }
    return this.validateToolParamValues(params);
  }

  protected validateToolParamValues(_params: TParams): string | null {
    // Base implementation can be extended by subclasses.
    return null;
  }

  protected abstract createInvocation(
    params: TParams,
    messageBus?: MessageBus,
  ): ToolInvocation<TParams, TResult>;
}

/**
 * A type alias for a declarative tool where the specific parameter and result types are not known.
 */
export type AnyDeclarativeTool = DeclarativeTool<object, ToolResult>;

/**
 * Type guard to check if an object is a Tool.
 * @param obj The object to check.
 * @returns True if the object is a Tool, false otherwise.
 */
export function isTool(obj: unknown): obj is AnyDeclarativeTool {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'name' in obj &&
    'build' in obj &&
    typeof (obj as AnyDeclarativeTool).build === 'function'
  );
}
export interface ToolResult {
  /**
   * Content meant to be included in LLM history.
   * This should represent the factual outcome of the tool execution.
   */
  llmContent: PartListUnion;

  /**
   * Markdown string for user display.
   * This provides a user-friendly summary or visualization of the result.
   * NOTE: This might also be considered UI-specific and could potentially be
   * removed or modified in a further refactor if the server becomes purely API-driven.
   * For now, we keep it as the core logic in ReadFileTool currently produces it.
   */
  returnDisplay: ToolResultDisplay;

  /**
   * Optional metadata about the tool execution
   */
  metadata?: Record<string, unknown>;

  /**
   * If this property is present, the tool call is considered a failure.
   */
  error?: {
    message: string; // raw error message
    type?: ToolErrorType; // An optional machine-readable error type (e.g., 'FILE_NOT_FOUND').
  };
}

/**
 * Detects cycles in a JSON schemas due to `$ref`s.
 * @param schema The root of the JSON schema.
 * @returns `true` if a cycle is detected, `false` otherwise.
 */
export function hasCycleInSchema(schema: object): boolean {
  function resolveRef(ref: string): object | null {
    if (!ref.startsWith('#/')) {
      return null;
    }
    const path = ref.substring(2).split('/');
    let current: unknown = schema;
    for (const segment of path) {
      if (
        typeof current !== 'object' ||
        current === null ||
        !Object.prototype.hasOwnProperty.call(current, segment)
      ) {
        return null;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return current as object;
  }

  function traverse(
    node: unknown,
    visitedRefs: Set<string>,
    pathRefs: Set<string>,
  ): boolean {
    if (typeof node !== 'object' || node === null) {
      return false;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        if (traverse(item, visitedRefs, pathRefs)) {
          return true;
        }
      }
      return false;
    }

    if ('$ref' in node && typeof node.$ref === 'string') {
      const ref = node.$ref;
      if (ref === '#/' || pathRefs.has(ref)) {
        // A ref to just '#/' is always a cycle.
        return true; // Cycle detected!
      }
      if (visitedRefs.has(ref)) {
        return false; // Bail early, we have checked this ref before.
      }

      const resolvedNode = resolveRef(ref);
      if (resolvedNode) {
        // Add it to both visited and the current path
        visitedRefs.add(ref);
        pathRefs.add(ref);
        const hasCycle = traverse(resolvedNode, visitedRefs, pathRefs);
        pathRefs.delete(ref); // Backtrack, leaving it in visited
        return hasCycle;
      }
    }

    // Crawl all the properties of node
    for (const key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        if (
          traverse(
            (node as Record<string, unknown>)[key],
            visitedRefs,
            pathRefs,
          )
        ) {
          return true;
        }
      }
    }

    return false;
  }

  return traverse(schema, new Set<string>(), new Set<string>());
}

export interface FileRead {
  content: string;
  fileName: string;
  filePath: string;
  metadata?: Record<string, unknown>;
}

export type ToolResultDisplay = string | FileDiff | FileRead | AnsiOutput;

export interface FileDiff {
  fileDiff: string;
  fileName: string;
  originalContent: string | null;
  newContent: string;
  diffStat?: DiffStat;
  metadata?: Record<string, unknown>;
  applied?: boolean;
}

export interface DiffStat {
  ai_removed_lines: number;
  ai_added_lines: number;
  user_added_lines: number;
  user_removed_lines: number;
}

export interface ToolEditConfirmationDetails {
  type: 'edit';
  title: string;
  onConfirm: (
    outcome: ToolConfirmationOutcome,
    payload?: ToolConfirmationPayload,
  ) => Promise<void>;
  fileName: string;
  filePath: string;
  fileDiff: string;
  originalContent: string | null;
  newContent: string;
  isModifying?: boolean;
  ideConfirmation?: Promise<DiffUpdateResult>;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolExecuteConfirmationDetails {
  type: 'exec';
  title: string;
  onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
  command: string;
  rootCommand: string;
  correlationId?: string;
}

export interface ToolMcpConfirmationDetails {
  type: 'mcp';
  title: string;
  serverName: string;
  toolName: string;
  toolDisplayName: string;
  onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
  correlationId?: string;
}

export interface ToolInfoConfirmationDetails {
  type: 'info';
  title: string;
  onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
  prompt: string;
  urls?: string[];
  correlationId?: string;
}

export type ToolCallConfirmationDetails =
  | ToolEditConfirmationDetails
  | ToolExecuteConfirmationDetails
  | ToolMcpConfirmationDetails
  | ToolInfoConfirmationDetails;

export enum Kind {
  Read = 'read',
  Edit = 'edit',
  Delete = 'delete',
  Move = 'move',
  Search = 'search',
  Execute = 'execute',
  Think = 'think',
  Fetch = 'fetch',
  Other = 'other',
}

export interface ToolLocation {
  // Absolute path to the file
  path: string;
  // Which line (if known)
  line?: number;
}

/**
 * Legacy BaseTool class for backward compatibility with existing LLxprt tools.
 * New tools should use BaseDeclarativeTool instead.
 * @deprecated Use BaseDeclarativeTool for new tools
 */
export abstract class BaseTool<
    TParams extends object,
    TResult extends ToolResult,
  >
  extends DeclarativeTool<TParams, TResult>
  implements ContextAwareTool
{
  context?: ToolContext;

  constructor(
    name: string,
    displayName: string,
    description: string,
    kind: Kind,
    parameterSchema: unknown,
    isOutputMarkdown: boolean = true,
    canUpdateOutput: boolean = false,
  ) {
    super(
      name,
      displayName,
      description,
      kind,
      parameterSchema,
      isOutputMarkdown,
      canUpdateOutput,
    );
  }

  /**
   * Get the schema for this tool. Maintains backward compatibility.
   */
  override get schema(): FunctionDeclaration {
    return super.schema;
  }

  /**
   * Legacy method signature for getDescription.
   * Subclasses can override this method.
   */
  getDescription(_params: TParams): string {
    return `Execute ${this.displayName}`;
  }

  /**
   * Legacy method signature for validateToolParams.
   * Subclasses can override this method.
   * Note: The base class expects TParams, but legacy tools pass unknown.
   */
  override validateToolParams(params: TParams): string | null {
    return super.validateToolParams(params);
  }

  /**
   * Legacy validateToolParams method that accepts unknown params.
   * This maintains compatibility with existing tool implementations.
   */
  validateToolParamsLegacy?(params: unknown): string | null;

  /**
   * Legacy execute method signature.
   * Subclasses should implement this method.
   */
  abstract execute(
    params: TParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<TResult>;

  /**
   * Implementation of the new declarative pattern.
   * Creates a tool invocation that bridges to the legacy execute method.
   */
  override build(params: TParams): ToolInvocation<TParams, TResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      throw new Error(validationError);
    }
    return new BaseToolLegacyInvocation(this, params, this.messageBus);
  }
}

/**
 * Tool invocation wrapper for BaseTool legacy API.
 */
class BaseToolLegacyInvocation<
  TParams extends object,
  TResult extends ToolResult,
> extends BaseToolInvocation<TParams, TResult> {
  constructor(
    private readonly tool: BaseTool<TParams, TResult>,
    params: TParams,
    messageBus?: MessageBus,
  ) {
    super(params, messageBus);
  }

  getDescription(): string {
    return this.tool.getDescription(this.params);
  }

  override getToolName(): string {
    return this.tool.name;
  }

  async execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
    _terminalColumns?: number,
    _terminalRows?: number,
    _setPidCallback?: (pid: number) => void,
  ): Promise<TResult> {
    return this.tool.execute(this.params, signal, updateOutput);
  }
}
