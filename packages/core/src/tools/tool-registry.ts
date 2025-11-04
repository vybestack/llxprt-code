/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FunctionDeclaration } from '@google/genai';
import {
  AnyDeclarativeTool,
  Kind,
  ToolResult,
  BaseTool,
  BaseToolInvocation,
} from './tools.js';
import { ToolContext } from './tool-context.js';
import { Config } from '../config/config.js';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { connectAndDiscover } from './mcp-client.js';
import { McpClientManager } from './mcp-client-manager.js';
import { DiscoveredMCPTool } from './mcp-tool.js';
import { parse } from 'shell-quote';
import { ToolErrorType } from './tool-error.js';
import { safeJsonStringify } from '../utils/safeJsonStringify.js';
import { DebugLogger } from '../debug/index.js';
import type { EventEmitter } from 'node:events';

type ToolParams = Record<string, unknown>;

const normalizeToolName = (name: string): string => name.trim().toLowerCase();

export class DiscoveredTool extends BaseTool<ToolParams, ToolResult> {
  constructor(
    private readonly config: Config,
    name: string,
    override readonly description: string,
    override readonly parameterSchema: Record<string, unknown>,
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
    );
  }

  override build(params: ToolParams): DiscoveredToolInvocation {
    return new DiscoveredToolInvocation(this, params);
  }

  async execute(
    params: ToolParams,
    _signal: AbortSignal,
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
    let signal: NodeJS.Signals | null = null;

    await new Promise<void>((resolve) => {
      const onStdout = (data: Buffer) => {
        stdout += data?.toString();
      };

      const onStderr = (data: Buffer) => {
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
        signal = _signal;
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

    // if there is any error, non-zero exit code, signal, or stderr, return error details instead of stdout
    if (error || code !== 0 || signal || stderr) {
      const llmContent = [
        `Stdout: ${stdout || '(empty)'}`,
        `Stderr: ${stderr || '(empty)'}`,
        `Error: ${error ?? '(none)'}`,
        `Exit Code: ${code ?? '(none)'}`,
        `Signal: ${signal ?? '(none)'}`,
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
  constructor(
    private readonly tool: DiscoveredTool,
    params: ToolParams,
  ) {
    super(params);
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
  private mcpClientManager: McpClientManager;
  private logger = new DebugLogger('llxprt:tool-registry');
  private discoveryLock: Promise<void> | null = null;

  constructor(config: Config, eventEmitter?: EventEmitter) {
    this.config = config;
    this.mcpClientManager = new McpClientManager(
      this.config.getMcpServers() ?? {},
      this.config.getMcpServerCommand(),
      this,
      this.config.getPromptRegistry(),
      this.config.getDebugMode(),
      this.config.getWorkspaceContext(),
      eventEmitter,
    );
  }

  private getToolGovernance(): {
    allowed: Set<string>;
    disabled: Set<string>;
    excluded: Set<string>;
  } {
    const ephemerals =
      typeof this.config.getEphemeralSettings === 'function'
        ? this.config.getEphemeralSettings() || {}
        : {};

    const allowedRaw = Array.isArray(ephemerals['tools.allowed'])
      ? (ephemerals['tools.allowed'] as string[])
      : [];
    const disabledRaw = Array.isArray(ephemerals['tools.disabled'])
      ? (ephemerals['tools.disabled'] as string[])
      : Array.isArray(ephemerals['disabled-tools'])
        ? (ephemerals['disabled-tools'] as string[])
        : [];
    const excludedRaw = this.config.getExcludeTools?.() ?? [];

    return {
      allowed: new Set(allowedRaw.map(normalizeToolName)),
      disabled: new Set(disabledRaw.map(normalizeToolName)),
      excluded: new Set(excludedRaw.map(normalizeToolName)),
    };
  }

  private isToolActive(
    toolName: string,
    governance: ReturnType<ToolRegistry['getToolGovernance']>,
  ): boolean {
    const canonical = normalizeToolName(toolName);
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
   * This will discover tools from the command line and from MCP servers.
   * Uses truly atomic updates to prevent race conditions.
   */
  async discoverAllTools(): Promise<void> {
    await this.withDiscoveryLock(async () => {
      const newTools = this.buildCoreToolsMap();

      await this.config.getPromptRegistry().clear();
      await this.discoverAndRegisterToolsFromCommand(newTools);

      const previousTools = this.tools;
      try {
        this.tools = newTools;
        await this.mcpClientManager.discoverAllMcpTools(this.config);
      } catch (error) {
        this.tools = previousTools;
        throw error;
      }
    });
  }

  /**
   * Discovers tools from project (if available and configured).
   * Can be called multiple times to update discovered tools.
   * This will NOT discover tools from the command line, only from MCP servers.
   * Uses truly atomic updates to prevent race conditions.
   */
  async discoverMcpTools(): Promise<void> {
    await this.withDiscoveryLock(async () => {
      const newTools = this.buildCoreToolsMap();

      for (const tool of this.tools.values()) {
        if (
          tool instanceof DiscoveredTool &&
          !(tool instanceof DiscoveredMCPTool)
        ) {
          this.registerToolIntoMap(tool, newTools);
        }
      }

      await this.config.getPromptRegistry().clear();

      const previousTools = this.tools;
      try {
        this.tools = newTools;
        await this.mcpClientManager.discoverAllMcpTools(this.config);
      } catch (error) {
        this.tools = previousTools;
        throw error;
      }
    });
  }

  /**
   * Restarts all MCP servers and re-discovers tools.
   */
  async restartMcpServers(): Promise<void> {
    await this.discoverMcpTools();
  }

  /**
   * Discover or re-discover tools for a single MCP server.
   * Uses truly atomic updates to prevent race conditions.
   * @param serverName - The name of the server to discover tools from.
   */
  async discoverToolsForServer(serverName: string): Promise<void> {
    await this.withDiscoveryLock(async () => {
      const newTools = new Map<string, AnyDeclarativeTool>();
      for (const tool of this.tools.values()) {
        if (
          !(tool instanceof DiscoveredMCPTool && tool.serverName === serverName)
        ) {
          this.registerToolIntoMap(tool, newTools);
        }
      }

      await this.config.getPromptRegistry().removePromptsByServer(serverName);
      const mcpServers = this.config.getMcpServers() ?? {};
      const serverConfig = mcpServers[serverName];

      const previousTools = this.tools;
      try {
        this.tools = newTools;
        if (serverConfig) {
          const tempRegistry = Object.create(this) as ToolRegistry;
          tempRegistry.registerTool = (tool: AnyDeclarativeTool) => {
            this.registerToolIntoMap(tool, newTools);
          };
          await connectAndDiscover(
            serverName,
            serverConfig,
            tempRegistry,
            this.config.getPromptRegistry(),
            this.config.getDebugMode(),
            this.config.getWorkspaceContext(),
            this.config,
          );
        }
      } catch (error) {
        this.tools = previousTools;
        throw error;
      }
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

      if (!discoveredItems || !Array.isArray(discoveredItems)) {
        throw new Error(
          'Tool discovery command did not return a JSON array of tools.',
        );
      }

      for (const tool of discoveredItems) {
        if (tool && typeof tool === 'object') {
          if (Array.isArray(tool['function_declarations'])) {
            functions.push(...tool['function_declarations']);
          } else if (Array.isArray(tool['functionDeclarations'])) {
            functions.push(...tool['functionDeclarations']);
          } else if (tool['name']) {
            functions.push(tool as FunctionDeclaration);
          }
        }
      }
      // register each function as a tool
      for (const func of functions) {
        if (!func.name) {
          this.logger.warn(() => 'Discovered a tool with no name. Skipping.');
          continue;
        }
        const parameters =
          func.parametersJsonSchema &&
          typeof func.parametersJsonSchema === 'object' &&
          !Array.isArray(func.parametersJsonSchema)
            ? func.parametersJsonSchema
            : {};
        this.registerToolIntoMap(
          new DiscoveredTool(
            this.config,
            func.name,
            func.description ?? '',
            parameters as Record<string, unknown>,
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
   * Retrieves the list of tool schemas (FunctionDeclaration array).
   * Extracts the declarations from the ToolListUnion structure.
   * Includes discovered (vs registered) tools if configured.
   * Filters out disabled tools based on ephemeral settings.
   * @returns An array of FunctionDeclarations.
   */
  getFunctionDeclarations(): FunctionDeclaration[] {
    const governance = this.getToolGovernance();

    const declarations: FunctionDeclaration[] = [];
    this.tools.forEach((tool) => {
      if (this.isToolActive(tool.name, governance)) {
        declarations.push(tool.schema);
      }
    });
    return declarations;
  }

  /**
   * Retrieves a filtered list of tool schemas based on a list of tool names.
   * @param toolNames - An array of tool names to include.
   * @returns An array of FunctionDeclarations for the specified tools.
   */
  getFunctionDeclarationsFiltered(toolNames: string[]): FunctionDeclaration[] {
    const governance = this.getToolGovernance();
    const declarations: FunctionDeclaration[] = [];
    for (const name of toolNames) {
      const tool = this.tools.get(name);
      if (tool && this.isToolActive(tool.name, governance)) {
        declarations.push(tool.schema);
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
    const tool = this.tools.get(name);

    if (!tool) {
      return undefined;
    }

    const governance = this.getToolGovernance();
    if (!this.isToolActive(tool.name, governance)) {
      return undefined;
    }

    if (context) {
      // Inject context into tool instance
      if ('context' in tool) {
        (tool as unknown as { context: ToolContext }).context = context;
      }
    }
    return tool;
  }

  private registerToolIntoMap(
    tool: AnyDeclarativeTool,
    targetMap: Map<string, AnyDeclarativeTool>,
  ): void {
    if (targetMap.has(tool.name)) {
      // For non-MCP tools, log warning and overwrite
      if (!(tool instanceof DiscoveredMCPTool)) {
        this.logger.warn(
          () =>
            `Tool with name "${tool.name}" is already registered. Overwriting.`,
        );
      }
      // For MCP tools, we assume they already have unique names from generateMcpToolName(serverName, toolName)
      // so we simply overwrite (this should not happen in normal operation)
    }
    targetMap.set(tool.name, tool);
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
