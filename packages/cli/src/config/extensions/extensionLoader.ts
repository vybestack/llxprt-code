import {
  type GeminiCLIExtension,
  getErrorMessage,
  type MCPServerConfig,
  type SkillDefinition,
  loadSkillsFromDirSync,
} from '@vybestack/llxprt-code-core';
import * as fs from 'fs';
import * as path from 'path';
import { resolveEnvVarsInObject } from '../../utils/envVarResolver.js';
import { recursivelyHydrateStrings, type JsonObject } from './variables.js';
import type { LoadExtensionContext } from './variableSchema.js';
import type {
  ExtensionConfig,
  ExtensionInstallMetadata,
  ResolvedExtensionSetting,
} from '../extension.js';

interface LoadExtensionDeps {
  configFileName: string;
  fallbackConfigFileName: string;
  installMetadataFileName: string;
  loadSettings: (workspaceDir: string) => { merged: Record<string, unknown> };
  validateName: (name: string) => void;
  reportError: (message: string) => void;
  reportWarning: (message: string) => void;
}

export function loadInstallMetadataFromDir(
  extensionDir: string,
  installMetadataFileName: string,
): ExtensionInstallMetadata | undefined {
  const metadataFilePath = path.join(extensionDir, installMetadataFileName);
  try {
    const configContent = fs.readFileSync(metadataFilePath, 'utf-8');
    return JSON.parse(configContent) as ExtensionInstallMetadata;
  } catch {
    return undefined;
  }
}

function filterMcpConfig(original: MCPServerConfig): MCPServerConfig {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { trust, ...rest } = original;
  return Object.freeze(rest);
}

function getContextFileNames(config: ExtensionConfig): string[] {
  if (config.contextFileName === undefined || config.contextFileName === '') {
    return ['LLXPRT.md'];
  } else if (!Array.isArray(config.contextFileName)) {
    return [config.contextFileName];
  }
  return config.contextFileName;
}

function getEffectiveExtensionPath(
  extensionDir: string,
  installMetadata: ExtensionInstallMetadata | undefined,
): string {
  return installMetadata?.type === 'link'
    ? installMetadata.source
    : extensionDir;
}

function getExtensionConfigPath(
  effectiveExtensionPath: string,
  deps: LoadExtensionDeps,
): string | null {
  const primaryPath = path.join(effectiveExtensionPath, deps.configFileName);
  if (fs.existsSync(primaryPath)) {
    return primaryPath;
  }
  const fallbackPath = path.join(
    effectiveExtensionPath,
    deps.fallbackConfigFileName,
  );
  return fs.existsSync(fallbackPath) ? fallbackPath : null;
}

function isRemoteExtensionBlocked(
  installMetadata: ExtensionInstallMetadata | undefined,
  workspaceDir: string,
  deps: LoadExtensionDeps,
): boolean {
  if (
    installMetadata?.type !== 'git' &&
    installMetadata?.type !== 'github-release'
  ) {
    return false;
  }
  const settings = deps.loadSettings(workspaceDir).merged;
  return (
    (settings.security as { blockGitExtensions?: boolean } | undefined)
      ?.blockGitExtensions === true
  );
}

function readExtensionConfig(
  configFilePath: string,
  effectiveExtensionPath: string,
  workspaceDir: string,
  deps: LoadExtensionDeps,
): ExtensionConfig | null {
  const configContent = fs.readFileSync(configFilePath, 'utf-8');
  let config = recursivelyHydrateStrings(JSON.parse(configContent), {
    extensionPath: effectiveExtensionPath,
    workspacePath: workspaceDir,
    '/': path.sep,
    pathSeparator: path.sep,
  }) as unknown as ExtensionConfig;
  if (!config.name || !config.version) {
    deps.reportError(
      `Invalid extension config in ${configFilePath}: missing name or version.`,
    );
    return null;
  }
  try {
    deps.validateName(config.name);
  } catch (error) {
    deps.reportError(getErrorMessage(error));
    return null;
  }
  config = resolveEnvVarsInObject(config);
  if (config.mcpServers) {
    config.mcpServers = Object.fromEntries(
      Object.entries(config.mcpServers).map(([key, value]) => [
        key,
        filterMcpConfig(value),
      ]),
    );
  }
  return config;
}

function loadContextFiles(
  config: ExtensionConfig,
  effectiveExtensionPath: string,
): string[] {
  return getContextFileNames(config)
    .map((contextFileName) =>
      path.join(effectiveExtensionPath, contextFileName),
    )
    .filter((contextFilePath) => fs.existsSync(contextFilePath));
}

function loadExtensionSkills(
  effectiveExtensionPath: string,
  workspaceDir: string,
): SkillDefinition[] {
  const hydrationContext = {
    extensionPath: effectiveExtensionPath,
    workspacePath: workspaceDir,
    '/': path.sep,
    pathSeparator: path.sep,
  };
  const rawSkills = loadSkillsFromDirSync(
    path.join(effectiveExtensionPath, 'skills'),
  );
  return rawSkills.map(
    (skill) =>
      recursivelyHydrateStrings(
        skill as unknown as JsonObject,
        hydrationContext,
      ) as unknown as SkillDefinition,
  );
}

export function loadExtensionFromDir(
  context: LoadExtensionContext,
  deps: LoadExtensionDeps,
): GeminiCLIExtension | null {
  const { extensionDir, workspaceDir } = context;
  if (!fs.statSync(extensionDir).isDirectory()) {
    deps.reportError(
      `Warning: unexpected file ${extensionDir} in extensions directory.`,
    );
    return null;
  }

  const installMetadata = loadInstallMetadataFromDir(
    extensionDir,
    deps.installMetadataFileName,
  );
  if (isRemoteExtensionBlocked(installMetadata, workspaceDir, deps)) {
    return null;
  }

  const effectiveExtensionPath = getEffectiveExtensionPath(
    extensionDir,
    installMetadata,
  );
  const configFilePath = getExtensionConfigPath(effectiveExtensionPath, deps);
  if (configFilePath === null) {
    deps.reportWarning(
      `Extension directory ${effectiveExtensionPath} does not contain a valid config file (${deps.configFileName} or ${deps.fallbackConfigFileName}). Skipping.`,
    );
    return null;
  }

  try {
    const config = readExtensionConfig(
      configFilePath,
      effectiveExtensionPath,
      workspaceDir,
      deps,
    );
    if (config === null) {
      return null;
    }
    const resolvedSettings: ResolvedExtensionSetting[] = [];
    return {
      name: config.name,
      version: config.version,
      path: effectiveExtensionPath,
      contextFiles: loadContextFiles(config, effectiveExtensionPath),
      installMetadata,
      mcpServers: config.mcpServers,
      excludeTools: config.excludeTools,
      skills: loadExtensionSkills(effectiveExtensionPath, workspaceDir),
      subagents: config.subagents ?? [],
      isActive: true,
      settings: config.settings as Array<Record<string, unknown>> | undefined,
      resolvedSettings: resolvedSettings as unknown as Array<
        Record<string, unknown>
      >,
    };
  } catch (error) {
    deps.reportError(
      `Warning: Skipping extension in ${effectiveExtensionPath}: ${getErrorMessage(error)}`,
    );
    return null;
  }
}
