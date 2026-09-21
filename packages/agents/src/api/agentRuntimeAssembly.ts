/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:ISSUE-3222
 * @requirement:REQ-3222-AC2
 *
 * Agent-owned runtime assembly. The public Agent API (createAgent/fromConfig)
 * builds complete shipped runtimes itself: the three agent runtime factories
 * (agent client, tool scheduler, task-tool registration), the runtime
 * managers, and the isolated-runtime Config for subagent runtimes. Defaults
 * are installed per-field ONLY where the Config reports absence — caller
 * supplied factories and managers always win. Nothing here registers into
 * module-global state.
 */

import * as path from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import { ProfileManager, Storage } from '@vybestack/llxprt-code-settings';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IsolatedRuntimeContextHandle } from '@vybestack/llxprt-code-providers/runtime.js';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
import { buildAgentClientFactory } from './agentBootstrap.js';
import { createTaskRegistration } from './runtimeFactories.js';
import type { Agent } from './agent.js';

const DEFAULT_MODEL = 'gemini-1.5-flash';
const DEFAULT_DEBUG_MODE = false;

/**
 * Installs the agent-owned factory defaults onto a Config, per field, only
 * when the Config reports that field absent. Caller-supplied factories
 * always win. Callers that construct their own Config with richer factories
 * (e.g. createAgent's confirmation-forcing scheduler) are never overridden.
 * Each default is constructed lazily inside its own absence guard so a Config
 * that already carries all three factories builds no unused replacements.
 */
export function ensureAgentRuntimeFactories(config: Config): void {
  if (config.getToolSchedulerFactory() === undefined) {
    config.setToolSchedulerFactory((options) => new CoreToolScheduler(options));
  }
  if (config.getAgentClientFactory() === undefined) {
    config.setAgentClientFactory(buildAgentClientFactory());
  }
  if (config.getTaskToolRegistration() === undefined) {
    config.setTaskToolRegistration(createTaskRegistration());
  }
}

/**
 * Ensures the runtime managers are attached to a Config. Mirrors the exact
 * resolution the providers runtime factory performed for every isolated
 * runtime: an explicit profileManager wins, then the Config's own, then a
 * fresh ProfileManager under the global config dir; the SubagentManager
 * adopts the Config's own or is built under the global config dir. Setters
 * run only when the Config reports absence.
 */
export function ensureRuntimeManagers(
  config: Config,
  profileManager?: ProfileManager,
): void {
  const llxprtDir = Storage.getGlobalConfigDir();
  // Option-first precedence: an explicit profileManager wins over the
  // Config's own; only when both are absent does a fresh one get built.
  const resolvedProfileManager =
    profileManager ??
    config.getProfileManager() ??
    new ProfileManager(path.join(llxprtDir, 'profiles'));
  config.setProfileManager(resolvedProfileManager);
  if (config.getSubagentManager() === undefined) {
    config.setSubagentManager(
      new SubagentManager(
        path.join(llxprtDir, 'subagents'),
        resolvedProfileManager,
      ),
    );
  }
}

/** Inputs for {@link buildIsolatedAgentConfig}. */
export interface IsolatedAgentConfigInputs {
  readonly sessionId: string;
  readonly workspaceDir?: string;
  readonly model?: string;
  readonly settingsService: SettingsService;
  readonly profileManager?: ProfileManager;
}

/**
 * Builds the isolated-runtime Config for agent-owned runtimes (subagents,
 * compression, role runtimes): fresh Config with the provider-factory
 * construction defaults, then agent-owned factories and runtime managers.
 */
export function buildIsolatedAgentConfig(
  inputs: IsolatedAgentConfigInputs,
): Config {
  const workspaceDir = inputs.workspaceDir ?? process.cwd();
  const config = new Config({
    sessionId: inputs.sessionId,
    targetDir: workspaceDir,
    debugMode: DEFAULT_DEBUG_MODE,
    cwd: workspaceDir,
    model: inputs.model ?? DEFAULT_MODEL,
    settingsService: inputs.settingsService,
  });
  ensureAgentRuntimeFactories(config);
  ensureRuntimeManagers(config, inputs.profileManager);
  return config;
}

/**
 * Extra teardown context for {@link cleanupFailedRuntimeBootstrap} beyond the
 * isolated runtime handle.
 */
export interface FailedBootstrapTeardown {
  /**
   * The fully built Agent facade, when the failure happened AFTER finalize
   * (e.g. session-start). Its idempotent dispose() is the complete teardown —
   * isolated handle, agent-owned Config, hooks — and replaces piecemeal
   * cleanup.
   */
  readonly facade?: Agent;
  /**
   * The agent-owned Config to dispose when no facade exists yet. Disposed
   * AFTER the isolated handle (children before parents): initialize() started
   * MCP discovery, the extension loader, LSP and the AgentClient on it, and
   * only Config.dispose() releases those — except the LSP service, which
   * Config.dispose() does NOT stop and which cleanupFailedRuntimeBootstrap
   * shuts down explicitly after the dispose. Caller-owned Configs (fromConfig
   * adopts one) are never passed here.
   */
  readonly ownedConfig?: Config;
}

/**
 * Cleans up a failed agent bootstrap and surfaces the ORIGINAL error. When
 * cleanup also fails, every error surfaces through an AggregateError so
 * neither is swallowed.
 */
export async function cleanupFailedRuntimeBootstrap(
  handle: IsolatedRuntimeContextHandle,
  primaryError: unknown,
  source: string,
  teardown: FailedBootstrapTeardown = {},
): Promise<never> {
  const cleanupErrors: unknown[] = [];
  if (teardown.facade !== undefined) {
    try {
      await teardown.facade.dispose();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  } else {
    try {
      await handle.cleanup();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (teardown.ownedConfig !== undefined) {
      try {
        await teardown.ownedConfig.dispose();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
      // Config.dispose() does NOT shut down the LSP service initialize()
      // started (agentImpl.dispose wires that separately for agent-owned
      // Configs), so a bootstrap that failed after initialize() must release
      // it here too or it leaks past the rejection — the caller has no Agent
      // to dispose. Mirrors agentImpl's ordering: dispose first, then LSP.
      try {
        await teardown.ownedConfig.shutdownLspService();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      `${source} bootstrap failed and isolated runtime cleanup also failed`,
    );
  }
  throw primaryError;
}
