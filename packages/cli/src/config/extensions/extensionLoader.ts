import {
  type LlxprtExtension,
  getErrorMessage,
  type MCPServerConfig,
  type SkillDefinition,
  loadSkillsFromDirSync,
} from '@vybestack/llxprt-code-core';
import * as fs from 'fs';
import * as path from 'path';
import { resolveEnvVarsInObject } from '../../utils/envVarResolver.js';
import {
  hydrateString,
  recursivelyHydrateStrings,
  type JsonValue,
  type VariableContext,
} from './variables.js';
import type { LoadExtensionContext } from './variableSchema.js';
import { getExecutableHooks, validateHooks } from './hookSchema.js';
import type {
  ExtensionConfig,
  ExtensionInstallMetadata,
} from '../extension.js';

function isExtensionConfig(value: unknown): value is ExtensionConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { version?: unknown }).version === 'string'
  );
}

function parseJsonValue(content: string): JsonValue {
  return JSON.parse(content) as JsonValue;
}
interface LoadExtensionDeps {
  configFileName: string;
  fallbackConfigFileName: string;

  installMetadataFileName: string;
  fallbackInstallMetadataFileName?: string;
  loadSettings: (workspaceDir: string) => { merged: Record<string, unknown> };
  validateName: (name: string) => void;
  reportError: (message: string) => void;
  reportWarning: (message: string) => void;
}

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

function isExtensionInstallMetadata(
  value: unknown,
): value is ExtensionInstallMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  if (!Object.keys(value).every((key) => INSTALL_METADATA_KEYS.has(key))) {
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

function hydrateSkillDefinition(
  skill: SkillDefinition,
  context: VariableContext,
): SkillDefinition {
  return {
    ...skill,
    name: hydrateString(skill.name, context),
    description: hydrateString(skill.description, context),
    location: hydrateString(skill.location, context),
    body: hydrateString(skill.body, context),
  };
}
export function loadInstallMetadataFromDir(
  extensionDir: string,
  installMetadataFileName: string,
  fallbackInstallMetadataFileName?: string,
  readTextFile: (filePath: string, encoding: 'utf-8') => string = (
    filePath,
    encoding,
  ) => fs.readFileSync(filePath, encoding),
): ExtensionInstallMetadata | undefined {
  const metadataFilePath = path.join(extensionDir, installMetadataFileName);
  if (fs.existsSync(metadataFilePath)) {
    try {
      const configContent = readTextFile(metadataFilePath, 'utf-8');
      return parseInstallMetadata(metadataFilePath, configContent);
    } catch (error) {
      if (getErrorCode(error) !== 'ENOENT') {
        throw new MalformedMetadataError(
          `Failed to parse install metadata at ${metadataFilePath}: ${getErrorMessage(error)}`,
          metadataFilePath,
        );
      }
    }
  }
  // Primary metadata does not exist — fall back only on ENOENT.
  if (fallbackInstallMetadataFileName !== undefined) {
    const fallbackPath = path.join(
      extensionDir,
      fallbackInstallMetadataFileName,
    );
    if (!fs.existsSync(fallbackPath)) {
      return undefined;
    }
    try {
      const configContent = readTextFile(fallbackPath, 'utf-8');
      return parseInstallMetadata(fallbackPath, configContent);
    } catch (error) {
      // Only ENOENT (file absent) means absent. Malformed JSON, EACCES,
      // or other I/O errors must throw MalformedMetadataError so the caller
      // skips the extension, matching the primary metadata safety contract.
      if (getErrorCode(error) === 'ENOENT') {
        // File was removed between existsSync and readFileSync — treat as absent
        return undefined;
      }
      throw new MalformedMetadataError(
        `Failed to parse or read fallback install metadata at ${fallbackPath}: ${getErrorMessage(error)}`,
        fallbackPath,
      );
    }
  }
  return undefined;
}

function filterMcpConfig(original: MCPServerConfig): MCPServerConfig {
  const { trust: _trust, ...rest } = original;
  return Object.freeze(rest);
}

/**
 * Default context file names consulted when an extension manifest omits
 * `contextFileName`. LLXPRT.md is the canonical name; GEMINI.md is retained
 * for gemini-cli compatibility so legacy extensions without an explicit
 * `contextFileName` still surface their context file.
 */
const DEFAULT_CONTEXT_FILE_NAMES: readonly string[] = [
  'LLXPRT.md',
  'GEMINI.md',
];

function getContextFileNames(config: ExtensionConfig): string[] {
  if (config.contextFileName === undefined || config.contextFileName === '') {
    return [...DEFAULT_CONTEXT_FILE_NAMES];
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
  const hydratedConfig = recursivelyHydrateStrings(
    parseJsonValue(configContent),
    {
      extensionPath: effectiveExtensionPath,
      workspacePath: workspaceDir,
      '/': path.sep,
      pathSeparator: path.sep,
    },
  );
  if (!isExtensionConfig(hydratedConfig)) {
    deps.reportError(
      `Invalid extension config in ${configFilePath}: missing name or version.`,
    );
    return null;
  }
  let config = hydratedConfig;
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
  if (config.hooks !== undefined) {
    config.hooks = validateHooks(config.hooks);
  }
  return config;
}

const EXTENSION_HOOKS_FILE = path.join('hooks', 'hooks.json');

function loadExecutableExtensionHooks(
  effectiveExtensionPath: string,
  workspaceDir: string,
  manifestHooks: ExtensionConfig['hooks'],
): LlxprtExtension['hooks'] {
  const hooksFilePath = path.join(effectiveExtensionPath, EXTENSION_HOOKS_FILE);
  if (!fs.existsSync(hooksFilePath)) {
    return getExecutableHooks(manifestHooks);
  }

  const content = fs.readFileSync(hooksFilePath, 'utf-8');
  const hydrated = recursivelyHydrateStrings(parseJsonValue(content), {
    extensionPath: effectiveExtensionPath,
    workspacePath: workspaceDir,
    '/': path.sep,
    pathSeparator: path.sep,
  });
  if (
    typeof hydrated !== 'object' ||
    hydrated === null ||
    Array.isArray(hydrated)
  ) {
    throw new Error(`Invalid hooks configuration in ${hooksFilePath}`);
  }
  const hooks = Reflect.get(hydrated, 'hooks');
  return getExecutableHooks(validateHooks(hooks));
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
export function resolveSecureContextPath(
  contextFileName: string,
  extensionDir: string,
): string | null {
  // Reject absolute paths immediately.
  if (path.isAbsolute(contextFileName)) {
    return null;
  }

  // Join the relative path against the extension dir.
  const joined = path.join(extensionDir, contextFileName);

  // Normalize to resolve any `..` and `.` segments.
  const normalized = path.normalize(joined);

  // Ensure the normalized path is still within the extension directory.
  // We compare the normalized extension dir + separator to catch sibling
  // escapes (e.g. `../other-dir/file.md`).
  const normalizedExtDir = path.normalize(extensionDir);
  const extDirWithSep = normalizedExtDir.endsWith(path.sep)
    ? normalizedExtDir
    : normalizedExtDir + path.sep;

  // The path must be either the extension dir itself or a descendant.
  if (
    normalized !== normalizedExtDir &&
    !normalized.startsWith(extDirWithSep)
  ) {
    return null;
  }

  // If the file exists, also check realpath to prevent symlink escape.
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
      // realpath failed — treat as unsafe
      return null;
    }
  }

  return normalized;
}

function loadContextFiles(
  config: ExtensionConfig,
  effectiveExtensionPath: string,
): string[] {
  return getContextFileNames(config)
    .map((contextFileName) => {
      const resolved = resolveSecureContextPath(
        contextFileName,
        effectiveExtensionPath,
      );
      if (resolved === null) {
        return null;
      }
      return fs.existsSync(resolved) ? resolved : null;
    })
    .filter((p): p is string => p !== null);
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
  return rawSkills.map((skill) =>
    hydrateSkillDefinition(skill, hydrationContext),
  );
}

/**
 * Result of validating an extension directory entry.
 * - `'valid'` — the entry is a usable directory.
 * - `'invalid'` — the entry is an unexpected file type.
 * - `'skip'` — the entry is broken/inaccessible and should be silently skipped.
 */
type DirValidationResult = 'valid' | 'invalid' | 'skip';

/**
 * Validate that an extension directory entry is a usable directory.
 * Uses lstatSync to safely handle broken symlinks without throwing, then
 * follows symlinks to confirm the target is a directory.
 */
function validateExtensionDir(
  extensionDir: string,
  deps: LoadExtensionDeps,
): DirValidationResult {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(extensionDir);
  } catch {
    deps.reportWarning(
      `Warning: broken or inaccessible entry ${extensionDir} in extensions directory. Skipping.`,
    );
    return 'skip';
  }
  if (stat.isSymbolicLink()) {
    try {
      const target = fs.statSync(extensionDir);
      if (!target.isDirectory()) {
        deps.reportError(
          `Warning: unexpected file ${extensionDir} in extensions directory.`,
        );
        return 'invalid';
      }
    } catch {
      deps.reportWarning(
        `Warning: broken symlink ${extensionDir} in extensions directory. Skipping.`,
      );
      return 'skip';
    }
    return 'valid';
  }
  if (!stat.isDirectory()) {
    deps.reportError(
      `Warning: unexpected file ${extensionDir} in extensions directory.`,
    );
    return 'invalid';
  }
  return 'valid';
}

/**
 * Load install metadata, converting MalformedMetadataError into a special
 * sentinel so the caller can stop loading rather than proceeding as if
 * metadata were absent. Re-throws any other error.
 */
const MALFORMED_SENTINEL: unique symbol = Symbol('malformed-metadata');
type MalformedSentinel = typeof MALFORMED_SENTINEL;

function loadMetadataOrSentinel(
  extensionDir: string,
  deps: LoadExtensionDeps,
): ExtensionInstallMetadata | undefined | MalformedSentinel {
  try {
    return loadInstallMetadataFromDir(
      extensionDir,
      deps.installMetadataFileName,
      deps.fallbackInstallMetadataFileName,
    );
  } catch (error) {
    if (error instanceof MalformedMetadataError) {
      deps.reportError(
        `Warning: Skipping extension ${extensionDir}: ${error.message}`,
      );
      return MALFORMED_SENTINEL;
    }
    throw error;
  }
}

export function loadExtensionFromDir(
  context: LoadExtensionContext,
  deps: LoadExtensionDeps,
): LlxprtExtension | null {
  const { extensionDir, workspaceDir } = context;

  const dirStatus = validateExtensionDir(extensionDir, deps);
  if (dirStatus === 'skip' || dirStatus === 'invalid') {
    return null;
  }

  const metadataResult = loadMetadataOrSentinel(extensionDir, deps);
  if (metadataResult === MALFORMED_SENTINEL) {
    return null;
  }
  const installMetadata = metadataResult;
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
    const resolvedSettings: Array<Record<string, unknown>> = [];

    return {
      name: config.name,
      version: config.version,
      path: effectiveExtensionPath,
      contextFiles: loadContextFiles(config, effectiveExtensionPath),
      installMetadata,
      mcpServers: config.mcpServers,
      excludeTools: config.excludeTools,
      hooks: loadExecutableExtensionHooks(
        effectiveExtensionPath,
        workspaceDir,
        config.hooks,
      ),
      skills: loadExtensionSkills(effectiveExtensionPath, workspaceDir),
      subagents: config.subagents ?? [],
      isActive: true,
      settings: config.settings as Array<Record<string, unknown>> | undefined,
      resolvedSettings,
    };
  } catch (error) {
    deps.reportError(
      `Warning: Skipping extension config ${configFilePath}: ${getErrorMessage(error)}`,
    );
    return null;
  }
}
