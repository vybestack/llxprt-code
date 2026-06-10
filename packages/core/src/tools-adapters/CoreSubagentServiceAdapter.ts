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
import {
  SubagentOrchestrator,
  type SubagentLaunchRequest,
  type SubagentLaunchResult,
} from '../core/subagentOrchestrator.js';
import {
  SubagentTerminateMode,
  type OutputObject,
} from '../core/subagentTypes.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { AsyncTaskManager } from '../services/asyncTaskManager.js';
import {
  buildToolGovernance,
  canonicalizeToolName,
  isToolBlocked,
} from '../core/toolGovernance.js';
import {
  buildContextState,
  buildExcludedToolNames,
  createCancelledResult,
  createErrorResult,
  formatSuccessContent,
  formatSuccessDisplay,
  isExcludedToolName,
  normalizeSubagentStreamingText,
  resolveTimeoutSeconds,
  stringifySubagentOutput,
  toToolsSubagentConfig,
} from './coreSubagentServiceHelpers.js';

interface CoreSubagentServiceAdapterOptions {
  managerProvider: () => SubagentManager | undefined;
  profileManagerProvider?: () => ProfileManager | undefined;
  config?: Config;
  orchestratorFactory?: () => SubagentOrchestrator;
  isInteractiveEnvironment?: () => boolean;
  getSchedulerFactory?: () => unknown;
  getAsyncTaskManager?: () => AsyncTaskManager | undefined;
}

export class CoreSubagentServiceAdapter implements ISubagentService {
  private readonly managerProvider: () => SubagentManager | undefined;
  private readonly profileManagerProvider?: () => ProfileManager | undefined;
  private readonly config?: Config;
  private readonly orchestratorFactory?: () => SubagentOrchestrator;
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
        const output = await this.runScope(
          request,
          launchResult,
          config,
          options.updateOutput,
        );

        if (timeoutController.signal.aborted) {
          if (options.signal?.aborted === true) {
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

        return this.formatOutputResult(
          request.name,
          launchResult.agentId,
          output,
        );
      } catch (error) {
        if (this.isAbortError(error)) {
          if (options.signal?.aborted === true) {
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

  listSubagents(): SubagentInfo[] {
    const manager = this.requireManager();
    const cachedManager = manager as unknown as {
      getCachedSubagentNames?: () => string[];
    };

    const names = cachedManager.getCachedSubagentNames?.();
    if (names) {
      return names.map((name) => ({ name }));
    }

    const listResult = manager.listSubagents();
    if (Array.isArray(listResult)) {
      return listResult.map((name) => ({ name }));
    }

    throw new Error('Subagent list is not available synchronously.');
  }

  getSubagentConfig(name: string): ToolsSubagentConfig | undefined {
    const manager = this.requireManager();
    const cachedManager = manager as unknown as {
      getCachedSubagentConfig?: (
        subagentName: string,
      ) => CoreSubagentConfig | undefined;
      loadSubagentSync?: (
        subagentName: string,
      ) => CoreSubagentConfig | undefined;
    };

    const config =
      cachedManager.getCachedSubagentConfig?.(name) ??
      cachedManager.loadSubagentSync?.(name);

    if (config) {
      return toToolsSubagentConfig(config);
    }

    const maybeConfig = manager.loadSubagent(name);
    if (
      maybeConfig &&
      typeof maybeConfig === 'object' &&
      'then' in maybeConfig
    ) {
      throw new Error(`Subagent '${name}' is not available synchronously.`);
    }

    return maybeConfig
      ? toToolsSubagentConfig(maybeConfig as CoreSubagentConfig)
      : undefined;
  }

  private createExecutionServices(): {
    orchestrator: SubagentOrchestrator;
    config: Config;
  } {
    const subagentManager = this.requireManager();
    const profileManager = this.profileManagerProvider?.();
    if (!profileManager || !this.config) {
      throw new Error(
        'Subagent execution requires profile manager and config services.',
      );
    }

    return {
      orchestrator:
        this.orchestratorFactory?.() ??
        new SubagentOrchestrator({
          subagentManager,
          profileManager,
          foregroundConfig: this.config,
        }),
      config: this.config,
    };
  }

  private buildLaunchRequest(
    request: SubagentRequest,
    timeoutMs?: number,
  ): SubagentLaunchRequest {
    const launchRequest: SubagentLaunchRequest = { name: request.name };

    if (timeoutMs !== undefined) {
      launchRequest.runConfig = { max_time_minutes: timeoutMs / 60_000 };
    }

    const behaviourPrompts =
      request.behaviourPrompts ?? request.behaviorPrompts;
    if (behaviourPrompts?.length) {
      launchRequest.behaviourPrompts = behaviourPrompts;
    }

    const effectiveWhitelist = this.buildEffectiveToolWhitelist(request);
    if (effectiveWhitelist !== undefined && effectiveWhitelist.length > 0) {
      launchRequest.toolConfig = { tools: effectiveWhitelist };
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

  private buildEffectiveToolWhitelist(
    request: SubagentRequest,
  ): string[] | undefined {
    const registry = this.config?.getToolRegistry?.() as
      | ToolRegistry
      | undefined;
    if (registry === undefined) {
      return request.toolWhitelist;
    }

    let effectiveWhitelist = request.toolWhitelist;
    if (effectiveWhitelist && effectiveWhitelist.length > 0) {
      effectiveWhitelist = this.buildGovernedToolWhitelist(
        effectiveWhitelist,
        registry,
      );
    }

    if (
      !request.hasExplicitToolWhitelist &&
      (!effectiveWhitelist || effectiveWhitelist.length === 0)
    ) {
      effectiveWhitelist = this.buildGovernedToolWhitelist(
        registry.getEnabledTools().map((tool) => tool.name),
        registry,
      );
    }

    return effectiveWhitelist;
  }

  private buildGovernedToolWhitelist(
    candidateTools: string[] | undefined,
    registry: ToolRegistry,
  ): string[] | undefined {
    if (!candidateTools || candidateTools.length === 0) {
      return undefined;
    }

    const excluded = buildExcludedToolNames();
    const governance = this.config
      ? buildToolGovernance(this.config)
      : buildToolGovernance({});
    const allowedRegistryTools = registry
      .getEnabledTools()
      .map((tool) => tool.name)
      .filter(
        (name): name is string => !!name && !isExcludedToolName(name, excluded),
      );

    const allowedByCanonical = new Map<string, string>();
    for (const toolName of allowedRegistryTools) {
      const canonical = canonicalizeToolName(toolName);
      if (canonical && !allowedByCanonical.has(canonical)) {
        allowedByCanonical.set(canonical, toolName);
      }
    }

    const validTools = candidateTools
      .map((name) => {
        if (!name || isExcludedToolName(name, excluded)) {
          return undefined;
        }

        const canonical = canonicalizeToolName(name);
        if (!canonical || isToolBlocked(canonical, governance)) {
          return undefined;
        }

        return allowedByCanonical.get(canonical);
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
    const settings = this.config?.getEphemeralSettings?.() ?? {};
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
    launchResult: SubagentLaunchResult,
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
    scope: SubagentLaunchResult['scope'],
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
        emittedVars: output.emitted_vars ?? {},
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
    const settingsService = this.config?.getSettingsService?.();
    const globalSettings = settingsService?.getAllGlobalSettings?.() ?? {};
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

    const ephemeralSettings = this.config?.getEphemeralSettings?.() ?? {};
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
    launchResult: SubagentLaunchResult,
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
