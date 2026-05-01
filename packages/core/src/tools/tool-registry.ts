/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type FunctionDeclaration } from '@google/genai';
import {
  type AnyDeclarativeTool,
  Kind,
  type ToolResult,
  BaseTool,
  BaseToolInvocation,
} from './tools.js';
import { type ToolContext } from './tool-context.js';
import type { Config } from '../config/config.js';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { DiscoveredMCPTool } from './mcp-tool.js';
import { parse } from 'shell-quote';
import { ToolErrorType } from './tool-error.js';
import { safeJsonStringify } from '../utils/safeJsonStringify.js';
import { DebugLogger } from '../debug/index.js';
import { normalizeToolName } from './toolNameUtils.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

export const DISCOVERED_TOOL_PREFIX = 'discovered_tool_';

type ToolParams = Record<string, unknown>;

export class DiscoveredTool extends BaseTool<ToolParams, ToolResult> {
  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P05
   * @requirement REQ-D01-001.2
   * @pseudocode lines 56-72
   */
  constructor(
    private readonly config: Config,
    name: string,
    override readonly description: string,
    override readonly parameterSchema: Record<string, unknown>,
    messageBus: MessageBus,
  ) {
    const discoveryCmd = config.getToolDiscoveryCommand()!;
    const callCommand = config.getToolCallCommand()!;
    description += `

This tool was discovered from the project by executing the command \`${discoveryCmd}\` on project root.
When called, this tool will execute the command \`${callCommand} ${name}\` on project root.
Tool discovery and call commands can be configured in project or user settings.

When called, the tool call command is executed as a subprocess.
On success, tool output is returned as a json string.
Otherwise, the following information is returned:

Stdout: Output on stdout stream. Can be \`(empty)\` or partial.
Stderr: Output on stderr stream. Can be \`(empty)\` or partial.
Error: Error or \`(none)\` if no error was reported for the subprocess.
Exit Code: Exit code or \`(none)\` if terminated by signal.
Signal: Signal number or \`(none)\` if no signal was received.
`;
    super(
      name,
      name,
      description,
      Kind.Other,
      parameterSchema,
      false, // isOutputMarkdown
      false, // canUpdateOutput
      messageBus,
    );
  }

  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P05
   * @requirement REQ-D01-001.2
   * @pseudocode lines 56-72
   */
  override build(params: ToolParams): DiscoveredToolInvocation {
    return new DiscoveredToolInvocation(this, params, this.requireMessageBus());
  }

  async execute(
    params: ToolParams,
    signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const callCommand = this.config.getToolCallCommand()!;
    const child = spawn(callCommand, [this.name]);
    child.stdin.write(JSON.stringify(params));
    child.stdin.end();

    let stdout = '';
    let stderr = '';
    let error: Error | null = null;
    let code: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;

    // Handle abort signal to kill the child process
    const abortHandler = () => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    };
    signal.addEventListener('abort', abortHandler);

    try {
      await new Promise<void>((resolve) => {
        const onStdout = (data: Buffer) => {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
          stdout += data?.toString();
        };

        const onStderr = (data: Buffer) => {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
          stderr += data?.toString();
        };

        const onError = (err: Error) => {
          error = err;
        };

        const onClose = (
          _code: number | null,
          _signal: NodeJS.Signals | null,
        ) => {
          code = _code;
          exitSignal = _signal;
          cleanup();
          resolve();
        };

        const cleanup = () => {
          child.stdout.removeListener('data', onStdout);
          child.stderr.removeListener('data', onStderr);
          child.removeListener('error', onError);
          child.removeListener('close', onClose);
          if (child.connected) {
            child.disconnect();
          }
        };

        child.stdout.on('data', onStdout);
        child.stderr.on('data', onStderr);
        child.on('error', onError);
        child.on('close', onClose);
      });
    } finally {
      signal.removeEventListener('abort', abortHandler);
    }

    // if there is any error, non-zero exit code, signal, or stderr, return error details instead of stdout
    /* eslint-disable @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types. */
    if (
      error !== null ||
      code !== 0 ||
      exitSignal !== null ||
      stderr.length > 0
    ) {
      /* eslint-enable @typescript-eslint/no-unnecessary-condition */
      const llmContent = [
        `Stdout: ${stdout.length > 0 ? stdout : '(empty)'}`,
        `Stderr: ${stderr.length > 0 ? stderr : '(empty)'}`,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        `Error: ${error ?? '(none)'}`,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        `Exit Code: ${code ?? '(none)'}`,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        `Signal: ${exitSignal ?? '(none)'}`,
      ].join('\n');
      return {
        llmContent,
        returnDisplay: llmContent,
        error: {
          message: llmContent,
          type: ToolErrorType.DISCOVERED_TOOL_EXECUTION_ERROR,
        },
      };
    }

    return {
      llmContent: stdout,
      returnDisplay: stdout,
    };
  }
}

class DiscoveredToolInvocation extends BaseToolInvocation<
  ToolParams,
  ToolResult
> {
  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P05
   * @requirement REQ-D01-001.2
   * @pseudocode lines 56-72
   */
  constructor(
    private readonly tool: DiscoveredTool,
    params: ToolParams,
    messageBus: MessageBus,
  ) {
    super(params, messageBus);
  }

  getDescription(): string {
    return safeJsonStringify(this.params);
  }

  async execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    return this.tool.execute(this.params, signal, updateOutput);
  }
}

export class ToolRegistry {
  private tools: Map<string, AnyDeclarativeTool> = new Map();
  private config: Config;
  private logger = new DebugLogger('llxprt:tool-registry');
  private discoveryLock: Promise<void> | null = null;

  private readonly messageBus: MessageBus;

  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
   * @requirement REQ-D01-002
   * @requirement REQ-D01-003
   * @pseudocode lines 122-133
   */
  constructor(config: Config, messageBus: MessageBus) {
    this.config = config;
    this.messageBus = messageBus;
  }

  private getToolGovernance(): {
    allowed: Set<string>;
    disabled: Set<string>;
    excluded: Set<string>;
  } {
    const rawEphemerals =
      typeof this.config.getEphemeralSettings === 'function'
        ? (this.config.getEphemeralSettings() as
            | Record<string, unknown>
            | null
            | undefined
            | false
            | 0
            | '')
        : undefined;
    const ephemerals =
      rawEphemerals !== null &&
      rawEphemerals !== undefined &&
      rawEphemerals !== false &&
      rawEphemerals !== 0 &&
      rawEphemerals !== ''
        ? rawEphemerals
        : {};

    const allowedRaw = Array.isArray(ephemerals['tools.allowed'])
      ? (ephemerals['tools.allowed'] as string[])
      : [];
    const disabledRaw = Array.isArray(ephemerals['tools.disabled'])
      ? (ephemerals['tools.disabled'] as string[])
      : Array.isArray(ephemerals['disabled-tools'])
        ? (ephemerals['disabled-tools'] as string[])
        : [];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    const excludedRaw = this.config.getExcludeTools?.() ?? [];

    return {
      allowed: new Set(
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string normalized name should fall through to original name
        allowedRaw.map((name) => normalizeToolName(name) || name),
      ),
      disabled: new Set(
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string normalized name should fall through to original name
        disabledRaw.map((name) => normalizeToolName(name) || name),
      ),
      excluded: new Set(
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string normalized name should fall through to original name
        excludedRaw.map((name) => normalizeToolName(name) || name),
      ),
    };
  }

  private isToolActive(
    toolName: string,
    governance: ReturnType<ToolRegistry['getToolGovernance']>,
  ): boolean {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string normalized name should fall through to original name
    const canonical = normalizeToolName(toolName) || toolName;
    if (governance.excluded.has(canonical)) {
      return false;
    }
    if (governance.disabled.has(canonical)) {
      return false;
    }
    if (governance.allowed.size > 0 && !governance.allowed.has(canonical)) {
      return false;
    }
    return true;
  }

  /**
   * Registers a tool definition.
   * @param tool - The tool object containing schema and execution logic.
   */
  registerTool(tool: AnyDeclarativeTool): void {
    this.registerToolIntoMap(tool, this.tools);
  }

  /**
   * Unregisters a tool definition by name.
   *
   * @param name - The name of the tool to unregister.
   */
  unregisterTool(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Sorts tools as:
   * 1. Built in tools.
   * 2. Discovered tools.
   * 3. MCP tools ordered by server name.
   *
   * This is a stable sort in that ties preserve existing order.
   */
  sortTools(): void {
    const getPriority = (tool: AnyDeclarativeTool): number => {
      if (tool instanceof DiscoveredMCPTool) return 2;
      if (tool instanceof DiscoveredTool) return 1;
      return 0; // Built-in
    };

    this.tools = new Map(
      Array.from(this.tools.entries()).sort((a, b) => {
        const toolA = a[1];
        const toolB = b[1];
        const priorityA = getPriority(toolA);
        const priorityB = getPriority(toolB);

        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }

        if (priorityA === 2) {
          const serverA = (toolA as DiscoveredMCPTool).serverName;
          const serverB = (toolB as DiscoveredMCPTool).serverName;
          return serverA.localeCompare(serverB);
        }

        return 0;
      }),
    );
  }

  /**
   * Builds a new tool map with only non-discovered tools (core tools).
   * This is used for atomic updates to avoid race conditions.
   */
  private buildCoreToolsMap(): Map<string, AnyDeclarativeTool> {
    const coreTools = new Map<string, AnyDeclarativeTool>();
    for (const [name, tool] of this.tools.entries()) {
      if (
        !(tool instanceof DiscoveredTool || tool instanceof DiscoveredMCPTool)
      ) {
        coreTools.set(name, tool);
      }
    }
    return coreTools;
  }

  /**
   * Removes all tools from a specific MCP server.
   * @param serverName The name of the server to remove tools from.
   */
  removeMcpToolsByServer(serverName: string): void {
    for (const [name, tool] of this.tools.entries()) {
      if (tool instanceof DiscoveredMCPTool && tool.serverName === serverName) {
        this.tools.delete(name);
      }
    }
  }

  /**
   * Discovers tools from project (if available and configured).
   * Can be called multiple times to update discovered tools.
   * This will ONLY discover tools from the command line, NOT from MCP servers.
   * Uses truly atomic updates to prevent race conditions.
   */
  async discoverAllTools(): Promise<void> {
    await this.withDiscoveryLock(async () => {
      const newTools = this.buildCoreToolsMap();

      this.config.getPromptRegistry().clear();

      await this.discoverAndRegisterToolsFromCommand(newTools);

      this.tools = newTools;
    });
  }

  private async discoverAndRegisterToolsFromCommand(
    targetMap: Map<string, AnyDeclarativeTool>,
  ): Promise<void> {
    const discoveryCmd = this.config.getToolDiscoveryCommand();
    if (!discoveryCmd) {
      return;
    }

    try {
      const cmdParts = parse(discoveryCmd);
      if (cmdParts.length === 0) {
        throw new Error(
          'Tool discovery command is empty or contains only whitespace.',
        );
      }
      const proc = spawn(cmdParts[0] as string, cmdParts.slice(1) as string[]);
      let stdout = '';
      const stdoutDecoder = new StringDecoder('utf8');
      let stderr = '';
      const stderrDecoder = new StringDecoder('utf8');
      let sizeLimitExceeded = false;
      const MAX_STDOUT_SIZE = 10 * 1024 * 1024; // 10MB limit
      const MAX_STDERR_SIZE = 10 * 1024 * 1024; // 10MB limit

      let stdoutByteLength = 0;
      let stderrByteLength = 0;

      proc.stdout.on('data', (data) => {
        if (sizeLimitExceeded) return;
        if (stdoutByteLength + data.length > MAX_STDOUT_SIZE) {
          sizeLimitExceeded = true;
          proc.kill();
          return;
        }
        stdoutByteLength += data.length;
        stdout += stdoutDecoder.write(data);
      });

      proc.stderr.on('data', (data) => {
        if (sizeLimitExceeded) return;
        if (stderrByteLength + data.length > MAX_STDERR_SIZE) {
          sizeLimitExceeded = true;
          proc.kill();
          return;
        }
        stderrByteLength += data.length;
        stderr += stderrDecoder.write(data);
      });

      await new Promise<void>((resolve, reject) => {
        proc.on('error', reject);
        proc.on('close', (code) => {
          stdout += stdoutDecoder.end();
          stderr += stderrDecoder.end();

          if (sizeLimitExceeded) {
            return reject(
              new Error(
                `Tool discovery command output exceeded size limit of ${MAX_STDOUT_SIZE} bytes.`,
              ),
            );
          }

          if (code !== 0) {
            this.logger.error(() => `Command failed with code ${code}`);
            this.logger.error(() => stderr);
            return reject(
              new Error(`Tool discovery command failed with exit code ${code}`),
            );
          }
          resolve();
        });
      });

      // execute discovery command and extract function declarations (w/ or w/o "tool" wrappers)
      const functions: FunctionDeclaration[] = [];
      const discoveredItems = JSON.parse(stdout.trim());

      if (
        discoveredItems === null ||
        discoveredItems === undefined ||
        !Array.isArray(discoveredItems)
      ) {
        throw new Error(
          'Tool discovery command did not return a JSON array of tools.',
        );
      }

      for (const tool of discoveredItems) {
        if (tool !== null && typeof tool === 'object') {
          if (Array.isArray(tool['function_declarations'])) {
            functions.push(...tool['function_declarations']);
          } else if (Array.isArray(tool['functionDeclarations'])) {
            functions.push(...tool['functionDeclarations']);
          } else if (typeof tool['name'] === 'string' && tool['name'] !== '') {
            functions.push(tool as FunctionDeclaration);
          }
        }
      }
      // register each function as a tool
      for (const func of functions) {
        if (func.name === undefined || func.name === '') {
          this.logger.warn(() => 'Discovered a tool with no name. Skipping.');
          continue;
        }
        const parameters =
          func.parametersJsonSchema !== undefined &&
          func.parametersJsonSchema !== null &&
          typeof func.parametersJsonSchema === 'object' &&
          !Array.isArray(func.parametersJsonSchema)
            ? func.parametersJsonSchema
            : {};
        this.registerToolIntoMap(
          new DiscoveredTool(
            this.config,
            `discovered_tool_${func.name}`,
            func.description ?? '',
            parameters as Record<string, unknown>,
            this.messageBus,
          ),

          targetMap,
        );
      }
    } catch (e) {
      this.logger.error(
        () => `Tool discovery command "${discoveryCmd}" failed:`,
        { error: e },
      );
      throw e;
    }
  }

  /**
   * Gets schema transformation config based on current settings.
   * Used to conditionally hide tool parameters that are disabled by settings.
   */
  private getSchemaTransforms(): { hideTaskAsync: boolean } {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    const settingsService = this.config.getSettingsService?.();

    // Global setting from /settings (subagents.asyncEnabled)
    let globalAsyncEnabled = true;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    if (settingsService !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      const globalSettings = settingsService.getAllGlobalSettings?.();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      const subagentsSettings = globalSettings?.['subagents'] as
        | { asyncEnabled?: boolean }
        | undefined;
      globalAsyncEnabled = subagentsSettings?.asyncEnabled !== false;
    }

    // Profile setting from /set (subagents.async.enabled)
    const profileAsyncEnabled =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      settingsService?.get('subagents.async.enabled') !== false;

    return {
      hideTaskAsync:
        globalAsyncEnabled !== true || profileAsyncEnabled !== true,
    };
  }

  /**
   * Applies schema transformations based on settings.
   * Removes parameters that are disabled by user/profile settings.
   */
  private applySchemaTransforms(
    schema: FunctionDeclaration,
    transforms: { hideTaskAsync: boolean },
  ): FunctionDeclaration {
    // Hide 'async' parameter from task tool when async subagents are disabled
    if (schema.name === 'task' && transforms.hideTaskAsync) {
      const newSchema = structuredClone(schema);
      const jsonSchema = newSchema.parametersJsonSchema as
        | { properties?: Record<string, unknown> }
        | undefined;
      if (jsonSchema?.properties) {
        delete jsonSchema.properties.async;
      }
      return newSchema;
    }
    return schema;
  }

  /**
   * Retrieves the list of tool schemas (FunctionDeclaration array).
   * Extracts the declarations from the ToolListUnion structure.
   * Includes discovered (vs registered) tools if configured.
   * Filters out disabled tools based on ephemeral settings.
   * Applies schema transformations to hide disabled parameters.
   * @returns An array of FunctionDeclarations.
   */
  getFunctionDeclarations(): FunctionDeclaration[] {
    const governance = this.getToolGovernance();
    const transforms = this.getSchemaTransforms();

    const declarations: FunctionDeclaration[] = [];
    this.tools.forEach((tool) => {
      if (this.isToolActive(tool.name, governance)) {
        declarations.push(this.applySchemaTransforms(tool.schema, transforms));
      }
    });
    return declarations;
  }

  /**
   * Retrieves a filtered list of tool schemas based on a list of tool names.
   * Applies schema transformations to hide disabled parameters.
   * @param toolNames - An array of tool names to include.
   * @returns An array of FunctionDeclarations for the specified tools.
   */
  getFunctionDeclarationsFiltered(toolNames: string[]): FunctionDeclaration[] {
    const governance = this.getToolGovernance();
    const transforms = this.getSchemaTransforms();
    const declarations: FunctionDeclaration[] = [];
    for (const name of toolNames) {
      const tool = this.tools.get(name);
      if (tool && this.isToolActive(tool.name, governance)) {
        declarations.push(this.applySchemaTransforms(tool.schema, transforms));
      }
    }
    return declarations;
  }

  /**
   * Returns an array of all registered and discovered tool names.
   */
  getAllToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Returns an array of all registered and discovered tool instances.
   */
  getAllTools(): AnyDeclarativeTool[] {
    const tools = Array.from(this.tools.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
    return tools;
  }

  /**
   * Returns an array of enabled tool instances (excludes disabled tools).
   */
  getEnabledTools(): AnyDeclarativeTool[] {
    const governance = this.getToolGovernance();

    return Array.from(this.tools.values())
      .filter((tool) => this.isToolActive(tool.name, governance))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  /**
   * Returns an array of tools registered from a specific MCP server.
   */
  getToolsByServer(serverName: string): AnyDeclarativeTool[] {
    const serverTools: AnyDeclarativeTool[] = [];
    for (const tool of this.tools.values()) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      if ((tool as DiscoveredMCPTool)?.serverName === serverName) {
        serverTools.push(tool);
      }
    }
    return serverTools.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get the definition of a specific tool.
   * @param name The name of the tool to retrieve
   * @param context Optional context to inject into the tool instance
   */
  getTool(name: string, context?: ToolContext): AnyDeclarativeTool | undefined {
    // Try original name first (most common case)
    let tool = this.tools.get(name);

    // If not found, try normalized name for fuzzy matching
    if (!tool) {
      const normalizedName = normalizeToolName(name);
      if (normalizedName && normalizedName !== name) {
        tool = this.tools.get(normalizedName);
      }
    }

    // If still not found and the name includes '__', try fallback lookup by fully qualified name
    if (!tool && name.includes('__')) {
      for (const t of this.tools.values()) {
        if (t instanceof DiscoveredMCPTool) {
          if (t.getFullyQualifiedName() === name) {
            tool = t;
            break;
          }
        }
      }
    }

    if (!tool) {
      const missingTool: AnyDeclarativeTool | undefined = void 0;
      return missingTool;
    }

    const governance = this.getToolGovernance();
    if (!this.isToolActive(tool.name, governance)) {
      const inactiveTool: AnyDeclarativeTool | undefined = void 0;
      return inactiveTool;
    }

    if (context) {
      // Inject context into tool instance
      if ('context' in tool) {
        (tool as unknown as { context: ToolContext }).context = context;
      }
    }
    return tool;
  }

  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P05
   * @requirement REQ-D01-001.2
   * @pseudocode lines 56-72
   */
  private registerToolIntoMap(
    tool: AnyDeclarativeTool,
    targetMap: Map<string, AnyDeclarativeTool>,
  ): void {
    // Normalize the tool name for consistent storage and lookup
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string tool name should fall through to original name
    const normalizedName = normalizeToolName(tool.name) || tool.name;

    if (targetMap.has(normalizedName)) {
      // For non-MCP tools, log warning and overwrite
      if (!(tool instanceof DiscoveredMCPTool)) {
        this.logger.warn(
          () =>
            `Tool with name "${tool.name}" (normalized: "${normalizedName}") is already registered. Overwriting.`,
        );
      }
      // For MCP tools, we assume they already have unique names from generateMcpToolName(serverName, toolName)
      // so we simply overwrite (this should not happen in normal operation)
    }

    // Store the tool with the normalized name for consistent lookup
    targetMap.set(normalizedName, tool);
  }

  private async withDiscoveryLock<T>(task: () => Promise<T>): Promise<T> {
    while (this.discoveryLock) {
      await this.discoveryLock;
    }

    let release: () => void = () => {};
    this.discoveryLock = new Promise<void>((resolve) => {
      release = () => resolve();
    });

    try {
      return await task();
    } finally {
      release();
      this.discoveryLock = null;
    }
  }
}
