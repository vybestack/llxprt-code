/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ToolErrorType,
  createStreamNormalizer,
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
import type { AsyncTaskManager } from '../services/asyncTaskManager.js';
import {
  buildContextState,
  buildEffectiveToolWhitelist,
  hasExplicitToolWhitelist,
  createCancelledResult,
  createErrorResult,
  DEFAULT_TASK_TIMEOUT_SECONDS,
  formatSuccessContent,
  formatSuccessDisplay,
  attachTimeoutMetadataToResult,
  createTimeoutSubagentResult,
  MAX_TASK_TIMEOUT_SECONDS,
  resolveTimeoutResolution,
  stringifySubagentOutput,
  TASK_TIMEOUT_DEFAULT_SETTING,
  TASK_TIMEOUT_MAX_SETTING,
  toToolsSubagentConfig,
  createAsyncNotConfiguredResult,
  createSlotFullResult,
  handleAsyncLaunchFailure,
  type TimeoutResolution,
  type CoreTimeoutSetup,
  failTaskIfTimeout,
  isTimeoutAbort,
  readConfiguredTimeoutSeconds,
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

    let timeout: CoreTimeoutSetup | undefined;
    try {
      const { orchestrator, config } = this.createExecutionServices();
      timeout = this.createTimeout(request, options.signal);

      const launchResult = await orchestrator.launch(
        this.buildLaunchRequest(request, timeout.timeoutMs),
        timeout.timeoutController.signal,
      );

      try {
        const result = await this.runSubagentWithTimeout(
          request,
          launchResult,
          config,
          timeout,
          options,
        );
        return attachTimeoutMetadataToResult(result, timeout.resolution);
      } finally {
        if (timeout.timeoutId !== null) {
          clearTimeout(timeout.timeoutId);
        }
        await launchResult.dispose();
      }
    } catch (error) {
      // A timeout-controller abort that reaches this catch (e.g. during
      // orchestrator.launch) is a TIMEOUT only when the timer fired — NOT when
      // the parent (user) signal aborted, because createTimeout relays a
      // parent abort onto the timeout controller. isTimeoutAbort makes that
      // distinction and also rules out an unbounded resolution (which arms no
      // timer), preventing describeTaskTimeout from throwing (Finding 1).
      if (
        timeout !== undefined &&
        isTimeoutAbort(
          timeout.timeoutController,
          options.signal,
          timeout.resolution,
        )
      ) {
        return attachTimeoutMetadataToResult(
          createTimeoutSubagentResult(timeout.resolution),
          timeout.resolution,
        );
      }
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
    timeout: CoreTimeoutSetup,
    options: SubagentExecutionOptions,
  ): Promise<SubagentResult> {
    try {
      const output = await this.runScope(
        request,
        launchResult,
        config,
        options.updateOutput,
      );

      if (timeout.timeoutController.signal.aborted) {
        return this.resolveAbortedResult(
          options.signal,
          timeout.resolution,
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
        timeout,
        launchResult,
      );
    }
  }

  private resolveAbortedResult(
    parentSignal: AbortSignal | undefined,
    resolution: TimeoutResolution,
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
    return createTimeoutSubagentResult(
      resolution,
      output,
      launchResult.agentId,
    );
  }

  private resolveCaughtError(
    error: unknown,
    parentSignal: AbortSignal | undefined,
    timeout: CoreTimeoutSetup,
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
      if (timeout.timeoutController.signal.aborted) {
        return createTimeoutSubagentResult(
          timeout.resolution,
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
    const effectiveWhitelist = buildEffectiveToolWhitelist(request, config);
    if (effectiveWhitelist !== undefined && effectiveWhitelist.length > 0) {
      launchRequest.toolConfig = { tools: effectiveWhitelist };
    } else if (hasExplicitToolWhitelist(request)) {
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

  private createTimeout(
    request: SubagentRequest,
    parentSignal?: AbortSignal,
  ): CoreTimeoutSetup {
    const settings = this.requireConfig().getEphemeralSettings();
    // Configured default/maximum are validated at the resolution boundary so a
    // bad profile value (0, -2, Infinity, non-numeric) is rejected here rather
    // than flowing unchecked to setTimeout (Finding 2).
    const defaultTimeoutSeconds = readConfiguredTimeoutSeconds(
      settings,
      TASK_TIMEOUT_DEFAULT_SETTING,
      DEFAULT_TASK_TIMEOUT_SECONDS,
    );
    const maxTimeoutSeconds = readConfiguredTimeoutSeconds(
      settings,
      TASK_TIMEOUT_MAX_SETTING,
      MAX_TASK_TIMEOUT_SECONDS,
    );
    const resolution = resolveTimeoutResolution(
      request.timeoutSeconds,
      defaultTimeoutSeconds,
      maxTimeoutSeconds,
    );
    const timeoutMs =
      resolution.effectiveTimeoutSeconds === undefined
        ? undefined
        : resolution.effectiveTimeoutSeconds * 1000;
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

    return {
      timeoutMs,
      resolution,
      timeoutController,
      timeoutId,
    };
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

    const normalizer = createStreamNormalizer();
    updateOutput(`<subagent name="${subagentName}" id="${agentId}">\n`);
    const existingHandler = scope.onMessage;
    scope.onMessage = (message: string) => {
      const delta = normalizer.push(message);
      if (delta !== undefined) {
        updateOutput(delta);
      }
      existingHandler?.(message);
    };
    let xmlOutputOpen = true;

    return () => {
      if (!xmlOutputOpen) {
        return;
      }
      const flushed = normalizer.flush();
      if (flushed !== undefined) {
        updateOutput(flushed);
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
      return createAsyncNotConfiguredResult();
    }

    const bookingId = asyncTaskManager.tryReserveAsyncSlot();
    if (!bookingId) {
      return createSlotFullResult(asyncTaskManager);
    }

    let timeout: CoreTimeoutSetup | undefined;
    let launchResult: CoreSubagentLaunchResult | undefined;
    try {
      const { orchestrator, config } = this.createExecutionServices();
      timeout = this.createTimeout(request, options.signal);
      launchResult = await orchestrator.launch(
        this.buildLaunchRequest(request, timeout.timeoutMs),
        timeout.timeoutController.signal,
      );
      return this.registerAndLaunchAsync(
        request,
        launchResult,
        config,
        asyncTaskManager,
        timeout,
        bookingId,
        options,
      );
    } catch (error) {
      return handleAsyncLaunchFailure(
        error,
        timeout,
        launchResult,
        bookingId,
        asyncTaskManager,
        options.signal,
      );
    }
  }

  private registerAndLaunchAsync(
    request: SubagentRequest,
    launchResult: CoreSubagentLaunchResult,
    config: Config,
    asyncTaskManager: AsyncTaskManager,
    timeout: CoreTimeoutSetup,
    bookingId: string,
    options: SubagentExecutionOptions,
  ): SubagentResult {
    const { agentId } = launchResult;
    asyncTaskManager.registerTask(
      {
        id: agentId,
        subagentName: request.name,
        goalPrompt: request.prompt,
        abortController: timeout.timeoutController,
      },
      bookingId,
    );

    this.executeInBackground(
      request,
      launchResult,
      config,
      asyncTaskManager,
      timeout,
      options.updateOutput,
      options.signal,
    );

    const message =
      `Async task launched: subagent '${request.name}' (ID: ${agentId}). ` +
      `Task is running in background. Use 'check_async_tasks' to monitor progress.`;
    return attachTimeoutMetadataToResult(
      {
        output: message,
        success: true,
        agentId,
        llmContent: message,
        returnDisplay: `Async task started: **${request.name}** (\`${agentId}\`)`,
        metadata: { agentId, async: true, status: 'running' },
      },
      timeout.resolution,
    );
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
    timeout: CoreTimeoutSetup,
    updateOutput?: (output: string) => void,
    parentSignal?: AbortSignal,
  ): void {
    void (async () => {
      try {
        const output = await this.runScope(
          request,
          launchResult,
          config,
          updateOutput,
        );
        if (
          isTimeoutAbort(
            timeout.timeoutController,
            parentSignal,
            timeout.resolution,
          )
        ) {
          failTaskIfTimeout(
            asyncTaskManager,
            launchResult.agentId,
            timeout.resolution,
          );
          return;
        }
        // The controller aborted but it was a parent (user) cancellation, not
        // a timeout: cancel the task so it does not sit in 'running' forever.
        // This is especially important under an unbounded resolution, where
        // failTaskIfTimeout would throw (Finding 1).
        if (timeout.timeoutController.signal.aborted) {
          asyncTaskManager.cancelTask(launchResult.agentId);
          return;
        }
        asyncTaskManager.completeTask(launchResult.agentId, output);
      } catch (error) {
        if (
          isTimeoutAbort(
            timeout.timeoutController,
            parentSignal,
            timeout.resolution,
          )
        ) {
          failTaskIfTimeout(
            asyncTaskManager,
            launchResult.agentId,
            timeout.resolution,
          );
          return;
        }
        if (timeout.timeoutController.signal.aborted) {
          asyncTaskManager.cancelTask(launchResult.agentId);
          return;
        }
        asyncTaskManager.failTask(
          launchResult.agentId,
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        if (timeout.timeoutId !== null) {
          clearTimeout(timeout.timeoutId);
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
