/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Copied exactly from packages/cli/src/config/extension.ts, last PR #1026

import type {
  MCPServerConfig,
  ExtensionInstallMetadata,
  LlxprtExtension,
  HookDefinition,
} from '@vybestack/llxprt-code-core';
import {
  HookEventName,
  HookType,
  LLXPRT_CONFIG_DIR,
} from '@vybestack/llxprt-code-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { logger } from '../utils/logger.js';

import { readMcpServerConfig } from './mcpServerConfig.js';
export const EXTENSIONS_DIRECTORY_NAME = path.join(
  LLXPRT_CONFIG_DIR,
  'extensions',
);
export const COMPAT_EXTENSIONS_DIRECTORY_NAME = '.gemini/extensions';
export const EXTENSIONS_CONFIG_FILENAME = 'llxprt-extension.json';
export const EXTENSIONS_CONFIG_FILENAME_FALLBACK = 'gemini-extension.json';
export const INSTALL_METADATA_FILENAME = '.llxprt-extension-install.json';
export const INSTALL_METADATA_FILENAME_FALLBACK =
  '.gemini-extension-install.json';

const HOOK_EVENT_NAMES: ReadonlySet<string> = new Set(
  Object.values(HookEventName),
);
const HOOK_CONFIG_KEYS = new Set([
  'type',
  'command',
  'name',
  'description',
  'timeout',
]);
const HOOK_DEFINITION_KEYS = new Set(['matcher', 'sequential', 'hooks']);
const LEGACY_HOOK_KEYS = new Set(['command', 'args']);
const INSTALL_METADATA_KEYS = new Set([
  'source',
  'type',
  'releaseTag',
  'ref',
  'autoUpdate',
  'allowPreRelease',
]);
const INSTALL_METADATA_TYPES = new Set([
  'git',
  'local',
  'link',
  'github-release',
]);
const MAX_HOOK_NAME_LENGTH = 128;
const RESERVED_HOOK_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

type ExecutableHooks = NonNullable<LlxprtExtension['hooks']>;

interface ParsedHooks {
  valid: boolean;
  executable?: ExecutableHooks;
}

function hasOnlyKeys(value: object, allowedKeys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function readOptionalString(
  value: object,
  key: string,
): string | undefined | null {
  const field = Reflect.get(value, key);
  if (field === undefined) {
    return undefined;
  }
  return typeof field === 'string' ? field : null;
}

function parseHookConfig(
  value: unknown,
): HookDefinition['hooks'][number] | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !hasOnlyKeys(value, HOOK_CONFIG_KEYS)
  ) {
    return null;
  }
  const command = Reflect.get(value, 'command');
  const name = readOptionalString(value, 'name');
  const description = readOptionalString(value, 'description');
  const timeout = Reflect.get(value, 'timeout');
  if (Reflect.get(value, 'type') !== HookType.Command) {
    return null;
  }
  if (typeof command !== 'string' || command.length === 0) {
    return null;
  }
  if (name === null || description === null) {
    return null;
  }
  if (timeout !== undefined && typeof timeout !== 'number') {
    return null;
  }

  const result: HookDefinition['hooks'][number] = {
    type: HookType.Command,
    command,
  };
  if (name !== undefined) {
    result.name = name;
  }
  if (description !== undefined) {
    result.description = description;
  }
  if (timeout !== undefined) {
    result.timeout = timeout;
  }
  return result;
}

function parseHookDefinition(value: unknown): HookDefinition | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !hasOnlyKeys(value, HOOK_DEFINITION_KEYS)
  ) {
    return null;
  }
  const matcher = readOptionalString(value, 'matcher');
  const sequential = Reflect.get(value, 'sequential');
  const hooks = Reflect.get(value, 'hooks');
  if (matcher === null) {
    return null;
  }
  if (sequential !== undefined && typeof sequential !== 'boolean') {
    return null;
  }
  if (!Array.isArray(hooks) || hooks.length === 0) {
    return null;
  }
  const parsedHooks = hooks.map(parseHookConfig);
  if (parsedHooks.some((hook) => hook === null)) {
    return null;
  }
  const validHooks = parsedHooks.filter(
    (hook): hook is HookDefinition['hooks'][number] => hook !== null,
  );
  if (matcher !== undefined) {
    if (sequential !== undefined) {
      return { matcher, sequential, hooks: validHooks };
    }
    return { matcher, hooks: validHooks };
  }
  if (sequential !== undefined) {
    return { sequential, hooks: validHooks };
  }
  return { hooks: validHooks };
}

function setHookEvent(
  hooks: ExecutableHooks,
  eventName: string,
  definitions: HookDefinition[],
): boolean {
  switch (eventName) {
    case HookEventName.BeforeTool:
      hooks.BeforeTool = definitions;
      return true;
    case HookEventName.AfterTool:
      hooks.AfterTool = definitions;
      return true;
    case HookEventName.BeforeAgent:
      hooks.BeforeAgent = definitions;
      return true;
    case HookEventName.Notification:
      hooks.Notification = definitions;
      return true;
    case HookEventName.AfterAgent:
      hooks.AfterAgent = definitions;
      return true;
    case HookEventName.SessionStart:
      hooks.SessionStart = definitions;
      return true;
    case HookEventName.SessionEnd:
      hooks.SessionEnd = definitions;
      return true;
    case HookEventName.PreCompress:
      hooks.PreCompress = definitions;
      return true;
    case HookEventName.BeforeModel:
      hooks.BeforeModel = definitions;
      return true;
    case HookEventName.AfterModel:
      hooks.AfterModel = definitions;
      return true;
    case HookEventName.BeforeToolSelection:
      hooks.BeforeToolSelection = definitions;
      return true;
    default:
      return false;
  }
}

function parseModernHooks(value: object): ExecutableHooks | null {
  const result: ExecutableHooks = {};
  for (const [eventName, entry] of Object.entries(value)) {
    if (!HOOK_EVENT_NAMES.has(eventName) || !Array.isArray(entry)) {
      return null;
    }
    const definitions = entry.map(parseHookDefinition);
    if (definitions.some((definition) => definition === null)) {
      return null;
    }
    const validDefinitions = definitions.filter(
      (definition): definition is HookDefinition => definition !== null,
    );
    if (!setHookEvent(result, eventName, validDefinitions)) {
      return null;
    }
  }
  return result;
}

function isValidLegacyHookName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_HOOK_NAME_LENGTH &&
    !RESERVED_HOOK_NAMES.has(name) &&
    /^[a-zA-Z0-9_-]+$/.test(name)
  );
}

function isValidLegacyHookEntry(value: unknown): boolean {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !hasOnlyKeys(value, LEGACY_HOOK_KEYS)
  ) {
    return false;
  }
  const command = Reflect.get(value, 'command');
  const args = Reflect.get(value, 'args');
  if (typeof command !== 'string' || command.length === 0) {
    return false;
  }
  if (args === undefined) {
    return true;
  }
  return Array.isArray(args) && args.every((arg) => typeof arg === 'string');
}

function isValidLegacyHooks(value: object): boolean {
  return Object.entries(value).every(
    ([name, entry]) =>
      isValidLegacyHookName(name) && isValidLegacyHookEntry(entry),
  );
}

function parseManifestHooks(value: unknown): ParsedHooks {
  if (value === undefined) {
    return { valid: true };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { valid: false };
  }

  const modern = parseModernHooks(value);
  if (modern !== null) {
    return {
      valid: true,
      ...(Object.keys(modern).length === 0 ? {} : { executable: modern }),
    };
  }
  return isValidLegacyHooks(value) ? { valid: true } : { valid: false };
}

function isExtensionInstallMetadata(
  value: unknown,
): value is ExtensionInstallMetadata {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !hasOnlyKeys(value, INSTALL_METADATA_KEYS)
  ) {
    return false;
  }
  const source = Reflect.get(value, 'source');
  const type = Reflect.get(value, 'type');
  const releaseTag = Reflect.get(value, 'releaseTag');
  const ref = Reflect.get(value, 'ref');
  const autoUpdate = Reflect.get(value, 'autoUpdate');
  const allowPreRelease = Reflect.get(value, 'allowPreRelease');
  if (typeof source !== 'string' || source.length === 0) {
    return false;
  }
  if (typeof type !== 'string' || !INSTALL_METADATA_TYPES.has(type)) {
    return false;
  }
  if (!isOptionalString(releaseTag) || !isOptionalString(ref)) {
    return false;
  }
  return isOptionalBoolean(autoUpdate) && isOptionalBoolean(allowPreRelease);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function parseInstallMetadata(
  filePath: string,
  content: string,
): ExtensionInstallMetadata {
  const parsed: unknown = JSON.parse(content);
  if (!isExtensionInstallMetadata(parsed)) {
    throw new Error(`Invalid install metadata shape at ${filePath}`);
  }
  return parsed;
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

/**
 * Extension definition as written to disk in gemini-extension.json files.
 * This should *not* be referenced outside of the logic for reading files.
 * If information is required for manipulating extensions (load, unload, update)
 * outside of the loading process that data needs to be stored on the
 * LlxprtExtension class defined in Core.
 */
interface ExtensionConfig {
  name: string;
  version: string;
  mcpServers?: Record<string, MCPServerConfig>;
  contextFileName?: string | string[];
  excludeTools?: string[];
  hooks?: Record<string, unknown>;
}
function readOptionalExtensionFields(
  value: object,
): Pick<
  ExtensionConfig,
  'mcpServers' | 'contextFileName' | 'excludeTools' | 'hooks'
> {
  const result: Pick<
    ExtensionConfig,
    'mcpServers' | 'contextFileName' | 'excludeTools' | 'hooks'
  > = {};
  const mcpServers = Reflect.get(value, 'mcpServers');
  if (
    typeof mcpServers === 'object' &&
    mcpServers !== null &&
    !Array.isArray(mcpServers)
  ) {
    const validServers: Record<string, MCPServerConfig> = {};
    for (const [serverName, server] of Object.entries(mcpServers)) {
      if (typeof server !== 'object' || server === null) {
        continue;
      }
      const parsedServer = readMcpServerConfig(server);
      if (parsedServer !== undefined) {
        validServers[serverName] = parsedServer;
      }
    }
    result.mcpServers = validServers;
  }
  const contextFileName = Reflect.get(value, 'contextFileName');
  if (
    typeof contextFileName === 'string' ||
    (Array.isArray(contextFileName) &&
      contextFileName.every((entry) => typeof entry === 'string'))
  ) {
    result.contextFileName = contextFileName;
  }
  const excludeTools = Reflect.get(value, 'excludeTools');
  if (
    Array.isArray(excludeTools) &&
    excludeTools.every((entry) => typeof entry === 'string')
  ) {
    result.excludeTools = excludeTools;
  }
  const hooks = Reflect.get(value, 'hooks');
  if (typeof hooks === 'object' && hooks !== null && !Array.isArray(hooks)) {
    result.hooks = Object.fromEntries(Object.entries(hooks));
  }
  return result;
}

/**
 * Extension loading options.
 *
 * `folderTrust` controls whether workspace-scope extensions are loaded.
 * When `folderTrust` is `false`, workspace extensions are NOT loaded — only
 * user (home) extensions are returned. This matches the CLI behavior where
 * untrusted workspaces cannot contribute extensions.
 */
export interface LoadExtensionsOptions {
  folderTrust?: boolean;
}

/**
 * Load extensions from the workspace and user directories.
 *
 * Workspace extensions are gated by `folderTrust`: when the workspace is not
 * trusted, only user (home) extensions are loaded. This prevents untrusted
 * workspaces from contributing extensions with hooks, MCP servers, or context
 * files.
 *
 * @param workspaceDir - The workspace directory to scan for extensions.
 * @param options - Optional folder-trust gating. Explicit false is untrusted.
 */
export function loadExtensions(
  workspaceDir: string,
  options: LoadExtensionsOptions = {},
): LlxprtExtension[] {
  const folderTrusted = options.folderTrust !== false;

  const allExtensions: LlxprtExtension[] = [];

  // Preserve established workspace-before-user scope precedence when trusted.
  if (folderTrusted) {
    allExtensions.push(...loadExtensionsFromDir(workspaceDir, workspaceDir));
  }

  // User (home) extensions are always loaded regardless of folder trust.
  allExtensions.push(...loadExtensionsFromDir(os.homedir(), workspaceDir));

  const uniqueExtensions: LlxprtExtension[] = [];
  const seenNames = new Set<string>();
  for (const extension of allExtensions) {
    if (!seenNames.has(extension.name)) {
      logger.info(
        `Loading extension: ${extension.name} (version: ${extension.version})`,
      );
      uniqueExtensions.push(extension);
      seenNames.add(extension.name);
    }
  }

  return uniqueExtensions;
}

function loadExtensionsFromDir(
  dir: string,
  workspaceDir: string,
): LlxprtExtension[] {
  // LLxprt-first precedence: scan .llxprt/extensions first, then
  // .gemini/extensions. Extensions are deduplicated by name later in
  // loadExtensions, with the first occurrence (LLxprt) winning.
  const extensionRoots = [
    path.join(dir, EXTENSIONS_DIRECTORY_NAME),
    path.join(dir, COMPAT_EXTENSIONS_DIRECTORY_NAME),
  ];

  const extensions: LlxprtExtension[] = [];
  for (const extensionsDir of extensionRoots) {
    // Finding 6: continue to next root if one root fails to load
    const loaded = loadExtensionsFromExtensionDir(extensionsDir, workspaceDir);
    extensions.push(...loaded);
  }
  return extensions;
}

/**
 * Load all extensions from a single extensions root directory. Returns an
 * empty array if the directory does not exist or cannot be read.
 *
 * Finding 6: If root enumeration encounters an error (e.g. permission denied),
 * it logs a diagnostic and continues — it does NOT throw. The caller can
 * proceed with extensions from other roots.
 */
function loadExtensionsFromExtensionDir(
  extensionsDir: string,
  workspaceDir: string,
): LlxprtExtension[] {
  if (!fs.existsSync(extensionsDir)) {
    return [];
  }
  let entries: string[];
  try {
    entries = fs.readdirSync(extensionsDir);
  } catch (e) {
    // Finding 6: continue to next root on enumeration errors
    logger.error(
      `Warning: could not enumerate extensions directory ${extensionsDir}: ${e}`,
    );
    return [];
  }
  return entries
    .map((subdir) =>
      loadExtension(path.join(extensionsDir, subdir), workspaceDir),
    )
    .filter((ext): ext is LlxprtExtension => ext !== null);
}

/**
 * Safely stat a single extension directory entry. Returns null and logs a
 * diagnostic if the entry is a broken symlink or otherwise inaccessible,
 * allowing the scan to continue with remaining entries.
 */
function safeStatDir(extensionDir: string): boolean {
  try {
    return fs.statSync(extensionDir).isDirectory();
  } catch {
    try {
      const lstat = fs.lstatSync(extensionDir);
      if (lstat.isSymbolicLink()) {
        logger.error(
          `Warning: broken symlink ${extensionDir} in extensions directory.`,
        );
      }
    } catch {
      logger.error(
        `Warning: unexpected inaccessible entry ${extensionDir} in extensions directory.`,
      );
    }
    return false;
  }
}

/**
 * Resolve a context file name relative to the extension directory, enforcing
 * relative-only realpath containment. Rejects:
 * - Absolute paths (e.g. `/etc/passwd`)
 * - Parent directory traversal (e.g. `../../etc/passwd`)
 * - Symlink escape (resolved path outside the extension directory)
 * - Sibling escape (resolved path outside the extension directory)
 *
 * Allows:
 * - Simple relative names (e.g. `context.md`)
 * - Current-directory relative names (e.g. `./context.md`)
 * - Nested relative paths within the extension dir (e.g. `docs/context.md`)
 *
 * Returns the resolved path if it is contained within the extension directory,
 * or null if it escapes the extension directory boundary.
 */
function resolveSecureContextPath(
  contextFileName: string,
  extensionDir: string,
): string | null {
  if (path.isAbsolute(contextFileName)) {
    return null;
  }
  const joined = path.join(extensionDir, contextFileName);
  const normalized = path.normalize(joined);
  const normalizedExtDir = path.normalize(extensionDir);
  const extDirWithSep = normalizedExtDir.endsWith(path.sep)
    ? normalizedExtDir
    : normalizedExtDir + path.sep;
  if (
    normalized !== normalizedExtDir &&
    !normalized.startsWith(extDirWithSep)
  ) {
    return null;
  }
  if (fs.existsSync(normalized)) {
    try {
      const realExtDir = fs.realpathSync(normalizedExtDir);
      const realPath = fs.realpathSync(normalized);
      const realExtWithSep = realExtDir.endsWith(path.sep)
        ? realExtDir
        : realExtDir + path.sep;
      if (realPath !== realExtDir && !realPath.startsWith(realExtWithSep)) {
        return null;
      }
    } catch {
      return null;
    }
  }
  return normalized;
}

function loadExtension(
  extensionDir: string,
  workspaceDir: string,
): LlxprtExtension | null {
  if (!safeStatDir(extensionDir)) {
    return null;
  }

  // Metadata-first: read install metadata before looking for the manifest.
  // This supports the real CLI link layout where the registration directory
  // contains only the metadata file (.llxprt-extension-install.json or
  // .gemini-extension-install.json), and the manifest/assets live in
  // metadata.source. The effective source path is derived from metadata,
  // while the physical registration identity (extensionDir) is preserved for
  // uninstall and directory enumeration.
  const installMetadata = loadInstallMetadata(extensionDir);
  if (
    installMetadata === MALFORMED_METADATA ||
    installMetadata === MALFORMED_FALLBACK_METADATA
  ) {
    // Primary or fallback metadata exists but is malformed — stop, do not
    // load the extension with missing/corrupt metadata.
    return null;
  }

  // Derive effective source: for link-type extensions the manifest and
  // assets are in metadata.source. For all other types (or when no metadata
  // is present), use the registration directory.
  const effectivePath =
    installMetadata?.type === 'link' ? installMetadata.source : extensionDir;

  // Look for manifest in the effective source path, not the registration dir.
  let configFilePath = path.join(effectivePath, EXTENSIONS_CONFIG_FILENAME);
  if (!fs.existsSync(configFilePath)) {
    configFilePath = path.join(
      effectivePath,
      EXTENSIONS_CONFIG_FILENAME_FALLBACK,
    );
  }
  if (!fs.existsSync(configFilePath)) {
    logger.error(
      `Warning: extension directory ${effectivePath} does not contain a config file (${EXTENSIONS_CONFIG_FILENAME} or ${EXTENSIONS_CONFIG_FILENAME_FALLBACK}).`,
    );
    return null;
  }

  return loadExtensionConfig(
    configFilePath,
    effectivePath,
    workspaceDir,
    installMetadata,
  );
}

function hydrateHookValue(
  value: unknown,
  extensionPath: string,
  workspacePath: string,
): unknown {
  if (typeof value === 'string') {
    return value
      .replaceAll('${extensionPath}', extensionPath)
      .replaceAll('${workspacePath}', workspacePath)
      .replaceAll('${pathSeparator}', path.sep)
      .replaceAll('${/}', path.sep);
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      hydrateHookValue(entry, extensionPath, workspacePath),
    );
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      hydrateHookValue(entry, extensionPath, workspacePath),
    ]),
  );
}

function loadExecutableHooksFile(
  effectivePath: string,
  workspaceDir: string,
  manifestHooks: ParsedHooks,
): ParsedHooks {
  const hooksFilePath = path.join(effectivePath, 'hooks', 'hooks.json');
  if (!fs.existsSync(hooksFilePath)) {
    return manifestHooks;
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(hooksFilePath, 'utf-8'));
    const hydrated = hydrateHookValue(parsed, effectivePath, workspaceDir);
    if (
      typeof hydrated !== 'object' ||
      hydrated === null ||
      Array.isArray(hydrated)
    ) {
      return { valid: false };
    }
    const hooks = Reflect.get(hydrated, 'hooks');
    return hooks === undefined ? manifestHooks : parseManifestHooks(hooks);
  } catch (error) {
    logger.error(`Failed to parse hooks file ${hooksFilePath}: ${error}`);
    return { valid: false };
  }
}

function loadContextFiles(
  config: ExtensionConfig,
  effectivePath: string,
): string[] {
  return getContextFileNames(config)
    .map((contextFileName) => {
      const resolved = resolveSecureContextPath(contextFileName, effectivePath);
      if (resolved === null) {
        return null;
      }
      return fs.existsSync(resolved) ? resolved : null;
    })
    .filter((contextFile): contextFile is string => contextFile !== null);
}

function loadExtensionConfig(
  configFilePath: string,
  effectivePath: string,
  workspaceDir: string,
  installMetadata: ExtensionInstallMetadata | undefined,
): LlxprtExtension | null {
  try {
    const parsedConfig: unknown = JSON.parse(
      fs.readFileSync(configFilePath, 'utf-8'),
    );
    if (
      typeof parsedConfig !== 'object' ||
      parsedConfig === null ||
      Array.isArray(parsedConfig)
    ) {
      logger.error(
        `Invalid extension config in ${configFilePath}: expected an object.`,
      );
      return null;
    }
    const name = Reflect.get(parsedConfig, 'name');
    const version = Reflect.get(parsedConfig, 'version');
    if (
      typeof name !== 'string' ||
      typeof version !== 'string' ||
      !name ||
      !version
    ) {
      logger.error(
        `Invalid extension config in ${configFilePath}: missing name or version.`,
      );
      return null;
    }
    const manifestHooks = parseManifestHooks(
      Reflect.get(parsedConfig, 'hooks'),
    );
    const hooks = loadExecutableHooksFile(
      effectivePath,
      workspaceDir,
      manifestHooks,
    );
    if (!hooks.valid) {
      logger.error(
        `Invalid hooks for extension config ${configFilePath}: hooks must match either the modern event schema or the legacy named-hook schema.`,
      );
      return null;
    }
    const config: ExtensionConfig = {
      name,
      version,
      ...readOptionalExtensionFields(parsedConfig),
    };

    const contextFiles = loadContextFiles(config, effectivePath);

    return {
      name: config.name,
      version: config.version,
      path: effectivePath,
      contextFiles,
      installMetadata,
      mcpServers: config.mcpServers,
      excludeTools: config.excludeTools,
      hooks: hooks.executable,
      isActive: true, // Barring any other signals extensions should be considered Active.
    };
  } catch (e) {
    logger.error(
      `Warning: error parsing extension config in ${configFilePath}: ${e}`,
    );
    return null;
  }
}

function getContextFileNames(config: ExtensionConfig): string[] {
  if (config.contextFileName === undefined || config.contextFileName === '') {
    return ['LLXPRT.md', 'GEMINI.md'];
  } else if (!Array.isArray(config.contextFileName)) {
    return [config.contextFileName];
  }
  return config.contextFileName;
}

/**
 * Sentinel value returned by loadInstallMetadata when the primary metadata
 * file exists but is malformed. Distinct from undefined (absent/valid fallback)
 * so the caller can stop rather than silently loading with no metadata.
 */
const MALFORMED_METADATA: unique symbol = Symbol('malformed-metadata');
type MalformedMetadataSentinel = typeof MALFORMED_METADATA;

/**
 * Sentinel value returned by loadInstallMetadata when the fallback metadata
 * file exists but is malformed. Distinct from undefined (absent) so the caller
 * can skip the extension rather than silently loading with no metadata.
 * Only an ENOENT (file absent) condition returns undefined.
 */
const MALFORMED_FALLBACK_METADATA: unique symbol = Symbol(
  'malformed-fallback-metadata',
);
type MalformedFallbackMetadataSentinel = typeof MALFORMED_FALLBACK_METADATA;

/** Union type for any malformed-metadata sentinel. */
type MalformedSentinel =
  | MalformedMetadataSentinel
  | MalformedFallbackMetadataSentinel;

/**
 * Error thrown when primary install metadata exists but is malformed (e.g.
 * invalid JSON). This is distinct from ENOENT (file not found), which should
 * trigger the fallback path. A malformed primary file must stop loading
 * rather than silently falling back.
 */
export class MalformedMetadataError extends Error {
  constructor(
    message: string,
    readonly filePath: string,
  ) {
    super(message);
    this.name = 'MalformedMetadataError';
  }
}

export function loadInstallMetadata(
  extensionDir: string,
  readTextFile: (filePath: string, encoding: 'utf-8') => string = (
    filePath,
    encoding,
  ) => fs.readFileSync(filePath, encoding),
): ExtensionInstallMetadata | undefined | MalformedSentinel {
  // Prefer .llxprt-extension-install.json, then fall back to
  // .gemini-extension-install.json for gemini-cli compatibility.
  // If the primary file exists but is malformed, report and stop — do NOT
  // silently fall back. Fallback only happens when the primary is absent.
  const metadataFilePath = path.join(extensionDir, INSTALL_METADATA_FILENAME);
  if (fs.existsSync(metadataFilePath)) {
    try {
      const configContent = readTextFile(metadataFilePath, 'utf-8');
      return parseInstallMetadata(metadataFilePath, configContent);
    } catch (e) {
      if (getErrorCode(e) !== 'ENOENT') {
        logger.error(
          `Failed to parse install metadata at ${metadataFilePath}: ${e}`,
        );
        return MALFORMED_METADATA;
      }
    }
  }
  const fallbackPath = path.join(
    extensionDir,
    INSTALL_METADATA_FILENAME_FALLBACK,
  );
  if (!fs.existsSync(fallbackPath)) {
    return undefined;
  }
  try {
    const configContent = readTextFile(fallbackPath, 'utf-8');
    return parseInstallMetadata(fallbackPath, configContent);
  } catch (e) {
    // Malformed/inaccessible fallback metadata is distinct from ENOENT.
    // Only a truly absent file (ENOENT) should be treated as "no metadata"
    // and allow loading. Malformed JSON, EACCES, or other I/O errors must
    // name the fallback file in the diagnostic and skip the extension,
    // matching the primary metadata safety contract.
    if (getErrorCode(e) === 'ENOENT') {
      // File was removed between existsSync and readFileSync — treat as absent
      return undefined;
    }
    logger.error(
      `Failed to parse fallback install metadata at ${fallbackPath}: ${e}`,
    );
    return MALFORMED_FALLBACK_METADATA;
  }
}
