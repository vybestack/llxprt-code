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
import type { UseHistoryManagerReturn } from '../ui/hooks/useHistoryManager.js';

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
  requestConsent: (consent: string) => Promise<boolean>,
): Promise<string[]> {
  const failedInstallNames: string[] = [];

  for (const extension of extensions) {
    try {
      const installMetadata: ExtensionInstallMetadata = {
        source: extension.path,
        type: 'local',
      };
      await installExtension(installMetadata, requestConsent);
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

export function loadExtensionByName(
  name: string,
  workspaceDir: string = process.cwd(),
): Extension | null {
  const userExtensionsDir = ExtensionStorage.getUserExtensionsDir();
  if (!fs.existsSync(userExtensionsDir)) {
    return null;
  }

  for (const subdir of fs.readdirSync(userExtensionsDir)) {
    const extensionDir = path.join(userExtensionsDir, subdir);
    if (!fs.statSync(extensionDir).isDirectory()) {
      continue;
    }
    const extension = loadExtension({ extensionDir, workspaceDir });
    if (
      extension &&
      extension.config.name.toLowerCase() === name.toLowerCase()
    ) {
      return extension;
    }
  }

  return null;
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
 * Requests consent from the user to perform an action, by reading a Y/n
 * character from stdin.
 *
 * This should not be called from interactive mode as it will break the CLI.
 *
 * @param consentDescription The description of the thing they will be consenting to.
 * @returns boolean, whether they consented or not.
 */
export async function requestConsentNonInteractive(
  consentDescription: string,
): Promise<boolean> {
  console.info(consentDescription);
  const result = await promptForContinuationNonInteractive(
    'Do you want to continue? [Y/n]: ',
  );
  return result;
}

/**
 * Requests consent from the user to perform an action, in interactive mode.
 *
 * This should not be called from non-interactive mode as it will not work.
 *
 * @param consentDescription The description of the thing they will be consenting to.
 * @returns boolean, whether they consented or not.
 */
export async function requestConsentInteractive(
  _consentDescription: string,
  addHistoryItem: UseHistoryManagerReturn['addItem'],
): Promise<boolean> {
  addHistoryItem(
    {
      type: 'info',
      text: 'Tried to update an extension but it has some changes that require consent, please use `gemini extensions update`.',
    },
    Date.now(),
  );
  return false;
}

/**
 * Asks users a prompt and awaits for a y/n response on stdin.
 *
 * This should not be called from interactive mode as it will break the CLI.
 *
 * @param prompt A yes/no prompt to ask the user
 * @returns Whether or not the user answers 'y' (yes). Defaults to 'yes' on enter.
 */
async function promptForContinuationNonInteractive(
  prompt: string,
): Promise<boolean> {
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
  requestConsent: (consent: string) => Promise<boolean>,
  cwd: string = process.cwd(),
  previousExtensionConfig?: ExtensionConfig,
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

    await maybeRequestConsentOrFail(
      newExtensionConfig,
      requestConsent,
      previousExtensionConfig,
    );
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
 * Builds a consent string for installing an extension based on its
 * extensionConfig.
 */
function extensionConsentString(extensionConfig: ExtensionConfig): string {
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
  return output.join('\n');
}

/**
 * Requests consent from the user to perform an action, in non-interactive mode.
 *
 * This should not be called from interactive mode as it will break the CLI.
 *
 * @param consentDescription The description of the thing they will be consenting to.
 * @returns boolean, whether they consented or not.
 */

/**
 * Requests consent from the user to install an extension (extensionConfig), if
 * there is any difference between the consent string for `extensionConfig` and
 * `previousExtensionConfig`.
 *
 * Always requests consent if previousExtensionConfig is null.
 *
 * Throws if the user does not consent.
 */
async function maybeRequestConsentOrFail(
  extensionConfig: ExtensionConfig,
  requestConsent: (consent: string) => Promise<boolean>,
  previousExtensionConfig?: ExtensionConfig,
) {
  const extensionConsent = extensionConsentString(extensionConfig);
  if (previousExtensionConfig) {
    const previousExtensionConsent = extensionConsentString(
      previousExtensionConfig,
    );
    if (previousExtensionConsent === extensionConsent) {
      return;
    }
  }
  if (!(await requestConsent(extensionConsent))) {
    throw new Error('Installation cancelled.');
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
  workspaceDir: string,
): string {
  const manager = new ExtensionEnablementManager(
    ExtensionStorage.getUserExtensionsDir(),
  );
  const userEnabled = manager.isEnabled(extension.config.name, os.homedir());
  const workspaceEnabled = manager.isEnabled(
    extension.config.name,
    workspaceDir,
  );

  const status = workspaceEnabled ? chalk.green('✓') : chalk.red('✗');
  let output = `${status} ${extension.config.name} (${extension.config.version})`;
  output += `\n Path: ${extension.path}`;
  if (extension.installMetadata) {
    output += `\n Source: ${extension.installMetadata.source} (Type: ${extension.installMetadata.type})`;
  }
  output += `\n Enabled (User): ${userEnabled}`;
  output += `\n Enabled (Workspace): ${workspaceEnabled}`;
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
  const extension = loadExtensionByName(name, cwd);
  if (!extension) {
    throw new Error(`Extension with name ${name} does not exist.`);
  }

  const manager = new ExtensionEnablementManager(
    ExtensionStorage.getUserExtensionsDir(),
  );
  const scopePath = scope === SettingScope.Workspace ? cwd : os.homedir();
  manager.disable(name, true, scopePath);
}

export function enableExtension(
  name: string,
  scope: SettingScope,
  cwd: string = process.cwd(),
) {
  if (scope === SettingScope.System || scope === SettingScope.SystemDefaults) {
    throw new Error('System and SystemDefaults scopes are not supported.');
  }
  const extension = loadExtensionByName(name, cwd);
  if (!extension) {
    throw new Error(`Extension with name ${name} does not exist.`);
  }
  const manager = new ExtensionEnablementManager(
    ExtensionStorage.getUserExtensionsDir(),
  );
  const scopePath = scope === SettingScope.Workspace ? cwd : os.homedir();
  manager.enable(name, true, scopePath);
}
