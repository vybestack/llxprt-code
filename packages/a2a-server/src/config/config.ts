/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import * as dotenv from 'dotenv';

import type { Agent, AgentConfig } from '@vybestack/llxprt-code-agents';
import { createAgent } from '@vybestack/llxprt-code-agents';
import { debugLogger } from '@vybestack/llxprt-code-core';
import {
  FileDiscoveryService,
  loadServerHierarchicalMemory,
  LLXPRT_CONFIG_DIR,
  PLACEHOLDER_MODEL,
  UNCONFIGURED_PROVIDER,
  ApprovalMode,
  type LlxprtExtension,
} from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-storage';

import type { Settings } from './settings.js';
import { type AgentSettings, CoderAgentEvent } from '../types.js';
import { logger } from '../utils/logger.js';

/**
 * Builds the A2A task Agent through the public Agent API (#3221).
 *
 * Converts the A2A env/settings/extensions host input into a declarative
 * {@link AgentConfig} and constructs the Agent via {@link createAgent}. This
 * replaces the legacy hand-wired runtime assembly (`new Config`,
 * `new MessageBus`, `config.initialize`/`refreshAuth` orchestration): A2A owns
 * interface-input parsing only, and runtime transitions belong to the Agent.
 *
 * Auth parity: the legacy env-driven `refreshAuth(<method>)` calls were already
 * method-agnostic at the core level (they rebuild the content generator from
 * current env state), and `createAgent`'s bootstrap performs that same
 * initialization, so env credentials (GEMINI_API_KEY / vertex / CCPA) are
 * picked up without host-side auth orchestration while the provider stays
 * neutral unless explicitly selected via LLXPRT_DEFAULT_PROVIDER.
 *
 * Harness flags: `forceConfirmations: false` preserves A2A's approval flow —
 * the legacy `loadConfig` path never injected confirmation forcing, and the
 * Task surfaces confirmations to the client instead of auto-confirming.
 */
export async function createTaskAgent(
  settings: Settings,
  extensions: LlxprtExtension[],
  taskId: string,
): Promise<Agent> {
  const workspaceDir = process.cwd();
  const { memoryContent, fileCount } = await loadWorkspaceMemory(
    workspaceDir,
    extensions,
  );
  const agentConfig: AgentConfig = {
    provider: resolveProviderFromEnv(),
    model: PLACEHOLDER_MODEL,
    sessionId: taskId,
    workingDir: workspaceDir,
    debugMode: process.env['DEBUG'] === 'true',
    coreTools: settings.coreTools,
    excludeTools: settings.excludeTools,
    memory: memoryContent,
    approvalMode: getApprovalMode(),
    mcpServers: mergeMcpServers(settings, extensions),
    telemetry: createTelemetrySettings(settings),
    fileFiltering: {
      respectGitIgnore: settings.fileFiltering?.respectGitIgnore,
      enableRecursiveFileSearch:
        settings.fileFiltering?.enableRecursiveFileSearch,
    },
    folderTrust: settings.folderTrust,
    interactive: true,
    extensions,
    harness: {
      includeProcessCwd: true,
      forceConfirmations: false,
    },
    settings: {
      llxprtMdFileCount: fileCount,
      showMemoryUsage: settings.showMemoryUsage ?? false,
    },
  };
  return createAgent(agentConfig);
}

function getApprovalMode(): ApprovalMode {
  return process.env['LLXPRT_YOLO_MODE'] === 'true'
    ? ApprovalMode.YOLO
    : ApprovalMode.DEFAULT;
}

/**
 * Resolve the provider from LLXPRT_DEFAULT_PROVIDER env var.
 * Returns UNCONFIGURED_PROVIDER when no explicit provider is selected,
 * keeping the A2A server provider-neutral by default. The value is trimmed
 * so whitespace-only entries are treated as unconfigured.
 */
function resolveProviderFromEnv(): string {
  const envProvider = process.env['LLXPRT_DEFAULT_PROVIDER']?.trim();
  if (envProvider !== undefined && envProvider !== '') {
    return envProvider;
  }
  return UNCONFIGURED_PROVIDER;
}

function createTelemetrySettings(settings: Settings): AgentConfig['telemetry'] {
  return {
    enabled: settings.telemetry?.enabled,
    logPrompts: settings.telemetry?.logPrompts,
  };
}

async function loadWorkspaceMemory(
  workspaceDir: string,
  extensions: LlxprtExtension[],
): Promise<{ memoryContent: string; fileCount: number }> {
  const fileService = new FileDiscoveryService(workspaceDir);
  return loadServerHierarchicalMemory(
    workspaceDir,
    [workspaceDir],
    false,
    fileService,
    extensions,
    // Folder trust integration pending; using permissive default for server mode.
    true,
  );
}

export function mergeMcpServers(
  settings: Settings,
  extensions: LlxprtExtension[],
) {
  const mcpServers = { ...(settings.mcpServers ?? {}) };
  for (const extension of extensions) {
    Object.entries(extension.mcpServers ?? {}).forEach(([key, server]) => {
      if (Object.prototype.hasOwnProperty.call(mcpServers, key)) {
        debugLogger.warn(
          `Skipping extension MCP config for server with key "${key}" as it already exists.`,
        );
        return;
      }
      mcpServers[key] = server;
    });
  }
  return mcpServers;
}

export function setTargetDir(agentSettings: AgentSettings | undefined): string {
  const originalCWD = process.cwd();
  const targetDir =
    process.env['CODER_AGENT_WORKSPACE_PATH'] ??
    (agentSettings?.kind === CoderAgentEvent.StateAgentSettingsEvent
      ? agentSettings.workspacePath
      : undefined);

  if (!targetDir) {
    return originalCWD;
  }

  logger.info(
    `[CoderAgentExecutor] Overriding workspace path to: ${targetDir}`,
  );

  try {
    const resolvedPath = path.resolve(targetDir);
    process.chdir(resolvedPath);
    return resolvedPath;
  } catch (e) {
    logger.error(
      `[CoderAgentExecutor] Error resolving workspace path: ${e}, returning original os.cwd()`,
    );
    return originalCWD;
  }
}

export function loadEnvironment(options: { homeDir?: string } = {}): void {
  const homeDir = options.homeDir ?? homedir();
  const envFilePath = findEnvFile(process.cwd(), homeDir);
  if (envFilePath) {
    // quiet: true because dotenv 17 otherwise writes an injection banner to
    // stdout, bypassing the server logger. a2a-server moved from a dotenv 16
    // devDependency to a 17 runtime dependency, which is where this appeared;
    // scripts/sandbox_command.ts already passes the flag.
    dotenv.config({ path: envFilePath, override: true, quiet: true });
  }
}

function findEnvFile(startDir: string, homeDir: string): string | null {
  let currentDir = path.resolve(startDir);
  let parentDir = path.resolve(startDir);
  // do/while so the root directory is still probed before exiting,
  // matching the original while(true) traversal that checked currentDir
  // before testing whether parentDir === currentDir.
  do {
    currentDir = parentDir;
    // prefer llxprt-specific .env under LLXPRT_CONFIG_DIR
    const llxprtEnvPath = path.join(currentDir, LLXPRT_CONFIG_DIR, '.env');
    if (fs.existsSync(llxprtEnvPath)) {
      return llxprtEnvPath;
    }
    const envPath = path.join(currentDir, '.env');
    if (fs.existsSync(envPath)) {
      return envPath;
    }
    parentDir = path.dirname(currentDir);
  } while (parentDir !== currentDir && parentDir !== '');
  // Global LLxprt .env fallback: resolve through the central Storage config
  // directory so LLXPRT_CONFIG_HOME and the platform config location are
  // honored (parity with the CLI's global .env resolution).
  const globalLlxprtEnvPath = path.join(Storage.getGlobalConfigDir(), '.env');
  if (fs.existsSync(globalLlxprtEnvPath)) {
    return globalLlxprtEnvPath;
  }
  const homeEnvPath = path.join(homeDir, '.env');
  if (fs.existsSync(homeEnvPath)) {
    return homeEnvPath;
  }
  return null;
}
