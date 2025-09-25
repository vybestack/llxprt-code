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
import { downloadFromGitHubRelease } from './extensions/github.js';
import type { LoadExtensionContext } from './extensions/variableSchema.js';
import chalk from 'chalk';
import { ExtensionEnablementManager } from './extensions/extensionEnablement.js';

export { ExtensionEnablementManager } from './extensions/extensionEnablement.js';
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
  type: 'git' | 'local' | 'link' | 'github-release';
  releaseTag?: string; // Only present for github-release installs.
  ref?: string;
  autoUpdate?: boolean;
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

export async function copyExtension(
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
  extensionEnablementManager: ExtensionEnablementManager,
  workspaceDir: string = process.cwd(),
): Extension[] {
  const settings = loadSettings(workspaceDir).merged;
  const allExtensions = [...loadUserExtensions(workspaceDir)];

  if ((isWorkspaceTrusted(settings) ?? true) && !settings.extensionManagement) {
    allExtensions.push(...getWorkspaceExtensions(workspaceDir));
  }

  const uniqueExtensions = new Map<string, Extension>();

  for (const extension of allExtensions) {
    if (
      !uniqueExtensions.has(extension.config.name) &&
      extensionEnablementManager.isEnabled(extension.config.name, workspaceDir)
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

    try {
      validateName(config.name);
    } catch (e) {
      console.error(getErrorMessage(e));
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
      `Warning: Skipping extension in ${effectiveExtensionPath}: ${getErrorMessage(e)}`,
    );
    return null;
  }
}

function filterMcpConfig(original: MCPServerConfig): MCPServerConfig {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { trust, ...rest } = original;
  return Object.freeze(rest);
}

export function loadInstallMetadata(
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
  workspaceDir: string,
  manager: ExtensionEnablementManager,
): GeminiCLIExtension[] {
  manager.validateExtensionOverrides(extensions);
  return extensions.map((extension) => ({
    name: extension.config.name,
    version: extension.config.version,
    isActive: manager.isEnabled(extension.config.name, workspaceDir),
    path: extension.path,
    installMetadata: extension.installMetadata,
  }));
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

/**
 * Asks users a prompt and awaits for a y/n response
 * @param prompt A yes/no prompt to ask the user
 * @returns Whether or not the user answers 'y' (yes). Defaults to 'yes' on enter.
 */
async function promptForContinuation(prompt: string): Promise<boolean> {
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(['y', ''].includes(answer.trim().toLowerCase()));
    });
  });
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
  } else if (installMetadata.type === 'github-release') {
    tempDir = await ExtensionStorage.createTmpDir();
    const result = await downloadFromGitHubRelease(installMetadata, tempDir);
    // Update the ref in metadata to the actual tag that was downloaded
    installMetadata.ref = result.tagName;
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
        `Extension "${newExtensionName}" is already installed. Please uninstall it first.`,
      );
    }

    await fs.promises.mkdir(destinationPath, { recursive: true });

    if (
      installMetadata.type === 'local' ||
      installMetadata.type === 'git' ||
      installMetadata.type === 'github-release'
    ) {
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

/**
 * Validates an extension name contains only alphanumeric characters and dashes.
 * @param name The extension name to validate.
 * @throws Error if the name contains invalid characters.
 */
export function validateName(name: string): void {
  if (!/^[a-zA-Z0-9-]+$/.test(name)) {
    throw new Error(
      `Invalid extension name: "${name}". Only letters (a-z, A-Z), numbers (0-9), and dashes (-) are allowed.`,
    );
  }
}

/**
 * Requests user consent before installing an extension with MCP servers or other features.
 * Shows warnings about what the extension will do and prompts for confirmation.
 * @param extensionConfig The extension configuration to show consent information for.
 */
export async function requestConsent(extensionConfig: ExtensionConfig) {
  const output: string[] = [];
  const mcpServerEntries = Object.entries(extensionConfig.mcpServers || {});
  output.push('Extensions may introduce unexpected behavior.');
  output.push(
    'Ensure you have investigated the extension source and trust the author.',
  );

  if (mcpServerEntries.length) {
    output.push('This extension will run the following MCP servers:');
    for (const [key, mcpServer] of mcpServerEntries) {
      const isLocal = !!mcpServer.command;
      const source =
        mcpServer.httpUrl ??
        `${mcpServer.command || ''}${mcpServer.args ? ' ' + mcpServer.args.join(' ') : ''}`;
      output.push(`  * ${key} (${isLocal ? 'local' : 'remote'}): ${source}`);
    }
  }
  if (extensionConfig.contextFileName) {
    output.push(
      `This extension will append info to your LLXPRT.md context using ${extensionConfig.contextFileName}`,
    );
  }
  if (extensionConfig.excludeTools) {
    output.push(
      `This extension will exclude the following core tools: ${extensionConfig.excludeTools}`,
    );
  }
  console.info(output.join('\n'));
  const shouldContinue = await promptForContinuation(
    'Do you want to continue? [Y/n]: ',
  );
  if (!shouldContinue) {
    throw new Error('Installation cancelled by user.');
  }
}

export async function loadExtensionConfig(
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
    validateName(config.name);
    return config;
  } catch (e) {
    // Re-throw validation errors so installExtension() can report them
    if (e instanceof Error && e.message.includes('Invalid extension name')) {
      throw e;
    }
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

  const manager = new ExtensionEnablementManager(
    ExtensionStorage.getUserExtensionsDir(),
    [extensionName],
  );
  manager.remove(extensionName);

  const storage = new ExtensionStorage(extensionName);
  return await fs.promises.rm(storage.getExtensionDir(), {
    recursive: true,
    force: true,
  });
}

export function toOutputString(
  extension: Extension,
  isEnabled: boolean,
): string {
  const status = isEnabled ? chalk.green('✓') : chalk.red('✗');
  let output = `${status} ${extension.config.name} (${extension.config.version})`;
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
