/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import * as dotenv from 'dotenv';

import type { TelemetryTarget } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-core';
import {
  Config,
  FileDiscoveryService,
  type ConfigParameters,
  ApprovalMode,
  MessageBus,
  loadServerHierarchicalMemory,
  LLXPRT_CONFIG_DIR,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  PLACEHOLDER_MODEL,
  UNCONFIGURED_PROVIDER,
  type LlxprtExtension,
} from '@vybestack/llxprt-code-core';
import {
  createAgentClient,
  createToolScheduler,
  createTaskToolRegistration,
} from '@vybestack/llxprt-code-agents';

import { logger } from '../utils/logger.js';
import type { Settings } from './settings.js';
import { type AgentSettings, CoderAgentEvent } from '../types.js';

export async function loadConfig(
  settings: Settings,
  extensions: LlxprtExtension[],
  taskId: string,
): Promise<Config> {
  const workspaceDir = process.cwd();
  const configParams = await createConfigParameters(
    settings,
    extensions,
    taskId,
    workspaceDir,
  );
  const config = new Config(configParams);
  await initializeConfig(config);
  await refreshConfigAuth(config);
  return config;
}

async function createConfigParameters(
  settings: Settings,
  extensions: LlxprtExtension[],
  taskId: string,
  workspaceDir: string,
): Promise<ConfigParameters> {
  const configParams: ConfigParameters = {
    ...createBaseConfigParameters(settings, extensions, taskId, workspaceDir),
  };
  const { memoryContent, fileCount } = await loadWorkspaceMemory(
    workspaceDir,
    extensions,
  );
  configParams.userMemory = memoryContent;
  configParams.llxprtMdFileCount = fileCount;
  return configParams;
}

function createBaseConfigParameters(
  settings: Settings,
  extensions: LlxprtExtension[],
  taskId: string,
  workspaceDir: string,
): ConfigParameters {
  return {
    sessionId: taskId,
    model: PLACEHOLDER_MODEL,
    provider: resolveProviderFromEnv(),
    embeddingModel: DEFAULT_GEMINI_EMBEDDING_MODEL,
    sandbox: undefined, // Sandbox might not be relevant for a server-side agent
    targetDir: workspaceDir, // Or a specific directory the agent operates on
    debugMode: process.env['DEBUG'] === 'true' || false,
    question: '', // Not used in server mode directly like CLI
    coreTools: settings.coreTools ?? undefined,
    excludeTools: settings.excludeTools ?? undefined,
    showMemoryUsage: settings.showMemoryUsage ?? false,
    approvalMode: getApprovalMode(),
    mcpServers: mergeMcpServers(settings, extensions),
    cwd: workspaceDir,
    telemetry: createTelemetrySettings(settings),
    fileFiltering: {
      respectGitIgnore: settings.fileFiltering?.respectGitIgnore,
      enableRecursiveFileSearch:
        settings.fileFiltering?.enableRecursiveFileSearch,
    },
    ideMode: false,
    folderTrust: settings.folderTrust,
    interactive: true,
    extensions,
    // @plan PLAN-20260610-ISSUE1592.P01
    // @requirement REQ-INV-001
    agentClientFactory: (config, runtimeState) =>
      createAgentClient(config, runtimeState),
    // @plan PLAN-20260610-ISSUE1592.P01
    // @requirement REQ-INV-002
    toolSchedulerFactory: (options) => createToolScheduler(options),
    // @plan PLAN-20260610-ISSUE1592.P03
    // @requirement REQ-INV-003
    taskToolRegistration: createTaskToolRegistration(),
  };
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

function createTelemetrySettings(
  settings: Settings,
): ConfigParameters['telemetry'] {
  return {
    enabled: settings.telemetry?.enabled,
    target: settings.telemetry?.target as TelemetryTarget,
    otlpEndpoint:
      process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ??
      settings.telemetry?.otlpEndpoint,
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

async function initializeConfig(config: Config): Promise<void> {
  const sessionMessageBus = new MessageBus(
    config.getPolicyEngine(),
    config.getDebugMode(),
  );
  await (
    config as Config & {
      initialize(dependencies?: { messageBus?: MessageBus }): Promise<void>;
    }
  ).initialize({ messageBus: sessionMessageBus });
}

async function refreshConfigAuth(config: Config): Promise<void> {
  const authSelection = resolveAuthSelection();
  if (authSelection === undefined) {
    // No explicit Gemini credentials or provider selected — stay unconfigured.
    // The A2A server must not assume Gemini as the default provider.
    return;
  }
  if (authSelection === 'use-ccpa') {
    await refreshCcpaAuth(config);
    return;
  }
  if (authSelection === 'gemini-api-key') {
    logger.info('[Config] Using Gemini API Key');
    await config.refreshAuth('gemini-api-key');
    return;
  }
  if (authSelection === 'vertex-ai') {
    logger.info('[Config] Using Vertex AI credentials');
    await config.refreshAuth('vertex-ai');
    return;
  }
  // authSelection === 'gemini-oauth' — explicit Gemini provider via env,
  // no API key. Fall back to Gemini OAuth.
  logger.info(
    '[Config] Explicit Gemini provider selected via LLXPRT_DEFAULT_PROVIDER, falling back to OAuth.',
  );
  await config.refreshAuth('oauth-personal');
}

type AuthSelection =
  | 'gemini-api-key'
  | 'use-ccpa'
  | 'vertex-ai'
  | 'gemini-oauth'
  | undefined;

/**
 * Resolve which auth method to use based on explicit Gemini credentials or
 * explicit Gemini provider selection. Returns undefined when no Gemini
 * signals are present (unconfigured / neutral state).
 */
function resolveAuthSelection(): AuthSelection {
  if (process.env['USE_CCPA']) {
    return 'use-ccpa';
  }
  if (process.env['GEMINI_API_KEY']) {
    return 'gemini-api-key';
  }
  if (hasVertexCredentials()) {
    return 'vertex-ai';
  }
  // Only fall back to Gemini OAuth when Gemini is explicitly selected.
  const defaultProvider = process.env['LLXPRT_DEFAULT_PROVIDER']?.trim();
  if (defaultProvider === 'gemini') {
    return 'gemini-oauth';
  }
  return undefined;
}

async function refreshCcpaAuth(config: Config): Promise<void> {
  const adcFilePath = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
  logger.info('[Config] Using CCPA Auth:');
  try {
    if (adcFilePath) {
      path.resolve(adcFilePath);
    }
  } catch (e) {
    logger.error(
      `[Config] USE_CCPA env var is true but unable to resolve GOOGLE_APPLICATION_CREDENTIALS file path ${adcFilePath}. Error ${e}`,
    );
  }
  await config.refreshAuth('vertex-ai');
  logger.info(
    `[Config] GOOGLE_CLOUD_PROJECT: ${process.env['GOOGLE_CLOUD_PROJECT']}`,
  );
}

function hasVertexCredentials(): boolean {
  return (
    process.env['GOOGLE_APPLICATION_CREDENTIALS'] !== undefined ||
    process.env['GOOGLE_CLOUD_PROJECT'] !== undefined ||
    process.env['GOOGLE_CLOUD_LOCATION'] !== undefined ||
    process.env['GOOGLE_API_KEY'] !== undefined
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

export function loadEnvironment(): void {
  const envFilePath = findEnvFile(process.cwd());
  if (envFilePath) {
    dotenv.config({ path: envFilePath, override: true });
  }
}

function findEnvFile(startDir: string): string | null {
  let currentDir = path.resolve(startDir);
  let parentDir = path.resolve(startDir);
  // Use do/while so the root directory is still probed before exiting,
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
  // check .env under home as fallback, again preferring llxprt-specific .env
  const homeLlxprtEnvPath = path.join(homedir(), LLXPRT_CONFIG_DIR, '.env');
  if (fs.existsSync(homeLlxprtEnvPath)) {
    return homeLlxprtEnvPath;
  }
  const homeEnvPath = path.join(homedir(), '.env');
  if (fs.existsSync(homeEnvPath)) {
    return homeEnvPath;
  }
  return null;
}
