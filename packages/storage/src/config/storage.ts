/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as fs from 'fs';
import {
  resolveGlobalConfigDir as resolveGlobalConfigDirShared,
  resolveGlobalDataDir as resolveGlobalDataDirShared,
  resolveGlobalCacheDir as resolveGlobalCacheDirShared,
  resolveGlobalLogDir as resolveGlobalLogDirShared,
  resolveEnvOverride,
} from './path-resolver.js';

export const LLXPRT_DIR = '.llxprt';
export const AGENTS_DIR = '.agents';
export const PROVIDER_ACCOUNTS_FILENAME = 'provider_accounts.json';
export const OAUTH_FILE = 'oauth_creds.json';
const TMP_DIR_NAME = 'tmp';

/**
 * Resolves a system-wide settings env override (absolute-path validity).
 * System settings use a distinct env-var family (`LLXPRT_SYSTEM_*`) from the
 * XDG-category overrides consumed by the shared path-resolver, so this
 * helper remains local to Storage (the shared resolver is the authority for
 * the four XDG-category dirs; system settings are bounded here so there is
 * no duplicate algorithm elsewhere).
 */
function resolveSystemSettingsEnv(raw: string | undefined): string | undefined {
  return resolveEnvOverride(raw);
}

/**
 * Resolves an environment-variable override, falling back to a secondary
 * override (for backward compat) and then to the platform default.
 *
 * Delegated to the shared {@link resolveEnvOverride} /
 * {@link resolveCanonicalDir} authority in `path-resolver.ts`
 * (ONE implementation, no duplication). Retained here only as the
 * private bridge so the public `Storage.getGlobal*Dir()` surface continues
 * to own the application-facing contract.
 */

export class Storage {
  private readonly targetDir: string;

  constructor(targetDir: string) {
    this.targetDir = targetDir;
  }

  /**
   * Platform-standard directory for user-editable **configuration** files.
   *
   * Override precedence:
   * 1. `LLXPRT_CONFIG_HOME` environment variable
   * 2. `envPaths('llxprt-code').config`
   *
   * Linux: `~/.config/llxprt-code`
   * macOS: `~/Library/Preferences/llxprt-code`
   * Windows: `%APPDATA%\llxprt-code\Config`
   */
  static getGlobalConfigDir(): string {
    return resolveGlobalConfigDirShared();
  }

  /**
   * Platform-standard directory for app-managed **data** files (credentials,
   * state, conversations, history).
   *
   * Override precedence:
   * 1. `LLXPRT_DATA_HOME` environment variable
   * 2. `LLXPRT_CONFIG_HOME` (backward-compat fallback)
   * 3. `envPaths('llxprt-code').data`
   *
   * Linux: `~/.local/share/llxprt-code`
   * macOS: `~/Library/Application Support/llxprt-code`
   * Windows: `%LOCALAPPDATA%\llxprt-code\Data`
   */
  static getGlobalDataDir(): string {
    return resolveGlobalDataDirShared();
  }

  /**
   * Platform-standard directory for non-essential **cache** files.
   *
   * Override precedence:
   * 1. `LLXPRT_CACHE_HOME` environment variable
   * 2. `LLXPRT_CONFIG_HOME` (backward-compat fallback)
   * 3. `envPaths('llxprt-code').cache`
   *
   * Linux: `~/.cache/llxprt-code`
   * macOS: `~/Library/Caches/llxprt-code`
   * Windows: `%LOCALAPPDATA%\llxprt-code\Cache`
   */
  static getGlobalCacheDir(): string {
    return resolveGlobalCacheDirShared();
  }

  /**
   * Platform-standard directory for **log/state** files (debug logs,
   * undo checkpoints, runtime state).
   *
   * Override precedence:
   * 1. `LLXPRT_LOG_HOME` environment variable
   * 2. `LLXPRT_CONFIG_HOME` (backward-compat fallback)
   * 3. `envPaths('llxprt-code').log`
   *
   * Linux: `~/.local/state/llxprt-code`
   * macOS: `~/Library/Logs/llxprt-code`
   * Windows: `%LOCALAPPDATA%\llxprt-code\Log`
   */
  static getGlobalLogDir(): string {
    return resolveGlobalLogDirShared();
  }

  /**
   * @deprecated Use {@link getGlobalConfigDir} or {@link getGlobalDataDir}
   * instead. Retained as an alias to the config dir for migration purposes.
   * Will be removed once all consumers are updated.
   */
  static getGlobalLlxprtDir(): string {
    return Storage.getGlobalConfigDir();
  }

  /**
   * Returns the legacy global configuration directory (`~/.llxprt`).
   * Used solely by the startup migration logic to detect and copy
   * pre-migration configuration into the new platform-standard paths.
   */
  static getLegacyLlxprtDir(): string {
    const homeDir = os.homedir();
    if (!homeDir) {
      return path.join(os.tmpdir(), '.llxprt');
    }
    return path.join(homeDir, LLXPRT_DIR);
  }

  // ── Config-category paths ───────────────────────────────────────────

  static getGlobalSettingsPath(): string {
    return path.join(Storage.getGlobalConfigDir(), 'settings.json');
  }

  static getUserCommandsDir(): string {
    return path.join(Storage.getGlobalConfigDir(), 'commands');
  }

  static getUserSkillsDir(): string {
    return path.join(Storage.getGlobalConfigDir(), 'skills');
  }

  /**
   * Returns the global `.agents/` directory under the user's home directory,
   * matching the cross-tool Agent Skills open standard
   * (https://agentskills.io). Always resolved against `os.homedir()` so it
   * never falls back to a world-writable temp directory. If the home
   * directory cannot be determined, this throws rather than silently
   * resolving to a relative or temp path (fail-closed for security).
   */
  static getGlobalAgentsDir(): string {
    const homeDir = os.homedir();
    if (!homeDir || !path.isAbsolute(homeDir)) {
      throw new Error(
        'Unable to resolve user home directory for .agents skills; refusing to fall back to a relative or temp path.',
      );
    }
    return path.join(homeDir, AGENTS_DIR);
  }

  /**
   * Returns the user-level skills directory under the cross-tool
   * `.agents/skills/` standard (https://agentskills.io), enabling
   * interoperability with tools like `npx skills add`.
   */
  static getUserAgentSkillsDir(): string {
    return path.join(Storage.getGlobalAgentsDir(), 'skills');
  }

  static getUserPoliciesDir(): string {
    return path.join(Storage.getGlobalConfigDir(), 'policies');
  }

  // ── Data-category paths ─────────────────────────────────────────────

  static getMcpOAuthTokensPath(): string {
    return path.join(Storage.getGlobalDataDir(), 'mcp-oauth-tokens.json');
  }

  static getInstallationIdPath(): string {
    return path.join(Storage.getGlobalDataDir(), 'installation_id');
  }

  static getMachineSecretPath(): string {
    return path.join(Storage.getGlobalDataDir(), 'machine_secret');
  }

  static getProviderAccountsPath(): string {
    return path.join(Storage.getGlobalDataDir(), PROVIDER_ACCOUNTS_FILENAME);
  }

  static getGoogleAccountsPath(): string {
    return path.join(Storage.getGlobalDataDir(), 'google_accounts.json');
  }

  static getOAuthCredsPath(): string {
    return path.join(Storage.getGlobalDataDir(), OAUTH_FILE);
  }

  /**
   * App-managed user (global) extensions directory.
   *
   * Extensions installed by the user live under the data category so they
   * survive cache clears and are not treated as user-editable config.
   *
   * Override precedence (inherited from {@link getGlobalDataDir}):
   * 1. `LLXPRT_DATA_HOME`
   * 2. `LLXPRT_CONFIG_HOME` (backward-compat fallback)
   * 3. platform data dir
   */
  static getUserExtensionsDir(): string {
    return path.join(Storage.getGlobalDataDir(), 'extensions');
  }

  /**
   * Directory holding global memory/context files (`LLXPRT.md` variants and
   * `.LLXPRT_SYSTEM`).
   *
   * These files are directly user-editable, so they belong to the config
   * category. This directory is owned by Storage; the concrete filenames
   * (which are runtime-configurable via `contextFileName`) are owned by the
   * tools package.
   *
   * Override precedence (inherited from {@link getGlobalConfigDir}):
   * 1. `LLXPRT_CONFIG_HOME`
   * 2. platform config dir
   */
  static getGlobalMemoryDir(): string {
    return Storage.getGlobalConfigDir();
  }

  /**
   * OAuth advisory lock directory.
   *
   * Refresh/auth advisory locks are non-secret ephemeral runtime state and
   * therefore belong to the log/state category. They contain no credentials.
   *
   * Override precedence (inherited from {@link getGlobalLogDir}):
   * 1. `LLXPRT_LOG_HOME`
   * 2. `LLXPRT_CONFIG_HOME` (backward-compat fallback)
   * 3. platform log/state dir
   */
  static getOAuthLocksDir(): string {
    return path.join(Storage.getGlobalLogDir(), 'oauth', 'locks');
  }

  /**
   * Credential write advisory lock directory.
   *
   * Per-item credential write locks are non-secret ephemeral runtime state
   * and therefore belong to the log/state category, alongside
   * {@link getOAuthLocksDir}. They contain no credentials — only owner
   * identity metadata (pid, hostname, start time) used to detect dead owners.
   *
   * The lock root is derived from stable, version-independent path authority
   * so mixed-version fleets serialize against the same files (R4).
   *
   * SERIALIZATION ASSUMPTION: serialization only holds between processes
   * that resolve the SAME lock root. Processes run with different
   * `LLXPRT_LOG_HOME`/`LLXPRT_CONFIG_HOME` values address the same OS
   * keychain item through disjoint lock roots and will NOT serialize —
   * their writes may interleave.
   *
   * Override precedence (inherited from {@link getGlobalLogDir}):
   * 1. `LLXPRT_LOG_HOME`
   * 2. `LLXPRT_CONFIG_HOME` (backward-compat fallback)
   * 3. platform log/state dir
   */
  static getCredentialLocksDir(): string {
    return path.join(Storage.getGlobalLogDir(), 'secure-store', 'locks');
  }

  // ── System settings (system-wide, not user-specific) ────

  /**
   * Canonical system-wide settings path.
   *
   * This is the SINGLE authority for the system settings path. Both the CLI
   * settings loader and the policy engine resolve through here so they agree.
   *
   * Override precedence:
   * 1. `LLXPRT_SYSTEM_SETTINGS_PATH` (canonical) — non-empty absolute path
   * 2. `LLXPRT_CODE_SYSTEM_SETTINGS_PATH` (legacy compatibility alias) —
   *      non-empty absolute path. Bounded: honored only here inside Storage
   *      so there is no duplicate algorithm elsewhere.
   * 3. Platform default
   *
   * Platform defaults:
   *   macOS:  `/Library/Application Support/LlxprtCode/settings.json`
   *   Windows: `C:\ProgramData\llxprt-code\settings.json`
   *   Linux:   `/etc/llxprt-code/settings.json`
   */
  static getSystemSettingsPath(): string {
    const canonical = resolveSystemSettingsEnv(
      process.env['LLXPRT_SYSTEM_SETTINGS_PATH'],
    );
    if (canonical !== undefined) {
      return canonical;
    }
    const legacyAlias = resolveSystemSettingsEnv(
      process.env['LLXPRT_CODE_SYSTEM_SETTINGS_PATH'],
    );
    if (legacyAlias !== undefined) {
      return legacyAlias;
    }
    if (os.platform() === 'darwin') {
      return '/Library/Application Support/LlxprtCode/settings.json';
    } else if (os.platform() === 'win32') {
      return 'C:\\ProgramData\\llxprt-code\\settings.json';
    }
    return '/etc/llxprt-code/settings.json';
  }

  /**
   * System-wide defaults path (sibling of the system settings file).
   *
   * Override precedence:
   * 1. `LLXPRT_SYSTEM_DEFAULTS_PATH` (canonical) — non-empty absolute path
   * 2. `LLXPRT_CODE_SYSTEM_DEFAULTS_PATH` (legacy compatibility alias)
   * 3. Sibling `system-defaults.json` next to {@link getSystemSettingsPath}
   */
  static getSystemDefaultsPath(): string {
    const canonical = resolveSystemSettingsEnv(
      process.env['LLXPRT_SYSTEM_DEFAULTS_PATH'],
    );
    if (canonical !== undefined) {
      return canonical;
    }
    const legacyAlias = resolveSystemSettingsEnv(
      process.env['LLXPRT_CODE_SYSTEM_DEFAULTS_PATH'],
    );
    if (legacyAlias !== undefined) {
      return legacyAlias;
    }
    return path.join(
      path.dirname(Storage.getSystemSettingsPath()),
      'system-defaults.json',
    );
  }

  static getSystemPoliciesDir(): string {
    return path.join(path.dirname(Storage.getSystemSettingsPath()), 'policies');
  }

  /**
   * Override-validity contract shared across all `LLXPRT_*_HOME` and
   * `LLXPRT_SYSTEM_SETTINGS_PATH` resolution.
   *
   * A category override (or compatibility config override) is honored only
   * when it is a non-empty absolute path. Relative, blank, and
   * whitespace-only values are ignored in favor of the platform default /
   * env-paths resolution, exactly matching the behavior of the private
   * `resolveSystemSettingsEnv` helper used by {@link resolveDir} and
   * {@link getSystemSettingsPath}.
   *
   * Exposed publicly so non-Storage consumers (e.g. the CLI startup
   * migration orchestrator) can reuse the exact same validity contract
   * instead of approximating it with a raw truthiness check.
   */
  static isNonEmptyAbsoluteOverride(value: string | undefined): boolean {
    return resolveSystemSettingsEnv(value) !== undefined;
  }

  // ── Log/state-category paths ────────────────────────────────────────

  static getGlobalTempDir(): string {
    return path.join(Storage.getGlobalLogDir(), TMP_DIR_NAME);
  }

  getLlxprtDir(): string {
    return path.join(this.targetDir, LLXPRT_DIR);
  }

  getProjectTempDir(): string {
    const hash = this.getFilePathHash(this.getProjectRoot());
    const tempDir = Storage.getGlobalTempDir();
    return path.join(tempDir, hash);
  }

  ensureProjectTempDirExists(): void {
    fs.mkdirSync(this.getProjectTempDir(), { recursive: true });
  }

  getProjectRoot(): string {
    return this.targetDir;
  }

  private getFilePathHash(filePath: string): string {
    return crypto.createHash('sha256').update(filePath).digest('hex');
  }

  getHistoryDir(): string {
    const hash = this.getFilePathHash(this.getProjectRoot());
    const historyDir = path.join(Storage.getGlobalDataDir(), 'history');
    return path.join(historyDir, hash);
  }

  getWorkspaceSettingsPath(): string {
    return path.join(this.getLlxprtDir(), 'settings.json');
  }

  getProjectCommandsDir(): string {
    return path.join(this.getLlxprtDir(), 'commands');
  }

  getProjectSkillsDir(): string {
    return path.join(this.getLlxprtDir(), 'skills');
  }

  /**
   * Returns the workspace-local `.agents/` directory, matching the cross-tool
   * Agent Skills open standard (https://agentskills.io).
   */
  getAgentsDir(): string {
    return path.join(this.targetDir, AGENTS_DIR);
  }

  /**
   * Returns the workspace-local skills directory under the cross-tool
   * `.agents/skills/` standard (https://agentskills.io), enabling
   * interoperability with tools like `npx skills add`.
   */
  getProjectAgentSkillsDir(): string {
    return path.join(this.getAgentsDir(), 'skills');
  }

  getProjectTempCheckpointsDir(): string {
    return path.join(this.getProjectTempDir(), 'checkpoints');
  }

  /**
   * The single source of truth for the chats directory, where session
   * recordings/persistence files live (`<projectTempDir>/chats`). Every
   * consumer (session recording, resume probes, session cleanup, chat
   * persistence) must derive the path through this helper so the writers and
   * the readers/probes can never drift apart on the location.
   */
  getProjectChatsDir(): string {
    return path.join(this.getProjectTempDir(), 'chats');
  }

  getExtensionsDir(): string {
    return path.join(this.getLlxprtDir(), 'extensions');
  }

  getExtensionsConfigPath(): string {
    return path.join(this.getExtensionsDir(), 'llxprt-extension.json');
  }

  getHistoryFilePath(): string {
    return path.join(this.getProjectTempDir(), 'shell_history');
  }
}
