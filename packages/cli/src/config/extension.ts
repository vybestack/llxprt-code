/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type GeminiCLIExtension,
  type MCPServerConfig,
  Storage,
} from '@vybestack/llxprt-code-core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { simpleGit } from 'simple-git';
import { SettingScope, loadSettings } from './settings.js';
import {
  isWorkspaceTrusted,
  loadTrustedFolders,
  TrustLevel,
} from './trustedFolders.js';
import { downloadFromGitHubRelease } from './extensions/github.js';
import type { LoadExtensionContext } from './extensions/variableSchema.js';
import chalk from 'chalk';
import { ExtensionEnablementManager } from './extensions/extensionEnablement.js';
import type { ConfirmationRequest } from '../ui/types.js';
import {
  recursivelyHydrateStrings,
  type JsonObject,
} from './extensions/variables.js';

import { maybeRequestConsentOrFail } from './extensions/extensionConsent.js';
import { validateHooks, type Hooks } from './extensions/hookSchema.js';

export { ExtensionEnablementManager } from './extensions/extensionEnablement.js';
import {
  loadExtensionFromDir,
  loadInstallMetadataFromDir,
} from './extensions/extensionLoader.js';

export const EXTENSIONS_DIRECTORY_NAME = '.llxprt/extensions';
export const EXTENSIONS_CONFIG_FILENAME = 'llxprt-extension.json';
export const EXTENSIONS_CONFIG_FILENAME_FALLBACK = 'gemini-extension.json';
export const INSTALL_METADATA_FILENAME = '.llxprt-extension-install.json';

/**
 * Extension setting definition from extension config
 */
export interface ExtensionSetting {
  name: string;
  envVar: string;
  description?: string;
  sensitive?: boolean;
  required?: boolean;
}

/**
 * Resolved extension setting with actual value
 */
export interface ResolvedExtensionSetting {
  name: string;
  envVar: string;
  value: string;
  description?: string;
  sensitive?: boolean;
  source?: 'user' | 'workspace' | 'default';
}

/**
 * Extension definition as written to disk in gemini-extension.json files.
 * This should *not* be referenced outside of the logic for reading files.
 * If information is required for manipulating extensions (load, unload, update)
 * outside of the loading process that data needs to be stored on the
 * GeminiCLIExtension class defined in Core.
 */
export interface ExtensionConfig {
  name: string;
  version: string;
  mcpServers?: Record<string, MCPServerConfig>;
  contextFileName?: string | string[];
  excludeTools?: string[];
  hooks?: Hooks;
  settings?: ExtensionSetting[];
  subagents?: Array<{
    name: string;
    profile: string;
    systemPrompt: string;
  }>;
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
    return fs.promises.mkdtemp(path.join(os.tmpdir(), 'llxprt-extension'));
  }
}

export function getWorkspaceExtensions(
  workspaceDir: string,
): GeminiCLIExtension[] {
  // If the workspace dir is the user extensions dir, there are no workspace extensions.
  if (path.resolve(workspaceDir) === path.resolve(os.homedir())) {
    return [];
  }
  return loadExtensionsFromDir(workspaceDir);
}

export async function copyExtension(
  source: string,
  destination: string,
): Promise<void> {
  await fs.promises.cp(source, destination, { recursive: true });
}

export async function performWorkspaceExtensionMigration(
  extensions: GeminiCLIExtension[],
  requestConsent: (consent: string) => Promise<boolean>,
): Promise<string[]> {
  const failedInstallNames: string[] = [];

  for (const extension of extensions) {
    try {
      const installMetadata: ExtensionInstallMetadata = {
        source: extension.path,
        type: 'local',
      };
      await installOrUpdateExtension(installMetadata, requestConsent);
    } catch {
      failedInstallNames.push(extension.name);
    }
  }
  return failedInstallNames;
}
export function loadExtensions(
  extensionEnablementManager: ExtensionEnablementManager,
  workspaceDir: string = process.cwd(),
): GeminiCLIExtension[] {
  const settings = loadSettings(workspaceDir).merged;

  // Admin-level extension disable enforcement
  if (settings.admin?.extensions?.enabled === false) {
    return [];
  }

  const allExtensions = [...loadUserExtensions()];

  if (
    (isWorkspaceTrusted(settings) ?? true) &&
    settings.extensionManagement !== true
  ) {
    allExtensions.push(...getWorkspaceExtensions(workspaceDir));
  }

  const uniqueExtensions = new Map<string, GeminiCLIExtension>();

  for (const extension of allExtensions) {
    if (
      !uniqueExtensions.has(extension.name) &&
      extensionEnablementManager.isEnabled(extension.name, workspaceDir)
    ) {
      uniqueExtensions.set(extension.name, extension);
    }
  }

  return Array.from(uniqueExtensions.values());
}

export function loadUserExtensions(): GeminiCLIExtension[] {
  const userExtensions = loadExtensionsFromDir(os.homedir());

  const uniqueExtensions = new Map<string, GeminiCLIExtension>();
  for (const extension of userExtensions) {
    if (!uniqueExtensions.has(extension.name)) {
      uniqueExtensions.set(extension.name, extension);
    }
  }

  return Array.from(uniqueExtensions.values());
}

export function loadExtensionsFromDir(
  dir: string,
  workspaceDir: string = dir,
): GeminiCLIExtension[] {
  const storage = new Storage(dir);
  const extensionsDir = storage.getExtensionsDir();
  if (!fs.existsSync(extensionsDir)) {
    return [];
  }

  const extensions: GeminiCLIExtension[] = [];
  for (const subdir of fs.readdirSync(extensionsDir)) {
    const extensionDir = path.join(extensionsDir, subdir);

    const extension = loadExtension({ extensionDir, workspaceDir });
    if (extension != null) {
      extensions.push(extension);
    }
  }
  return extensions;
}

const extensionLoaderDeps = {
  configFileName: EXTENSIONS_CONFIG_FILENAME,
  fallbackConfigFileName: EXTENSIONS_CONFIG_FILENAME_FALLBACK,
  installMetadataFileName: INSTALL_METADATA_FILENAME,
  loadSettings,
  validateName,
  reportError: (message: string) => console.error(message),
  reportWarning: (message: string) => console.warn(message),
};

export function loadExtension(
  context: LoadExtensionContext,
): GeminiCLIExtension | null {
  return loadExtensionFromDir(context, extensionLoaderDeps);
}

/**
 * Resolves extension settings with provenance information.
 * This async function loads settings from both user and workspace scopes,
 * determines which scope provides the effective value, and returns settings
 * enriched with source metadata.
 *
 * @param extensionName - The extension name
 * @param extensionPath - The extension directory path
 * @param settings - The extension's declared settings from manifest
 * @returns Promise resolving to array of resolved settings with source metadata
 */
export async function resolveExtensionSettingsWithSource(
  extensionName: string,
  extensionPath: string,
  settings: ExtensionSetting[],
): Promise<ResolvedExtensionSetting[]> {
  if (settings.length === 0) {
    return [];
  }

  const { getScopedEnvContents, ExtensionSettingScope } = await import(
    './extensions/settingsIntegration.js'
  );

  const userValues = await getScopedEnvContents(
    extensionName,
    extensionPath,
    ExtensionSettingScope.USER,
  );
  const workspaceValues = await getScopedEnvContents(
    extensionName,
    extensionPath,
    ExtensionSettingScope.WORKSPACE,
  );

  return settings.map((setting) => {
    const workspaceValue = workspaceValues[setting.envVar];
    const userValue = userValues[setting.envVar];

    let value: string;
    let source: 'user' | 'workspace' | 'default';

    // Workspace overrides user when workspace value is explicitly set
    if (workspaceValue !== undefined && workspaceValue !== '') {
      value =
        setting.sensitive === true
          ? '[value stored in keychain]'
          : workspaceValue;
      source = 'workspace';
    } else if (userValue !== undefined && userValue !== '') {
      value =
        setting.sensitive === true ? '[value stored in keychain]' : userValue;
      source = 'user';
    } else {
      value = '[not set]';
      source = 'default';
    }

    return {
      name: setting.name,
      envVar: setting.envVar,
      value,
      description: setting.description,
      sensitive: setting.sensitive ?? false,
      source,
    };
  });
}

export function loadExtensionByName(
  name: string,
  workspaceDir: string = process.cwd(),
): GeminiCLIExtension | null {
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
    if (extension && extension.name.toLowerCase() === name.toLowerCase()) {
      return extension;
    }
  }

  return null;
}

export function loadInstallMetadata(
  extensionDir: string,
): ExtensionInstallMetadata | undefined {
  return loadInstallMetadataFromDir(extensionDir, INSTALL_METADATA_FILENAME);
}

export function annotateActiveExtensions(
  extensions: GeminiCLIExtension[],
  workspaceDir: string,
  manager: ExtensionEnablementManager,
): GeminiCLIExtension[] {
  manager.validateExtensionOverrides(extensions);
  return extensions.map((extension) => ({
    ...extension,
    isActive: manager.isEnabled(extension.name, workspaceDir),
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
    // Follow-up (#1569, chrstnb): Download the archive instead to avoid unnecessary .git info.
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
  const result = await promptForConsentNonInteractive(
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
 * @param setExtensionUpdateConfirmationRequest A function to actually add a prompt to the UI.
 * @returns boolean, whether they consented or not.
 */
export async function requestConsentInteractive(
  consentDescription: string,
  addExtensionUpdateConfirmationRequest: (value: ConfirmationRequest) => void,
): Promise<boolean> {
  return promptForConsentInteractive(
    consentDescription + '\n\nDo you want to continue?',
    addExtensionUpdateConfirmationRequest,
  );
}

/**
 * Asks users a prompt and awaits for a y/n response on stdin.
 *
 * This should not be called from interactive mode as it will break the CLI.
 *
 * @param prompt A yes/no prompt to ask the user
 * @returns Whether or not the user answers 'y' (yes). Defaults to 'yes' on enter.
 */
async function promptForConsentNonInteractive(
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

/**
 * Asks users an interactive yes/no prompt.
 *
 * This should not be called from non-interactive mode as it will break the CLI.
 *
 * @param prompt A markdown prompt to ask the user
 * @param setExtensionUpdateConfirmationRequest Function to update the UI state with the confirmation request.
 * @returns Whether or not the user answers yes.
 */
async function promptForConsentInteractive(
  prompt: string,
  addExtensionUpdateConfirmationRequest: (value: ConfirmationRequest) => void,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    addExtensionUpdateConfirmationRequest({
      prompt,
      onConfirm: (resolvedConfirmed) => {
        resolve(resolvedConfirmed);
      },
    });
  });
}

/**
 * Infers installation metadata from a source string.
 * Validates the source and determines whether it's a git URL or local path.
 */
export async function inferInstallMetadata(
  source: string,
  args: {
    ref?: string;
    autoUpdate?: boolean;
    allowPreRelease?: boolean;
  } = {},
): Promise<ExtensionInstallMetadata> {
  const { ref, autoUpdate } = args;

  // Check if source is a URL (git, http, https, sso)
  const isUrl =
    source.startsWith('http://') ||
    source.startsWith('https://') ||
    source.startsWith('git@') ||
    source.startsWith('sso://');

  if (isUrl) {
    // Git-based installation
    return {
      source,
      type: 'git',
      ref,
      autoUpdate,
    };
  }

  // Local path - verify it exists
  // Preserve old truthy behavior: reject only non-empty string ref or autoUpdate === true
  if (typeof ref === 'string' && ref.length > 0) {
    throw new Error(
      'The --ref and --autoUpdate flags are only applicable for git-based installations.',
    );
  }
  if (autoUpdate === true) {
    throw new Error(
      'The --ref and --autoUpdate flags are only applicable for git-based installations.',
    );
  }

  try {
    await fs.promises.stat(source);
    return {
      source,
      type: 'local',
    };
  } catch {
    throw new Error(`Install source not found: ${source}`);
  }
}

interface ExtensionInstallPlan {
  localSourcePath: string;
  tempDir?: string;
}

function ensureRemoteExtensionAllowed(
  installMetadata: ExtensionInstallMetadata,
  settings: ReturnType<typeof loadSettings>['merged'],
): void {
  if (
    (installMetadata.type === 'git' ||
      installMetadata.type === 'github-release') &&
    (settings.security as { blockGitExtensions?: boolean } | undefined)
      ?.blockGitExtensions === true
  ) {
    throw new Error(
      'Installing extensions from remote sources is disallowed by your current settings.',
    );
  }
}

async function ensureWorkspaceTrustedForInstall(
  settings: ReturnType<typeof loadSettings>['merged'],
  cwd: string,
  requestConsent: (consent: string) => Promise<boolean>,
): Promise<void> {
  if (isWorkspaceTrusted(settings) !== false) {
    return;
  }
  const didTrust = await requestConsent(
    `The current workspace at "${cwd}" is not trusted. Do you want to trust this workspace to install extensions?`,
  );
  if (!didTrust) {
    throw new Error(
      `Could not install extension because the current workspace at ${cwd} is not trusted.`,
    );
  }
  const trustedFolders = loadTrustedFolders();
  trustedFolders.setValue(cwd, TrustLevel.TRUST_FOLDER);
}

function normalizeInstallSource(
  installMetadata: ExtensionInstallMetadata,
): void {
  if (
    !path.isAbsolute(installMetadata.source) &&
    (installMetadata.type === 'local' || installMetadata.type === 'link')
  ) {
    installMetadata.source = path.resolve(
      process.cwd(),
      installMetadata.source,
    );
  }
}

async function createExtensionInstallPlan(
  installMetadata: ExtensionInstallMetadata,
): Promise<ExtensionInstallPlan> {
  if (installMetadata.type === 'git') {
    const tempDir = await ExtensionStorage.createTmpDir();
    await cloneFromGit(installMetadata.source, tempDir);
    return { localSourcePath: tempDir, tempDir };
  }
  if (installMetadata.type === 'github-release') {
    const tempDir = await ExtensionStorage.createTmpDir();
    const result = await downloadFromGitHubRelease(installMetadata, tempDir);
    installMetadata.ref = result.tagName;
    return { localSourcePath: tempDir, tempDir };
  }
  return { localSourcePath: installMetadata.source };
}

async function loadValidatedExtensionConfig(
  localSourcePath: string,
  source: string,
  cwd: string,
): Promise<ExtensionConfig> {
  const newExtensionConfig = await loadExtensionConfig({
    extensionDir: localSourcePath,
    workspaceDir: cwd,
  });
  if (newExtensionConfig == null) {
    throw new Error(
      `Invalid extension at ${source}. Please make sure it has a valid ${EXTENSIONS_CONFIG_FILENAME} or ${EXTENSIONS_CONFIG_FILENAME_FALLBACK} file.`,
    );
  }
  return newExtensionConfig;
}

async function warnMissingExtensionSettings(
  extensionConfig: ExtensionConfig,
  destinationPath: string,
  settings: ReturnType<typeof loadSettings>['merged'],
): Promise<void> {
  if (
    extensionConfig.settings == null ||
    extensionConfig.settings.length === 0 ||
    (settings.experimental?.extensionConfig ?? false) === false
  ) {
    return;
  }
  const { getMissingSettings } = await import(
    './extensions/settingsIntegration.js'
  );
  const missingSettings = await getMissingSettings(
    extensionConfig.name,
    destinationPath,
  );
  if (missingSettings.length === 0) {
    return;
  }
  const settingNames = missingSettings
    .map((setting) => setting.name)
    .join(', ');
  console.warn(
    `Extension "${extensionConfig.name}" has missing settings: ${settingNames}. Please run "llxprt extensions config ${extensionConfig.name}" to configure them.`,
  );
}

function ensureExtensionNotAlreadyInstalled(
  newExtensionName: string,
  isUpdate: boolean,
): void {
  if (isUpdate) {
    return;
  }
  const installedExtensions = loadUserExtensions();
  if (
    installedExtensions.some((installed) => installed.name === newExtensionName)
  ) {
    throw new Error(
      `Extension "${newExtensionName}" is already installed. Please uninstall it first.`,
    );
  }
}

async function installExtensionFiles(
  installMetadata: ExtensionInstallMetadata,
  localSourcePath: string,
  destinationPath: string,
): Promise<void> {
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
}
export async function installOrUpdateExtension(
  installMetadata: ExtensionInstallMetadata,
  requestConsent: (consent: string) => Promise<boolean>,
  cwd: string = process.cwd(),
  previousExtensionConfig?: ExtensionConfig,
): Promise<string> {
  const isUpdate = previousExtensionConfig != null;
  const settings = loadSettings(cwd).merged;
  ensureRemoteExtensionAllowed(installMetadata, settings);
  await ensureWorkspaceTrustedForInstall(settings, cwd, requestConsent);
  await fs.promises.mkdir(ExtensionStorage.getUserExtensionsDir(), {
    recursive: true,
  });
  normalizeInstallSource(installMetadata);

  const plan = await createExtensionInstallPlan(installMetadata);
  try {
    const newExtensionConfig = await loadValidatedExtensionConfig(
      plan.localSourcePath,
      installMetadata.source,
      cwd,
    );
    const newExtensionName = newExtensionConfig.name;
    const extensionStorage = new ExtensionStorage(newExtensionName);
    const destinationPath = extensionStorage.getExtensionDir();

    await warnMissingExtensionSettings(
      newExtensionConfig,
      destinationPath,
      settings,
    );
    ensureExtensionNotAlreadyInstalled(newExtensionName, isUpdate);
    await maybeRequestConsentOrFail(
      newExtensionConfig,
      requestConsent,
      previousExtensionConfig,
    );
    if (isUpdate) {
      await uninstallExtension(newExtensionName, true, cwd);
    }
    await installExtensionFiles(
      installMetadata,
      plan.localSourcePath,
      destinationPath,
    );
    return newExtensionName;
  } finally {
    if (plan.tempDir !== undefined) {
      await fs.promises.rm(plan.tempDir, { recursive: true, force: true });
    }
  }
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

export async function loadExtensionConfig(
  context: LoadExtensionContext,
): Promise<ExtensionConfig | null> {
  const { extensionDir, workspaceDir } = context;
  // Try llxprt-extension.json first, then fall back to gemini-extension.json
  let configFilePath = path.join(extensionDir, EXTENSIONS_CONFIG_FILENAME);
  if (!fs.existsSync(configFilePath)) {
    configFilePath = path.join(
      extensionDir,
      EXTENSIONS_CONFIG_FILENAME_FALLBACK,
    );
  }
  if (!fs.existsSync(configFilePath)) {
    console.warn(
      `Extension config file not found at ${extensionDir}. Expected ${EXTENSIONS_CONFIG_FILENAME} or ${EXTENSIONS_CONFIG_FILENAME_FALLBACK}.`,
    );
    return null;
  }
  try {
    const configContent = fs.readFileSync(configFilePath, 'utf-8');
    const rawConfig = JSON.parse(configContent) as ExtensionConfig;
    if (!rawConfig.name || !rawConfig.version) {
      console.warn(
        `Invalid extension configuration in ${configFilePath}: missing ${!rawConfig.name ? '"name"' : '"version"'}`,
      );
      return null;
    }
    const installDir = new ExtensionStorage(rawConfig.name).getExtensionDir();
    const config = recursivelyHydrateStrings(
      rawConfig as unknown as JsonObject,
      {
        extensionPath: installDir,
        workspacePath: workspaceDir,
        '/': path.sep,
        pathSeparator: path.sep,
      },
    ) as unknown as ExtensionConfig;

    validateName(config.name);

    // Validate hooks if present
    if (config.hooks !== undefined) {
      config.hooks = validateHooks(config.hooks);
    }

    return config;
  } catch (e) {
    // Re-throw validation errors so installExtension() can report them
    if (
      e instanceof Error &&
      (e.message.includes('Invalid extension name') ||
        e.message.includes('Invalid configuration') ||
        e.message.includes('Hook name'))
    ) {
      throw e;
    }
    console.warn(
      `Failed to load extension config from ${configFilePath}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

export async function uninstallExtension(
  extensionIdentifier: string,
  isUpdate: boolean,
  _cwd: string = process.cwd(),
): Promise<void> {
  const installedExtensions = loadUserExtensions();
  const extension = installedExtensions.find(
    (installed) =>
      installed.name.toLowerCase() === extensionIdentifier.toLowerCase() ||
      installed.installMetadata?.source.toLowerCase() ===
        extensionIdentifier.toLowerCase(),
  );
  if (!extension) {
    throw new Error(
      `Extension "${extensionIdentifier}" not found. Run llxprt extensions list to see available extensions.`,
    );
  }

  if (!isUpdate) {
    const manager = new ExtensionEnablementManager(
      ExtensionStorage.getUserExtensionsDir(),
      [extension.name],
    );
    manager.remove(extension.name);
  }

  const storage = new ExtensionStorage(
    extension.installMetadata?.type === 'link'
      ? extension.name
      : path.basename(extension.path),
  );
  return fs.promises.rm(storage.getExtensionDir(), {
    recursive: true,
    force: true,
  });
}

export function toOutputString(
  extension: GeminiCLIExtension,
  workspaceDir: string,
): string {
  const manager = new ExtensionEnablementManager(
    ExtensionStorage.getUserExtensionsDir(),
  );
  const userEnabled = manager.isEnabled(extension.name, os.homedir());
  const workspaceEnabled = manager.isEnabled(extension.name, workspaceDir);

  const status = workspaceEnabled ? chalk.green('✓') : chalk.red('✗');
  let output = `${status} ${extension.name} (${extension.version})`;
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
  if (extension.mcpServers) {
    output += `\n MCP servers:`;
    Object.keys(extension.mcpServers).forEach((key) => {
      output += `\n  ${key}`;
    });
  }
  if (extension.excludeTools) {
    output += `\n Excluded tools:`;
    extension.excludeTools.forEach((tool) => {
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
