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
  type ConfigParameters,
  FileDiscoveryService,
  ApprovalMode,
  MessageBus,
  loadServerHierarchicalMemory,
  LLXPRT_CONFIG_DIR as GEMINI_CONFIG_DIR,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_GEMINI_MODEL,
  type GeminiCLIExtension,
} from '@vybestack/llxprt-code-core';

import { logger } from '../utils/logger.js';
import type { Settings } from './settings.js';
import { type AgentSettings, CoderAgentEvent } from '../types.js';

export async function loadConfig(
  settings: Settings,
  extensions: GeminiCLIExtension[],
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
  extensions: GeminiCLIExtension[],
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
  extensions: GeminiCLIExtension[],
  taskId: string,
  workspaceDir: string,
): ConfigParameters {
  return {
    sessionId: taskId,
    model: DEFAULT_GEMINI_MODEL,
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
    folderTrust: settings.folderTrust === true,
    interactive: true,
    extensions,
  };
}

function getApprovalMode(): ApprovalMode {
  return process.env['GEMINI_YOLO_MODE'] === 'true'
    ? ApprovalMode.YOLO
    : ApprovalMode.DEFAULT;
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
  extensions: GeminiCLIExtension[],
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
  if (process.env['USE_CCPA']) {
    await refreshCcpaAuth(config);
    return;
  }
  if (process.env['GEMINI_API_KEY']) {
    logger.info('[Config] Using Gemini API Key');
    await config.refreshAuth('gemini-api-key');
    return;
  }
  if (hasVertexCredentials()) {
    logger.info('[Config] Using Vertex AI credentials');
    await config.refreshAuth('vertex-ai');
    return;
  }
  logger.warn(
    `[Config] No GEMINI_API_KEY, USE_CCPA, or Vertex AI credentials configured. Falling back to OAuth.`,
  );
  await config.refreshAuth('oauth-personal');
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
  extensions: GeminiCLIExtension[],
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
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Classic infinite loop pattern: returns when found, breaks when parentDir === currentDir
  while (true) {
    // prefer gemini-specific .env under GEMINI_DIR
    const geminiEnvPath = path.join(currentDir, GEMINI_CONFIG_DIR, '.env');
    if (fs.existsSync(geminiEnvPath)) {
      return geminiEnvPath;
    }
    const envPath = path.join(currentDir, '.env');
    if (fs.existsSync(envPath)) {
      return envPath;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir || !parentDir) {
      // check .env under home as fallback, again preferring gemini-specific .env
      const homeGeminiEnvPath = path.join(
        process.cwd(),
        GEMINI_CONFIG_DIR,
        '.env',
      );
      if (fs.existsSync(homeGeminiEnvPath)) {
        return homeGeminiEnvPath;
      }
      const homeEnvPath = path.join(homedir(), '.env');
      if (fs.existsSync(homeEnvPath)) {
        return homeEnvPath;
      }
      return null;
    }
    currentDir = parentDir;
  }
}
