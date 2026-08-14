/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type FunctionDeclaration } from '../types/wire-types.js';
import {
  type AnyDeclarativeTool,
  Kind,
  type ToolResult,
  BaseTool,
  BaseToolInvocation,
  type LiveOutputUpdate,
} from './tools.js';
import { type ToolContext, isContextAwareTool } from '../types/tool-context.js';
import type { IToolRegistryHost } from '../interfaces/IToolRegistryHost.js';
import type { IToolMessageBus } from '../interfaces/IToolMessageBus.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { parse } from 'shell-quote';
import { ToolErrorType } from '../types/tool-error.js';
import { safeJsonStringify } from '../utils/safeJsonStringify.js';
import { debugLogger } from '../utils/debugLogger.js';
import { normalizeToolName } from '../formatters/toolNameUtils.js';
import {
  buildToolGovernance,
  isToolBlocked,
  type ToolGovernance,
} from '../formatters/toolGovernanceUtils.js';
import {
  BoundedCombinedCollector,
  createDefaultByteBudget,
  type CombinedAcquisitionResult,
} from '../acquisition/index.js';
import {
  terminateProcessTree,
  type ProcessTerminationResult,
  type ProcessTerminationOptions,
} from '../utils/processTermination.js';

const STREAM_DRAIN_TIMEOUT_MS = 2000;

export const DISCOVERED_TOOL_PREFIX = 'discovered_tool_';

type ToolParams = Record<string, unknown>;
interface McpRegisteredTool {
  readonly serverName: string;
  getFullyQualifiedName?(): string;
}

function isDiscoveredMcpTool(
  tool: AnyDeclarativeTool,
): tool is AnyDeclarativeTool & McpRegisteredTool {
  return (
    typeof (tool as { serverName?: unknown }).serverName === 'string' &&
    (tool as { serverName?: string }).serverName !== ''
  );
}

/**
 * Extracts a usable JSON schema object from a discovered function
 * declaration. Returns `{}` when the schema is missing, null, or not a
 * plain object.
 */
function extractParametersSchema(
  func: FunctionDeclaration,
): Record<string, unknown> {
  const schema = func.parametersJsonSchema;
  if (
    schema !== undefined &&
    schema !== null &&
    typeof schema === 'object' &&
    !Array.isArray(schema)
  ) {
    return schema as Record<string, unknown>;
  }
  return {};
}

export class DiscoveredTool extends BaseTool<ToolParams, ToolResult> {
  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P05
   * @requirement REQ-D01-001.2
   * @pseudocode lines 56-72
   */
  constructor(
    private readonly config: IToolRegistryHost,
    name: string,
    override readonly description: string,
    override readonly parameterSchema: Record<string, unknown>,
    messageBus?: IToolMessageBus,
  ) {
    const discoveryCmd = config.getToolDiscoveryCommand?.() ?? '';
    const callCommand = config.getToolCallCommand?.() ?? '';
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
    _updateOutput?: (update: LiveOutputUpdate) => void,
  ): Promise<ToolResult> {
    if (signal.aborted) {
      return {
        llmContent: 'Tool execution was cancelled by user.',
        returnDisplay: 'Cancelled',
        error: {
          message: 'Tool execution was cancelled by user.',
          type: ToolErrorType.DISCOVERED_TOOL_EXECUTION_ERROR,
        },
      };
    }
    const callCommand = this.config.getToolCallCommand?.() ?? '';
    const child: ChildProcess = spawn(callCommand, [this.name], {
      windowsHide: true,
      detached: process.platform !== 'win32',
    });

    const { acquisition, error, code, exitSignal, terminationOutcome } =
      await this.runChildProcess(child, signal, params);

    return this.buildChildProcessResult(
      acquisition,
      error,
      code,
      exitSignal,
      terminationOutcome,
    );
  }

  /**
   * Terminate a child process tree. Overridable for deterministic tests
   * that need to simulate termination outcomes without real signals.
   */
  protected terminateChild(
    child: ChildProcess,
    options?: ProcessTerminationOptions,
  ): Promise<ProcessTerminationResult> {
    return terminateProcessTree(child, options);
  }

  private async runChildProcess(
    child: ChildProcess,
    signal: AbortSignal,
    params: ToolParams,
  ): Promise<{
    acquisition: CombinedAcquisitionResult;
    error: Error | null;
    code: number | null;
    exitSignal: NodeJS.Signals | null;
    terminationOutcome: ProcessTerminationResult['outcome'] | null;
  }> {
    const collector = new BoundedCombinedCollector({
      budget: createDefaultByteBudget(),
    });

    const { error, code, exitSignal, drainTimedOut, terminationOutcome } =
      await this.awaitProcessSettlement(child, collector, params, signal);

    let outcome = terminationOutcome;
    if (
      outcome === null &&
      (drainTimedOut || (child.exitCode === null && child.signalCode === null))
    ) {
      const result = await this.terminateChild(child, {
        ownsProcessGroup: true,
      });
      outcome = result.outcome;
    }

    return {
      acquisition: collector.getResult(),
      error,
      code,
      exitSignal,
      terminationOutcome: outcome,
    };
  }

  private writeParamsToStdin(
    child: ChildProcess,
    params: ToolParams,
    onError: (err: Error) => void,
  ): void {
    if (child.stdin === null) return;
    try {
      child.stdin.write(JSON.stringify(params));
      child.stdin.end();
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private awaitProcessSettlement(
    child: ChildProcess,
    collector: BoundedCombinedCollector,
    params: ToolParams,
    signal: AbortSignal,
  ): Promise<{
    error: Error | null;
    code: number | null;
    exitSignal: NodeJS.Signals | null;
    drainTimedOut: boolean;
    terminationOutcome: ProcessTerminationResult['outcome'] | null;
  }> {
    let error: Error | null = null;
    let code: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let drainTimedOut = false;
    let terminationOutcome: ProcessTerminationResult['outcome'] | null = null;

    return new Promise((resolve) => {
      let settled = false;
      let drainTimer: ReturnType<typeof setTimeout> | null = null;
      let terminationPromise: Promise<ProcessTerminationResult> | null = null;

      const settle = () => {
        if (settled) return;
        settled = true;
        if (drainTimer !== null) clearTimeout(drainTimer);
        child.stdout?.removeListener('data', onStdout);
        child.stderr?.removeListener('data', onStderr);
        child.stdin?.removeListener('error', captureFirstError);
        child.removeListener('error', captureFirstError);
        child.removeListener('exit', onExit);
        child.removeListener('close', onClose);
        signal.removeEventListener('abort', onAbort);
        resolve({ error, code, exitSignal, drainTimedOut, terminationOutcome });
      };

      const onStdout = (data: Buffer) => collector.append(data, 'stdout');
      const onStderr = (data: Buffer) => collector.append(data, 'stderr');
      const captureFirstError = (err: Error) => {
        error ??= err;
        settle();
      };
      const onExit = (c: number | null, s: NodeJS.Signals | null) => {
        if (settled) return;
        code = c;
        exitSignal = s;
        drainTimer = setTimeout(() => {
          drainTimedOut = true;
          settle();
        }, STREAM_DRAIN_TIMEOUT_MS);
      };
      const onClose = (c: number | null, s: NodeJS.Signals | null) => {
        code ??= c;
        exitSignal ??= s;
        settle();
      };
      const onAbort = () => {
        terminationPromise ??= this.terminateChild(child, {
          ownsProcessGroup: true,
        });
        void terminationPromise.then((result) => {
          terminationOutcome = result.outcome;
          if (
            result.outcome === 'timeout' ||
            result.outcome === 'failure' ||
            result.outcome === 'no_target'
          ) {
            settle();
          }
        });
      };

      child.stdout?.on('data', onStdout);
      child.stderr?.on('data', onStderr);
      child.stdin?.on('error', captureFirstError);
      child.on('error', captureFirstError);
      child.on('exit', onExit);
      child.on('close', onClose);
      signal.addEventListener('abort', onAbort);
      this.writeParamsToStdin(child, params, captureFirstError);
    });
  }

  private buildChildProcessResult(
    acquisition: CombinedAcquisitionResult,
    error: Error | null,
    code: number | null,
    exitSignal: NodeJS.Signals | null,
    terminationOutcome: ProcessTerminationResult['outcome'] | null,
  ): ToolResult {
    const stdout = acquisition.stdoutText;
    const stderr = acquisition.stderrText;
    const truncated = acquisition.metadata.truncated;
    const truncationNotice = acquisition.omissionNotice ?? '';
    const truncationMetadata = truncated
      ? { metadata: { outputTruncation: acquisition.metadata } }
      : {};

    const terminationFailed =
      terminationOutcome === 'timeout' || terminationOutcome === 'failure';
    const isExecutionError =
      error !== null || code !== 0 || exitSignal !== null;

    if (isExecutionError || stderr.length > 0 || terminationFailed) {
      const stdoutLine = `Stdout: ${stdout.length > 0 ? stdout : '(empty)'}`;
      const stderrLine = `Stderr: ${stderr.length > 0 ? stderr : '(empty)'}`;
      const terminationLine = terminationFailed
        ? `\nTermination: ${terminationOutcome}`
        : '';
      const truncationLine = truncated ? `\n${truncationNotice}` : '';
      const llmContent = [
        stdoutLine,
        stderrLine,
        `Error: ${error ?? '(none)'}`,
        `Exit Code: ${code ?? '(none)'}`,
        `Signal: ${exitSignal ?? '(none)'}`,
      ].join('\n');

      const fullContent = llmContent + terminationLine + truncationLine;
      return {
        llmContent: fullContent,
        returnDisplay: fullContent,
        ...truncationMetadata,
        error: {
          message: fullContent,
          type: ToolErrorType.DISCOVERED_TOOL_EXECUTION_ERROR,
        },
      };
    }

    const llmContent = truncated ? `${stdout}\n\n${truncationNotice}` : stdout;

    return {
      llmContent,
      returnDisplay: llmContent,
      ...truncationMetadata,
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
    messageBus: IToolMessageBus,
  ) {
    super(params, messageBus);
  }

  getDescription(): string {
    return safeJsonStringify(this.params);
  }

  async execute(
    signal: AbortSignal,
    updateOutput?: (update: LiveOutputUpdate) => void,
  ): Promise<ToolResult> {
    return this.tool.execute(this.params, signal, updateOutput);
  }
}

export class ToolRegistry {
  private tools: Map<string, AnyDeclarativeTool> = new Map();
  private config: IToolRegistryHost;
  private logger = debugLogger;
  private discoveryLock: Promise<void> | null = null;
  private readonly activatedMcpServers: Set<string> = new Set();

  private readonly messageBus: IToolMessageBus;

  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
   * @requirement REQ-D01-002
   * @requirement REQ-D01-003
   * @pseudocode lines 122-133
   */
  constructor(config: IToolRegistryHost, messageBus: IToolMessageBus) {
    this.config = config;
    this.messageBus = messageBus;
  }

  private getToolGovernance(): ToolGovernance {
    return buildToolGovernance({
      getEphemeralSettings: () =>
        this.config.getEphemeralSettings?.() ?? undefined,
      getExcludeTools: () => this.config.getExcludeTools?.(),
    });
  }

  private isToolActive(toolName: string, governance: ToolGovernance): boolean {
    return !isToolBlocked(toolName, governance);
  }

  private getEphemeralPath(key: string): unknown {
    const ephemerals: unknown = this.config.getEphemeralSettings?.();
    if (
      ephemerals === null ||
      typeof ephemerals !== 'object' ||
      Array.isArray(ephemerals)
    ) {
      return undefined;
    }

    if (Reflect.has(ephemerals, key)) {
      return Reflect.get(ephemerals, key);
    }

    const parts = key.split('.');
    let current: unknown = ephemerals;
    for (const part of parts) {
      if (current === null || typeof current !== 'object') {
        return undefined;
      }
      if (Array.isArray(current) || !Reflect.has(current, part)) {
        return undefined;
      }
      current = Reflect.get(current, part);
    }
    return current;
  }

  private isLazyMcpEnabled(): boolean {
    return this.getEphemeralPath('mcp.lazy') === true;
  }

  private getEagerServers(): Set<string> {
    const raw = this.getEphemeralPath('mcp.eagerServers');
    if (
      Array.isArray(raw) &&
      raw.every((v): v is string => typeof v === 'string')
    ) {
      return new Set(raw);
    }
    return new Set();
  }

  private getMcpServerNames(): Set<string> {
    const servers = new Set<string>();
    for (const tool of this.tools.values()) {
      if (isDiscoveredMcpTool(tool)) {
        servers.add(tool.serverName);
      }
    }
    return servers;
  }

  listDeferredMcpServers(): string[] {
    if (!this.isLazyMcpEnabled()) {
      return [];
    }
    const eager = this.getEagerServers();
    const deferred: string[] = [];
    for (const server of this.getMcpServerNames()) {
      if (!eager.has(server) && !this.activatedMcpServers.has(server)) {
        deferred.push(server);
      }
    }
    return deferred.sort();
  }

  activateMcpServer(name: string): void {
    const knownServers = this.getMcpServerNames();
    if (!knownServers.has(name)) {
      throw new Error(
        `Unknown MCP server "${name}". Known servers: ${Array.from(knownServers).sort().join(', ')}.`,
      );
    }
    this.activatedMcpServers.add(name);
  }

  private shouldDeferMcpTool(
    tool: AnyDeclarativeTool,
    lazy: boolean,
    eager: ReadonlySet<string>,
  ): boolean {
    return (
      lazy &&
      isDiscoveredMcpTool(tool) &&
      !eager.has(tool.serverName) &&
      !this.activatedMcpServers.has(tool.serverName)
    );
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
      if (isDiscoveredMcpTool(tool)) return 2;
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
          const serverA = isDiscoveredMcpTool(toolA) ? toolA.serverName : '';
          const serverB = isDiscoveredMcpTool(toolB) ? toolB.serverName : '';
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
      if (!(tool instanceof DiscoveredTool || isDiscoveredMcpTool(tool))) {
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
      if (isDiscoveredMcpTool(tool) && tool.serverName === serverName) {
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

      this.config.getPromptRegistry?.()?.clear();

      await this.discoverAndRegisterToolsFromCommand(newTools);

      this.tools = newTools;
    });
  }

  private async discoverAndRegisterToolsFromCommand(
    targetMap: Map<string, AnyDeclarativeTool>,
  ): Promise<void> {
    const discoveryCmd = this.config.getToolDiscoveryCommand?.();
    if (!discoveryCmd) {
      return;
    }

    try {
      const stdout = await this.runDiscoveryCommand(discoveryCmd);
      const functions = this.parseDiscoveredFunctions(stdout);
      this.registerDiscoveredFunctions(functions, targetMap);
    } catch (e) {
      this.logger.error(
        () => `Tool discovery command "${discoveryCmd}" failed:`,
        { error: e },
      );
      throw e;
    }
  }

  private async runDiscoveryCommand(discoveryCmd: string): Promise<string> {
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
          reject(
            new Error(
              `Tool discovery command output exceeded size limit of ${MAX_STDOUT_SIZE} bytes.`,
            ),
          );
          return;
        }

        if (code !== 0) {
          this.logger.error(() => `Command failed with code ${code}`);
          this.logger.error(() => stderr);
          reject(
            new Error(`Tool discovery command failed with exit code ${code}`),
          );
          return;
        }
        resolve();
      });
    });

    return stdout;
  }

  private parseDiscoveredFunctions(stdout: string): FunctionDeclaration[] {
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
    return functions;
  }

  private registerDiscoveredFunctions(
    functions: FunctionDeclaration[],
    targetMap: Map<string, AnyDeclarativeTool>,
  ): void {
    for (const func of functions) {
      if (func.name === undefined || func.name === '') {
        this.logger.warn(() => 'Discovered a tool with no name. Skipping.');
        continue;
      }
      const parameters = extractParametersSchema(func);
      this.registerToolIntoMap(
        new DiscoveredTool(
          this.config,
          `discovered_tool_${func.name}`,
          func.description ?? '',
          parameters,
          this.messageBus,
        ),

        targetMap,
      );
    }
  }

  /**
   * Gets schema transformation config based on current settings.
   * Used to conditionally hide tool parameters that are disabled by settings.
   */
  private getSchemaTransforms(): { hideTaskAsync: boolean } {
    const settingsService = this.config.getSettingsService?.();

    // Global setting from /settings (subagents.asyncEnabled)
    let globalAsyncEnabled = true;
    if (settingsService !== undefined) {
      const globalSettings = settingsService.getAllGlobalSettings?.();
      const subagentsSettings = globalSettings?.['subagents'] as
        | { asyncEnabled?: boolean }
        | undefined;
      globalAsyncEnabled = subagentsSettings?.asyncEnabled !== false;
    }

    // Profile setting from /set (subagents.async.enabled)
    const profileAsyncEnabled =
      settingsService?.get?.('subagents.async.enabled') !== false;

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
    const lazy = this.isLazyMcpEnabled();
    const eager = lazy ? this.getEagerServers() : new Set<string>();

    const declarations: FunctionDeclaration[] = [];
    this.tools.forEach((tool) => {
      if (this.isToolActive(tool.name, governance)) {
        if (this.shouldDeferMcpTool(tool, lazy, eager)) {
          return;
        }
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
      if (isDiscoveredMcpTool(tool) && tool.serverName === serverName) {
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
        if (
          isDiscoveredMcpTool(t) &&
          typeof t.getFullyQualifiedName === 'function' &&
          t.getFullyQualifiedName() === name
        ) {
          tool = t;
          break;
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

    // Inject context into tool instance
    if (context && isContextAwareTool(tool)) {
      tool.context = context;
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
    const normalizedName = normalizeToolName(tool.name) ?? tool.name;

    if (targetMap.has(normalizedName) && !isDiscoveredMcpTool(tool)) {
      // For non-MCP tools, log warning and overwrite
      // For MCP tools, we assume they already have unique names from generateMcpToolName(serverName, toolName)
      // so we simply overwrite (this should not happen in normal operation)
      this.logger.warn(
        () =>
          `Tool with name "${tool.name}" (normalized: "${normalizedName}") is already registered. Overwriting.`,
      );
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
