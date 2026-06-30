/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ToolErrorType,
  type ISubagentService,
  type SubagentConfig as ToolsSubagentConfig,
  type SubagentExecutionOptions,
  type SubagentInfo,
  type SubagentRequest,
  type SubagentResult,
} from '@vybestack/llxprt-code-tools';
import type { SubagentManager } from '../config/subagentManager.js';
import type { ProfileManager } from '@vybestack/llxprt-code-settings';
import type { SubagentConfig as CoreSubagentConfig } from '../config/types.js';
import type { Config } from '../config/config.js';
import type { ContextState } from '../core/subagentTypes.js';
import {
  SubagentTerminateMode,
  type OutputConfig,
  type OutputObject,
  type RunConfig,
  type ToolConfig,
} from '../core/subagentTypes.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { AsyncTaskManager } from '../services/asyncTaskManager.js';
import {
  buildContextState,
  buildExcludedToolNames,
  buildToolGovernance,
  canonicalizeToolName,
  createCancelledResult,
  createErrorResult,
  formatSuccessContent,
  formatSuccessDisplay,
  getExplicitToolNameCandidates,
  isExcludedToolName,
  isToolBlocked,
  normalizeSubagentStreamingText,
  resolveTimeoutSeconds,
  stringifySubagentOutput,
  toToolsSubagentConfig,
} from './coreSubagentServiceHelpers.js';

export interface CoreSubagentLaunchRequest {
  name: string;
  runConfig?: RunConfig;
  toolConfig?: ToolConfig;
  outputConfig?: OutputConfig;
  behaviourPrompts?: string[];
}

export interface CoreSubagentLaunchScope {
  output?: OutputObject;
  onMessage?: (message: string) => void;
  runInteractive?: (
    context: ContextState,
    options?: { schedulerFactory?: unknown },
  ) => Promise<void>;
  runNonInteractive: (context: ContextState) => Promise<void>;
}

export interface CoreSubagentLaunchResult {
  agentId: string;
  scope: CoreSubagentLaunchScope;
  dispose: () => Promise<void>;
}

export interface CoreSubagentLauncher {
  launch: (
    request: CoreSubagentLaunchRequest,
    signal?: AbortSignal,
  ) => Promise<CoreSubagentLaunchResult>;
}

interface CoreSubagentServiceAdapterOptions {
  managerProvider: () => SubagentManager | undefined;
  profileManagerProvider?: () => ProfileManager | undefined;
  config?: Config;
  orchestratorFactory?: () => CoreSubagentLauncher;
  isInteractiveEnvironment?: () => boolean;
  getSchedulerFactory?: () => unknown;
  getAsyncTaskManager?: () => AsyncTaskManager | undefined;
}

/**
 * Optional synchronous capabilities that some SubagentManager implementations
 * expose for cache-backed, non-blocking access. These are not part of the base
 * SubagentManager contract, so they are declared separately and detected with a
 * type guard before use.
 */
interface CachedSubagentManager {
  getCachedSubagentNames?: () => string[];
  getCachedSubagentConfig?: (
    subagentName: string,
  ) => CoreSubagentConfig | undefined;
  loadSubagentSync?: (subagentName: string) => CoreSubagentConfig | undefined;
}

function asCachedSubagentManager(
  manager: SubagentManager,
): CachedSubagentManager {
  return manager as SubagentManager & CachedSubagentManager;
}

export class CoreSubagentServiceAdapter implements ISubagentService {
  private readonly managerProvider: () => SubagentManager | undefined;
  private readonly profileManagerProvider?: () => ProfileManager | undefined;
  private readonly config?: Config;
  private readonly orchestratorFactory?: () => CoreSubagentLauncher;
  private readonly isInteractiveEnvironment?: () => boolean;
  private readonly getSchedulerFactory?: () => unknown;
  private readonly getAsyncTaskManager?: () => AsyncTaskManager | undefined;

  constructor(
    optionsOrManagerProvider:
      | CoreSubagentServiceAdapterOptions
      | (() => SubagentManager | undefined),
  ) {
    if (typeof optionsOrManagerProvider === 'function') {
      this.managerProvider = optionsOrManagerProvider;
      return;
    }

    this.managerProvider = optionsOrManagerProvider.managerProvider;
    this.profileManagerProvider =
      optionsOrManagerProvider.profileManagerProvider;
    this.config = optionsOrManagerProvider.config;
    this.orchestratorFactory = optionsOrManagerProvider.orchestratorFactory;
    this.isInteractiveEnvironment =
      optionsOrManagerProvider.isInteractiveEnvironment;
    this.getSchedulerFactory = optionsOrManagerProvider.getSchedulerFactory;
    this.getAsyncTaskManager = optionsOrManagerProvider.getAsyncTaskManager;
  }

  async executeSubagent(
    request: SubagentRequest,
    options: SubagentExecutionOptions = {},
  ): Promise<SubagentResult> {
    if (request.async === true) {
      return this.executeAsyncSubagent(request, options);
    }

    try {
      const { orchestrator, config } = this.createExecutionServices();
      const { timeoutMs, timeoutSeconds, timeoutController, timeoutId } =
        this.createTimeout(request, options.signal);

      const launchResult = await orchestrator.launch(
        this.buildLaunchRequest(request, timeoutMs),
        timeoutController.signal,
      );

      try {
        return await this.runSubagentWithTimeout(
          request,
          launchResult,
          config,
          timeoutController,
          timeoutSeconds,
          options,
        );
      } finally {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        await launchResult.dispose();
      }
    } catch (error) {
      return this.createExecutionErrorResult(
        error,
        options.signal,
        request.name,
      );
    }
  }

  private async runSubagentWithTimeout(
    request: SubagentRequest,
    launchResult: CoreSubagentLaunchResult,
    config: Config,
    timeoutController: AbortController,
    timeoutSeconds: number | undefined,
    options: SubagentExecutionOptions,
  ): Promise<SubagentResult> {
    try {
      const output = await this.runScope(
        request,
        launchResult,
        config,
        options.updateOutput,
      );

      if (timeoutController.signal.aborted) {
        return this.resolveAbortedResult(
          options.signal,
          timeoutSeconds,
          output,
          launchResult,
        );
      }

      return this.formatOutputResult(
        request.name,
        launchResult.agentId,
        output,
      );
    } catch (error) {
      return this.resolveCaughtError(
        error,
        options.signal,
        timeoutController,
        timeoutSeconds,
        launchResult,
      );
    }
  }

  private resolveAbortedResult(
    parentSignal: AbortSignal | undefined,
    timeoutSeconds: number | undefined,
    output: OutputObject,
    launchResult: CoreSubagentLaunchResult,
  ): SubagentResult {
    if (parentSignal?.aborted === true) {
      return createCancelledResult(
        'Task execution aborted before completion.',
        launchResult.agentId,
        output,
      );
    }
    return this.createTimeoutResult(
      timeoutSeconds,
      output,
      launchResult.agentId,
    );
  }

  private resolveCaughtError(
    error: unknown,
    parentSignal: AbortSignal | undefined,
    timeoutController: AbortController,
    timeoutSeconds: number | undefined,
    launchResult: CoreSubagentLaunchResult,
  ): SubagentResult {
    if (this.isAbortError(error)) {
      if (parentSignal?.aborted === true) {
        return createCancelledResult(
          'Task execution aborted before completion.',
          launchResult.agentId,
          launchResult.scope.output,
        );
      }
      if (timeoutController.signal.aborted) {
        return this.createTimeoutResult(
          timeoutSeconds,
          launchResult.scope.output,
          launchResult.agentId,
        );
      }
    }

    return createErrorResult(
      error,
      'Subagent execution failed.',
      launchResult.agentId,
    );
  }

  async listSubagents(): Promise<SubagentInfo[]> {
    const manager = this.requireManager();
    const cachedManager = asCachedSubagentManager(manager);

    const cachedNames = cachedManager.getCachedSubagentNames?.();
    if (cachedNames) {
      return cachedNames.map((name) => ({ name }));
    }

    const names = await manager.listSubagents();
    return names.map((name) => ({ name }));
  }

  async getSubagentConfig(
    name: string,
  ): Promise<ToolsSubagentConfig | undefined> {
    const manager = this.requireManager();
    const cachedManager = asCachedSubagentManager(manager);

    const cachedConfig =
      cachedManager.getCachedSubagentConfig?.(name) ??
      cachedManager.loadSubagentSync?.(name);

    if (cachedConfig) {
      return toToolsSubagentConfig(cachedConfig);
    }

    const loaded = await manager.loadSubagent(name);
    return toToolsSubagentConfig(loaded);
  }

  private createExecutionServices(): {
    orchestrator: CoreSubagentLauncher;
    config: Config;
  } {
    this.requireManager();
    const profileManager = this.profileManagerProvider?.();
    if (!profileManager || !this.config) {
      throw new Error(
        'Subagent execution requires profile manager and config services.',
      );
    }

    const orchestrator = this.orchestratorFactory?.();
    if (!orchestrator) {
      throw new Error('Subagent execution requires an orchestrator factory.');
    }

    return {
      orchestrator,
      config: this.config,
    };
  }

  private requireConfig(): Config {
    if (this.config === undefined) {
      throw new Error('Subagent execution requires config services.');
    }
    return this.config;
  }

  private buildLaunchRequest(
    request: SubagentRequest,
    timeoutMs?: number,
  ): CoreSubagentLaunchRequest {
    const launchRequest: CoreSubagentLaunchRequest = { name: request.name };

    if (timeoutMs !== undefined) {
      launchRequest.runConfig = { max_time_minutes: timeoutMs / 60_000 };
    }

    const behaviourPrompts =
      request.behaviourPrompts ?? request.behaviorPrompts;
    if (behaviourPrompts !== undefined && behaviourPrompts.length > 0) {
      launchRequest.behaviourPrompts = behaviourPrompts;
    }

    const config = this.requireConfig();
    const effectiveWhitelist = this.buildEffectiveToolWhitelist(
      request,
      config,
    );
    if (effectiveWhitelist !== undefined && effectiveWhitelist.length > 0) {
      launchRequest.toolConfig = { tools: effectiveWhitelist };
    } else if (this.hasExplicitWhitelist(request)) {
      // Explicit empty or fully-filtered-to-zero whitelist must remain fail-closed.
      // toolConfig: { tools: [] } tells the runtime to expose no normal tools.
      // Omitting toolConfig entirely (the else case) means runtime/profile defaults.
      launchRequest.toolConfig = { tools: [] };
    }

    if (request.outputSpec && Object.keys(request.outputSpec).length > 0) {
      launchRequest.outputConfig = {
        outputs: Object.fromEntries(
          Object.entries(request.outputSpec).map(([key, value]) => [
            key,
            String(value),
          ]),
        ),
      };
    }

    return launchRequest;
  }

  /**
   * Centralized explicit-whitelist detection (Issue #2069).
   *
   * The Task tool always sets hasExplicitToolWhitelist based on whether an
   * array was passed, but ISubagentService.executeSubagent is a public
   * interface and direct callers may pass toolWhitelist without the flag.
   * Treat an Array toolWhitelist as explicit regardless of the flag so that
   * empty/fully-filtered whitelists fail closed to { tools: [] }.
   */
  private hasExplicitWhitelist(request: SubagentRequest): boolean {
    return (
      request.hasExplicitToolWhitelist === true ||
      Array.isArray(request.toolWhitelist)
    );
  }

  private buildEffectiveToolWhitelist(
    request: SubagentRequest,
    config: Config,
  ): string[] | undefined {
    // Issue #2069: no explicit whitelist must preserve omitted toolConfig so
    // the subagent runtime/profile default tools apply. Do NOT synthesize a
    // whitelist from the parent registry regardless of registry availability.
    // Explicitness is inferred from Array.isArray(request.toolWhitelist) so
    // direct ISubagentService callers (which may omit hasExplicitToolWhitelist)
    // are treated consistently with the Task tool.
    if (!this.hasExplicitWhitelist(request)) {
      return undefined;
    }

    const registryProvider = (
      config as Partial<Pick<Config, 'getToolRegistry'>>
    ).getToolRegistry;
    const registry =
      typeof registryProvider === 'function'
        ? registryProvider.call(config)
        : undefined;

    let effectiveWhitelist = request.toolWhitelist;
    if (
      registry !== undefined &&
      effectiveWhitelist !== undefined &&
      effectiveWhitelist.length > 0
    ) {
      effectiveWhitelist = this.buildGovernedToolWhitelist(
        effectiveWhitelist,
        registry,
        config,
      );
    } else {
      // No registry available: still filter excluded tools (task/list_subagents)
      // so they can never be exposed to a subagent runtime. Non-excluded entries
      // pass through unchanged (no registry validation possible).
      effectiveWhitelist = this.filterExcludedFromWhitelist(effectiveWhitelist);
    }

    return effectiveWhitelist;
  }

  /**
   * Filters excluded tools (task/list_subagents) from a whitelist when no
   * registry is available to perform full governance validation. Non-excluded
   * entries pass through unchanged. Returns undefined if the result is empty
   * so the caller can apply fail-closed semantics for explicit whitelists.
   */
  private filterExcludedFromWhitelist(
    candidateTools: string[] | undefined,
  ): string[] | undefined {
    if (!candidateTools || candidateTools.length === 0) {
      return undefined;
    }

    const excluded = buildExcludedToolNames();
    const filtered = candidateTools.filter((name) => {
      if (typeof name !== 'string') {
        return false;
      }

      const candidates = getExplicitToolNameCandidates(name);
      return (
        candidates.length > 0 &&
        !candidates.some((canonical) => excluded.has(canonical))
      );
    });

    return filtered.length > 0 ? filtered : undefined;
  }

  private buildGovernedToolWhitelist(
    candidateTools: string[] | undefined,
    registry: ToolRegistry,
    config: Config,
  ): string[] | undefined {
    if (!candidateTools || candidateTools.length === 0) {
      return undefined;
    }

    const excluded = buildExcludedToolNames();
    const governance = buildToolGovernance(config);
    const allowedRegistryTools = registry
      .getEnabledTools()
      .map((tool) => tool.name)
      .filter(
        (name): name is string => !!name && !isExcludedToolName(name, excluded),
      );

    const allowedByCanonical = new Map<string, string>();
    for (const toolName of allowedRegistryTools) {
      for (const canonical of getExplicitToolNameCandidates(toolName)) {
        if (canonical && !allowedByCanonical.has(canonical)) {
          allowedByCanonical.set(canonical, toolName);
        }
      }
    }

    const validTools = candidateTools
      .map((name) => {
        if (!name) {
          return undefined;
        }

        const candidates = getExplicitToolNameCandidates(name);
        if (candidates.some((canonical) => excluded.has(canonical))) {
          return undefined;
        }
        if (
          candidates.some((canonical) => governance.disabled.has(canonical))
        ) {
          return undefined;
        }

        for (const canonical of candidates) {
          const resolved = allowedByCanonical.get(canonical);
          if (resolved && !isToolBlocked(resolved, governance)) {
            return resolved;
          }
        }

        return undefined;
      })
      .filter(
        (name): name is string => typeof name === 'string' && name.length > 0,
      );

    const uniqueByCanonical = new Set<string>();
    const deduped: string[] = [];
    for (const tool of validTools) {
      const canonical = canonicalizeToolName(tool);
      if (!canonical || uniqueByCanonical.has(canonical)) {
        continue;
      }
      uniqueByCanonical.add(canonical);
      deduped.push(tool);
    }

    return deduped.length > 0 ? deduped : undefined;
  }

  private createTimeout(
    request: SubagentRequest,
    parentSignal?: AbortSignal,
  ): {
    timeoutMs?: number;
    timeoutSeconds?: number;
    timeoutController: AbortController;
    timeoutId: ReturnType<typeof setTimeout> | null;
  } {
    const settings = this.requireConfig().getEphemeralSettings();
    const defaultTimeoutSeconds =
      (settings['task-default-timeout-seconds'] as number | undefined) ?? 900;
    const maxTimeoutSeconds =
      (settings['task-max-timeout-seconds'] as number | undefined) ?? 1800;
    const timeoutSeconds = resolveTimeoutSeconds(
      request.timeoutSeconds,
      defaultTimeoutSeconds,
      maxTimeoutSeconds,
    );
    const timeoutMs =
      timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000;
    const timeoutController = new AbortController();
    const timeoutId =
      timeoutMs === undefined
        ? null
        : setTimeout(() => timeoutController.abort(), timeoutMs);

    if (parentSignal?.aborted === true) {
      timeoutController.abort();
    } else {
      parentSignal?.addEventListener(
        'abort',
        () => {
          timeoutController.abort();
        },
        { once: true },
      );
    }

    return { timeoutMs, timeoutSeconds, timeoutController, timeoutId };
  }

  private async runScope(
    request: SubagentRequest,
    launchResult: CoreSubagentLaunchResult,
    config: Config,
    updateOutput?: (output: string) => void,
  ): Promise<OutputObject> {
    const { scope, agentId } = launchResult;
    const contextState = buildContextState(request, config);
    const emitClosingSubagentTag = this.setupStreaming(
      request.name,
      agentId,
      scope,
      updateOutput,
    );

    try {
      const shouldRunInteractive = this.isInteractiveEnvironment?.() ?? true;
      if (shouldRunInteractive && typeof scope.runInteractive === 'function') {
        await scope.runInteractive(contextState, {
          schedulerFactory: this.getSchedulerFactory?.() as never,
        });
      } else {
        await scope.runNonInteractive(contextState);
      }
    } finally {
      emitClosingSubagentTag();
    }

    return (
      scope.output ?? {
        terminate_reason: SubagentTerminateMode.ERROR,
        emitted_vars: {},
      }
    );
  }

  private setupStreaming(
    subagentName: string,
    agentId: string,
    scope: CoreSubagentLaunchResult['scope'],
    updateOutput?: (output: string) => void,
  ): () => void {
    if (!updateOutput) {
      return () => undefined;
    }

    updateOutput(`<subagent name="${subagentName}" id="${agentId}">\n`);
    const existingHandler = scope.onMessage;
    scope.onMessage = (message: string) => {
      const cleaned = normalizeSubagentStreamingText(message);
      if (cleaned.trim().length > 0) {
        updateOutput(cleaned);
      }
      existingHandler?.(message);
    };
    let xmlOutputOpen = true;

    return () => {
      if (!xmlOutputOpen) {
        return;
      }
      updateOutput(`</subagent name="${subagentName}" id="${agentId}">\n`);
      xmlOutputOpen = false;
    };
  }

  private formatOutputResult(
    subagentName: string,
    agentId: string,
    output: OutputObject,
  ): SubagentResult {
    const success = output.terminate_reason !== SubagentTerminateMode.ERROR;
    return {
      output: stringifySubagentOutput(output),
      success,
      agentId,
      terminateReason: output.terminate_reason,
      emittedVars: output.emitted_vars,
      llmContent: formatSuccessContent(agentId, output),
      returnDisplay: formatSuccessDisplay(subagentName, agentId, output),
      metadata: {
        agentId,
        terminateReason: output.terminate_reason,
        emittedVars: output.emitted_vars,
        ...(output.final_message ? { finalMessage: output.final_message } : {}),
      },
      ...(success
        ? {}
        : { error: output.final_message ?? 'Subagent execution failed.' }),
    };
  }

  private createTimeoutResult(
    timeoutSeconds: number | undefined,
    output?: OutputObject,
    agentId?: string,
  ): SubagentResult {
    const message = `Task timed out after ${timeoutSeconds ?? 900}s (timeout_seconds).`;
    return {
      output: message,
      success: false,
      error: message,
      llmContent: message,
      returnDisplay: message,
      metadata: {
        agentId,
        terminateReason: output?.terminate_reason,
        emittedVars: output?.emitted_vars ?? {},
        ...(output?.final_message
          ? { finalMessage: output.final_message }
          : {}),
        timedOut: true,
      },
      errorType: ToolErrorType.TIMEOUT,
    };
  }

  private createExecutionErrorResult(
    error: unknown,
    signal?: AbortSignal,
    subagentName?: string,
  ): SubagentResult {
    const aborted = signal?.aborted === true || this.isAbortError(error);
    if (aborted) {
      return createCancelledResult('Task execution aborted before completion.');
    }

    return createErrorResult(
      error,
      subagentName
        ? `Unable to launch subagent '${subagentName}'.`
        : 'Subagent execution failed.',
    );
  }

  private isAbortError(error: unknown): boolean {
    return (
      error !== null &&
      error !== undefined &&
      typeof error === 'object' &&
      (error as { name?: string }).name === 'AbortError'
    );
  }

  private async executeAsyncSubagent(
    request: SubagentRequest,
    options: SubagentExecutionOptions,
  ): Promise<SubagentResult> {
    const settingsCheck = this.checkAsyncSettings();
    if (settingsCheck) {
      return settingsCheck;
    }

    const asyncTaskManager = this.getAsyncTaskManager?.();
    if (asyncTaskManager === undefined) {
      return {
        output: 'Async mode requires AsyncTaskManager to be configured.',
        success: false,
        error: 'AsyncTaskManager not configured',
        llmContent: 'Async mode requires AsyncTaskManager to be configured.',
        returnDisplay: 'Error: Async mode not available.',
        errorType: ToolErrorType.EXECUTION_FAILED,
      };
    }

    const bookingId = asyncTaskManager.tryReserveAsyncSlot();
    if (!bookingId) {
      const canLaunch = asyncTaskManager.canLaunchAsync();
      const baseReason = canLaunch.reason ?? 'Async task limit reached';
      const guidance =
        'You can: (1) wait for running async tasks to complete using check_async_tasks, ' +
        '(2) launch this subagent synchronously (without async: true), or ' +
        '(3) try again later when a slot is available.';
      return {
        output: `${baseReason}. ${guidance}`,
        success: false,
        error: baseReason,
        llmContent: `${baseReason}. ${guidance}`,
        returnDisplay: baseReason,
        errorType: ToolErrorType.EXECUTION_FAILED,
      };
    }

    try {
      const { orchestrator, config } = this.createExecutionServices();
      const { timeoutController, timeoutId } = this.createTimeout(request);
      const launchResult = await orchestrator.launch(
        this.buildLaunchRequest(request),
        undefined,
      );
      const { agentId } = launchResult;
      asyncTaskManager.registerTask(
        {
          id: agentId,
          subagentName: request.name,
          goalPrompt: request.prompt,
          abortController: timeoutController,
        },
        bookingId,
      );

      this.executeInBackground(
        request,
        launchResult,
        config,
        asyncTaskManager,
        timeoutController,
        timeoutId,
        options.updateOutput,
      );

      const message =
        `Async task launched: subagent '${request.name}' (ID: ${agentId}). ` +
        `Task is running in background. Use 'check_async_tasks' to monitor progress.`;
      return {
        output: message,
        success: true,
        agentId,
        llmContent: message,
        returnDisplay: `Async task started: **${request.name}** (\`${agentId}\`)`,
        metadata: { agentId, async: true, status: 'running' },
      };
    } catch (error) {
      asyncTaskManager.cancelReservation(bookingId);
      return this.createExecutionErrorResult(error, options.signal);
    }
  }

  private checkAsyncSettings(): SubagentResult | undefined {
    const settingsService = this.requireConfig().getSettingsService();
    const globalSettings = settingsService.getAllGlobalSettings();
    const subagentsSettings = globalSettings['subagents'] as
      | { asyncEnabled?: boolean }
      | undefined;
    if (subagentsSettings?.asyncEnabled === false) {
      return {
        output:
          'Async subagents are globally disabled via /settings. Enable "Async Subagents Enabled" in /settings to use async mode.',
        success: false,
        error: 'Async subagents are globally disabled via /settings.',
        llmContent:
          'Async subagents are globally disabled via /settings. Enable "Async Subagents Enabled" in /settings to use async mode.',
        returnDisplay: 'Error: Async subagents are globally disabled.',
        errorType: ToolErrorType.EXECUTION_FAILED,
      };
    }

    const ephemeralSettings = this.requireConfig().getEphemeralSettings();
    if (ephemeralSettings['subagents.async.enabled'] === false) {
      return {
        output:
          'This profile disables async subagents. Re-enable with: /set subagents.async.enabled true',
        success: false,
        error: 'Async subagents disabled in active profile.',
        llmContent:
          'This profile disables async subagents. Re-enable with: /set subagents.async.enabled true',
        returnDisplay: 'Error: Async subagents disabled in profile.',
        errorType: ToolErrorType.EXECUTION_FAILED,
      };
    }

    return undefined;
  }

  private executeInBackground(
    request: SubagentRequest,
    launchResult: CoreSubagentLaunchResult,
    config: Config,
    asyncTaskManager: AsyncTaskManager,
    timeoutController: AbortController,
    timeoutId: ReturnType<typeof setTimeout> | null,
    updateOutput?: (output: string) => void,
  ): void {
    void (async () => {
      try {
        const output = await this.runScope(
          request,
          launchResult,
          config,
          updateOutput,
        );
        if (timeoutController.signal.aborted) {
          const task = asyncTaskManager.getTask(launchResult.agentId);
          if (task?.status === 'running') {
            asyncTaskManager.failTask(
              launchResult.agentId,
              'Async task timed out',
            );
          }
          return;
        }
        asyncTaskManager.completeTask(launchResult.agentId, output);
      } catch (error) {
        asyncTaskManager.failTask(
          launchResult.agentId,
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        try {
          await launchResult.dispose();
        } catch {
          // Preserve background failure state; disposal errors are non-actionable here.
        }
      }
    })();
  }

  private requireManager(): SubagentManager {
    const manager = this.managerProvider();
    if (!manager) {
      throw new Error(
        'SubagentManager service is unavailable. Please configure subagents before invoking this tool.',
      );
    }
    return manager;
  }
}
