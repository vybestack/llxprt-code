/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MCPServerConfig,
  GeminiCLIExtension,
  Storage,
  getErrorMessage,
} from '@vybestack/llxprt-code-core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { simpleGit } from 'simple-git';
import { recursivelyHydrateStrings } from './extensions/variables.js';
import { SettingScope, loadSettings } from './settings.js';
import { isWorkspaceTrusted } from './trustedFolders.js';
import { resolveEnvVarsInObject } from '../utils/envVarResolver.js';
import type { LoadExtensionContext } from './extensions/variableSchema.js';

export const EXTENSIONS_DIRECTORY_NAME = '.llxprt/extensions';

export const EXTENSIONS_CONFIG_FILENAME = 'llxprt-extension.json';
export const INSTALL_METADATA_FILENAME = '.llxprt-extension-install.json';

export interface Extension {
  path: string;
  config: ExtensionConfig;
  contextFiles: string[];
  installMetadata?: ExtensionInstallMetadata | undefined;
}

export interface ExtensionConfig {
  name: string;
  version: string;
  mcpServers?: Record<string, MCPServerConfig>;
  contextFileName?: string | string[];
  excludeTools?: string[];
}

export interface ExtensionInstallMetadata {
  source: string;
  type: 'git' | 'local' | 'link';
}

export interface ExtensionUpdateInfo {
  name: string;
  originalVersion: string;
  updatedVersion: string;
}

export class ExtensionStorage {
  private readonly extensionName: string;

  constructor(extensionName: string) {
    this.extensionName = extensionName;
  }

  getExtensionDir(): string {
    return path.join(
      ExtensionStorage.getUserExtensionsDir(),
      this.extensionName,
    );
  }

  getConfigPath(): string {
    return path.join(this.getExtensionDir(), EXTENSIONS_CONFIG_FILENAME);
  }

  static getSettingsPath(): string {
    return process.cwd();
  }

  static getUserExtensionsDir(): string {
    const storage = new Storage(os.homedir());
    return storage.getExtensionsDir();
  }

  static async createTmpDir(): Promise<string> {
    return await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'llxprt-extension'),
    );
  }
}

export function getWorkspaceExtensions(workspaceDir: string): Extension[] {
  return loadExtensionsFromDir(workspaceDir, workspaceDir);
}

async function copyExtension(
  source: string,
  destination: string,
): Promise<void> {
  await fs.promises.cp(source, destination, { recursive: true });
}

export async function performWorkspaceExtensionMigration(
  extensions: Extension[],
): Promise<string[]> {
  const failedInstallNames: string[] = [];

  for (const extension of extensions) {
    try {
      const installMetadata: ExtensionInstallMetadata = {
        source: extension.path,
        type: 'local',
      };
      await installExtension(installMetadata, process.cwd());
    } catch (_) {
      failedInstallNames.push(extension.config.name);
    }
  }
  return failedInstallNames;
}

export function loadExtensions(
  workspaceDir: string = process.cwd(),
): Extension[] {
  const settings = loadSettings(workspaceDir).merged;
  const disabledExtensions = settings.extensions?.disabled ?? [];
  const allExtensions = [...loadUserExtensions(workspaceDir)];

  if ((isWorkspaceTrusted(settings) ?? true) && !settings.extensionManagement) {
    allExtensions.push(...getWorkspaceExtensions(workspaceDir));
  }

  const uniqueExtensions = new Map<string, Extension>();
  for (const extension of allExtensions) {
    if (
      !uniqueExtensions.has(extension.config.name) &&
      !disabledExtensions.includes(extension.config.name)
    ) {
      uniqueExtensions.set(extension.config.name, extension);
    }
  }

  return Array.from(uniqueExtensions.values());
}

export function loadUserExtensions(
  workspaceDir: string = process.cwd(),
): Extension[] {
  const userExtensions = loadExtensionsFromDir(os.homedir(), workspaceDir);

  const uniqueExtensions = new Map<string, Extension>();
  for (const extension of userExtensions) {
    if (!uniqueExtensions.has(extension.config.name)) {
      uniqueExtensions.set(extension.config.name, extension);
    }
  }

  return Array.from(uniqueExtensions.values());
}

export function loadExtensionsFromDir(
  dir: string,
  workspaceDir: string = dir,
): Extension[] {
  const storage = new Storage(dir);
  const extensionsDir = storage.getExtensionsDir();
  if (!fs.existsSync(extensionsDir)) {
    return [];
  }

  const extensions: Extension[] = [];
  for (const subdir of fs.readdirSync(extensionsDir)) {
    const extensionDir = path.join(extensionsDir, subdir);

    const extension = loadExtension({ extensionDir, workspaceDir });
    if (extension != null) {
      extensions.push(extension);
    }
  }
  return extensions;
}

export function loadExtension(context: LoadExtensionContext): Extension | null {
  const { extensionDir, workspaceDir } = context;
  if (!fs.statSync(extensionDir).isDirectory()) {
    console.error(
      `Warning: unexpected file ${extensionDir} in extensions directory.`,
    );
    return null;
  }

  const installMetadata = loadInstallMetadata(extensionDir);
  let effectiveExtensionPath = extensionDir;

  if (installMetadata?.type === 'link') {
    effectiveExtensionPath = installMetadata.source;
  }

  const configFilePath = path.join(
    effectiveExtensionPath,
    EXTENSIONS_CONFIG_FILENAME,
  );
  if (!fs.existsSync(configFilePath)) {
    console.error(
      `Warning: extension directory ${effectiveExtensionPath} does not contain a config file ${configFilePath}.`,
    );
    return null;
  }

  try {
    const configContent = fs.readFileSync(configFilePath, 'utf-8');
    let config = recursivelyHydrateStrings(JSON.parse(configContent), {
      extensionPath: extensionDir,
      workspacePath: workspaceDir,
      '/': path.sep,
      pathSeparator: path.sep,
    }) as unknown as ExtensionConfig;
    if (!config.name || !config.version) {
      console.error(
        `Invalid extension config in ${configFilePath}: missing name or version.`,
      );
      return null;
    }

    config = resolveEnvVarsInObject(config);

    const contextFiles = getContextFileNames(config)
      .map((contextFileName) =>
        path.join(effectiveExtensionPath, contextFileName),
      )
      .filter((contextFilePath) => fs.existsSync(contextFilePath));

    return {
      path: effectiveExtensionPath,
      config,
      contextFiles,
      installMetadata,
    };
  } catch (e) {
    console.error(
      `Warning: error parsing extension config in ${configFilePath}: ${e}`,
    );
    return null;
  }
}

function loadInstallMetadata(
  extensionDir: string,
): ExtensionInstallMetadata | undefined {
  const metadataFilePath = path.join(extensionDir, INSTALL_METADATA_FILENAME);
  try {
    const configContent = fs.readFileSync(metadataFilePath, 'utf-8');
    const metadata = JSON.parse(configContent) as ExtensionInstallMetadata;
    return metadata;
  } catch (_e) {
    return undefined;
  }
}

function getContextFileNames(config: ExtensionConfig): string[] {
  if (!config.contextFileName) {
    return ['LLXPRT.md'];
  } else if (!Array.isArray(config.contextFileName)) {
    return [config.contextFileName];
  }
  return config.contextFileName;
}

export function annotateActiveExtensions(
  extensions: Extension[],
  enabledExtensionNames: string[],
): GeminiCLIExtension[] {
  const annotatedExtensions: GeminiCLIExtension[] = [];

  if (enabledExtensionNames.length === 0) {
    return extensions.map((extension) => ({
      name: extension.config.name,
      version: extension.config.version,
      isActive: true,
      path: extension.path,
    }));
  }

  const lowerCaseEnabledExtensions = new Set(
    enabledExtensionNames.map((e) => e.trim().toLowerCase()),
  );

  if (
    lowerCaseEnabledExtensions.size === 1 &&
    lowerCaseEnabledExtensions.has('none')
  ) {
    return extensions.map((extension) => ({
      name: extension.config.name,
      version: extension.config.version,
      isActive: false,
      path: extension.path,
    }));
  }

  const notFoundNames = new Set(lowerCaseEnabledExtensions);

  for (const extension of extensions) {
    const lowerCaseName = extension.config.name.toLowerCase();
    const isActive = lowerCaseEnabledExtensions.has(lowerCaseName);

    if (isActive) {
      notFoundNames.delete(lowerCaseName);
    }

    annotatedExtensions.push({
      name: extension.config.name,
      version: extension.config.version,
      isActive,
      path: extension.path,
    });
  }

  for (const requestedName of notFoundNames) {
    console.error(`Extension not found: ${requestedName}`);
  }

  return annotatedExtensions;
}

/**
 * Clones a Git repository to a specified local path.
 * @param gitUrl The Git URL to clone.
 * @param destination The destination path to clone the repository to.
 */
async function cloneFromGit(
  gitUrl: string,
  destination: string,
): Promise<void> {
  try {
    // TODO(chrstnb): Download the archive instead to avoid unnecessary .git info.
    await simpleGit().clone(gitUrl, destination, ['--depth', '1']);
  } catch (error) {
    throw new Error(`Failed to clone Git repository from ${gitUrl}`, {
      cause: error,
    });
  }
}

export async function installExtension(
  installMetadata: ExtensionInstallMetadata,
  cwd: string = process.cwd(),
): Promise<string> {
  const settings = loadSettings(cwd).merged;
  if (isWorkspaceTrusted(settings) === false) {
    throw new Error(
      `Could not install extension from untrusted folder at ${installMetadata.source}`,
    );
  }

  const extensionsDir = ExtensionStorage.getUserExtensionsDir();
  await fs.promises.mkdir(extensionsDir, { recursive: true });

  // Convert relative paths to absolute paths for the metadata file.
  if (
    !path.isAbsolute(installMetadata.source) &&
    (installMetadata.type === 'local' || installMetadata.type === 'link')
  ) {
    installMetadata.source = path.resolve(
      process.cwd(),
      installMetadata.source,
    );
  }

  let localSourcePath: string;
  let tempDir: string | undefined;
  let newExtensionName: string | undefined;

  if (installMetadata.type === 'git') {
    tempDir = await ExtensionStorage.createTmpDir();
    await cloneFromGit(installMetadata.source, tempDir);
    localSourcePath = tempDir;
  } else if (
    installMetadata.type === 'local' ||
    installMetadata.type === 'link'
  ) {
    localSourcePath = installMetadata.source;
  } else {
    throw new Error(`Unsupported install type: ${installMetadata.type}`);
  }

  try {
    const newExtensionConfig = await loadExtensionConfig({
      extensionDir: localSourcePath,
      workspaceDir: cwd,
    });
    if (!newExtensionConfig) {
      throw new Error(
        `Invalid extension at ${installMetadata.source}. Please make sure it has a valid llxprt-extension.json file.`,
      );
    }

    // ~/.llxprt/extensions/{ExtensionConfig.name}.
    newExtensionName = newExtensionConfig.name;
    const extensionStorage = new ExtensionStorage(newExtensionName);
    const destinationPath = extensionStorage.getExtensionDir();

    const installedExtensions = loadUserExtensions(cwd);
    if (
      installedExtensions.some(
        (installed) => installed.config.name === newExtensionName,
      )
    ) {
      throw new Error(
        `Error: Extension "${newExtensionName}" is already installed. Please uninstall it first.`,
      );
    }

    await fs.promises.mkdir(destinationPath, { recursive: true });

    if (installMetadata.type === 'local' || installMetadata.type === 'git') {
      await copyExtension(localSourcePath, destinationPath);
    }

    const metadataString = JSON.stringify(installMetadata, null, 2);
    const metadataPath = path.join(destinationPath, INSTALL_METADATA_FILENAME);
    await fs.promises.writeFile(metadataPath, metadataString);
  } finally {
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }

  return newExtensionName;
}

async function loadExtensionConfig(
  context: LoadExtensionContext,
): Promise<ExtensionConfig | null> {
  const { extensionDir, workspaceDir } = context;
  const configFilePath = path.join(extensionDir, EXTENSIONS_CONFIG_FILENAME);
  if (!fs.existsSync(configFilePath)) {
    return null;
  }
  try {
    const configContent = fs.readFileSync(configFilePath, 'utf-8');
    const config = recursivelyHydrateStrings(JSON.parse(configContent), {
      extensionPath: extensionDir,
      workspacePath: workspaceDir,
      '/': path.sep,
      pathSeparator: path.sep,
    }) as unknown as ExtensionConfig;
    if (!config.name || !config.version) {
      return null;
    }
    return config;
  } catch (_) {
    return null;
  }
}

export async function uninstallExtension(
  extensionIdentifier: string,
  cwd: string = process.cwd(),
): Promise<void> {
  const installedExtensions = loadUserExtensions(cwd);
  const normalizedIdentifier = extensionIdentifier.toLowerCase();
  const extensionName = installedExtensions.find((installed) => {
    if (installed.config.name.toLowerCase() === normalizedIdentifier) {
      return true;
    }
    const source = installed.installMetadata?.source?.toLowerCase();
    return source === normalizedIdentifier;
  })?.config.name;

  if (!extensionName) {
    throw new Error(
      `Extension "${extensionIdentifier}" not found. Run llxprt extensions list to see available extensions.`,
    );
  }

  const storage = new ExtensionStorage(extensionName);
  return await fs.promises.rm(storage.getExtensionDir(), {
    recursive: true,
    force: true,
  });
}

export function toOutputString(extension: Extension): string {
  let output = `${extension.config.name} (${extension.config.version})`;
  output += `\n Path: ${extension.path}`;
  if (extension.installMetadata) {
    output += `\n Source: ${extension.installMetadata.source} (Type: ${extension.installMetadata.type})`;
  }
  if (extension.contextFiles.length > 0) {
    output += `\n Context files:`;
    extension.contextFiles.forEach((contextFile) => {
      output += `\n  ${contextFile}`;
    });
  }
  if (extension.config.mcpServers) {
    output += `\n MCP servers:`;
    Object.keys(extension.config.mcpServers).forEach((key) => {
      output += `\n  ${key}`;
    });
  }
  if (extension.config.excludeTools) {
    output += `\n Excluded tools:`;
    extension.config.excludeTools.forEach((tool) => {
      output += `\n  ${tool}`;
    });
  }
  return output;
}

export async function updateExtensionByName(
  extensionName: string,
  cwd: string = process.cwd(),
): Promise<ExtensionUpdateInfo | undefined> {
  const installedExtensions = loadUserExtensions(cwd);
  const extension = installedExtensions.find(
    (installed) => installed.config.name === extensionName,
  );
  if (!extension) {
    throw new Error(
      `Extension "${extensionName}" not found. Run llxprt extensions list to see available extensions.`,
    );
  }
  return await updateExtension(extension, cwd);
}

export async function updateExtension(
  extension: Extension,
  cwd: string = process.cwd(),
): Promise<ExtensionUpdateInfo> {
  if (!extension.installMetadata) {
    throw new Error(
      `Extension cannot be updated because it is missing the .llxprt-extension-install.json file. To update manually, uninstall and then reinstall the updated version.`,
    );
  }
  if (extension.installMetadata.type === 'link') {
    throw new Error(`Extension is linked so does not need to be updated`);
  }
  const originalVersion = extension.config.version;

  const tempDir = await ExtensionStorage.createTmpDir();
  try {
    await copyExtension(extension.path, tempDir);
    await uninstallExtension(extension.config.name);
    await installExtension(extension.installMetadata, cwd);

    const updatedExtensionStorage = new ExtensionStorage(extension.config.name);
    const updatedExtension = loadExtension({
      extensionDir: updatedExtensionStorage.getExtensionDir(),
      workspaceDir: cwd,
    });
    if (!updatedExtension) {
      throw new Error('Updated extension not found after installation.');
    }
    const updatedVersion = updatedExtension.config.version;
    return {
      name: extension.config.name,
      originalVersion,
      updatedVersion,
    };
  } catch (e) {
    console.error(
      `Error updating extension, rolling back. ${getErrorMessage(e)}`,
    );
    await copyExtension(tempDir, extension.path);
    throw e;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

export function disableExtension(
  name: string,
  scope: SettingScope,
  cwd: string = process.cwd(),
) {
  if (scope === SettingScope.System || scope === SettingScope.SystemDefaults) {
    throw new Error('System and SystemDefaults scopes are not supported.');
  }
  const settings = loadSettings(cwd);
  const settingsFile = settings.forScope(scope);
  const extensionSettings = settingsFile.settings.extensions || {
    disabled: [],
  };
  const disabledExtensions = extensionSettings.disabled || [];
  if (!disabledExtensions.includes(name)) {
    disabledExtensions.push(name);
    extensionSettings.disabled = disabledExtensions;
    settings.setValue(scope, 'extensions', extensionSettings);
  }
}

export function enableExtension(name: string, scopes: SettingScope[]) {
  removeFromDisabledExtensions(name, scopes);
}

/**
 * Removes an extension from the list of disabled extensions.
 * @param name The name of the extension to remove.
 * @param scope The scopes to remove the name from.
 */
function removeFromDisabledExtensions(
  name: string,
  scopes: SettingScope[],
  cwd: string = process.cwd(),
) {
  const settings = loadSettings(cwd);
  for (const scope of scopes) {
    const settingsFile = settings.forScope(scope);
    const extensionSettings = settingsFile.settings.extensions || {
      disabled: [],
    };
    const disabledExtensions = extensionSettings.disabled || [];
    extensionSettings.disabled = disabledExtensions.filter(
      (extension) => extension !== name,
    );
    settings.setValue(scope, 'extensions', extensionSettings);
  }
}

export async function updateAllUpdatableExtensions(
  cwd: string = process.cwd(),
): Promise<ExtensionUpdateInfo[]> {
  const extensions = loadExtensions(cwd).filter(
    (extension) => !!extension.installMetadata,
  );
  return await Promise.all(
    extensions.map((extension) => updateExtension(extension, cwd)),
  );
}
