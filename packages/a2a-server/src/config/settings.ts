/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { MCPServerConfig } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-core';
import {
  getErrorMessage,
  LLXPRT_CONFIG_DIR,
  type TelemetrySettings,
} from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-storage';
import stripJsonComments from 'strip-json-comments';

export const SETTINGS_DIRECTORY_NAME = LLXPRT_CONFIG_DIR;

/**
 * Resolves the user (global) settings path through the central Storage path
 * authority, honoring `LLXPRT_CONFIG_HOME` and the platform config directory.
 * This keeps A2A parity with the CLI, which already resolves user settings via
 * `Storage.getGlobalSettingsPath()`.
 */
function getUserSettingsPath(): string {
  return Storage.getGlobalSettingsPath();
}

// Reconcile with https://github.com/google-gemini/gemini-cli/blob/b09bc6656080d4d12e1d06734aae2ec33af5c1ed/packages/cli/src/config/settings.ts#L53
export interface Settings {
  mcpServers?: Record<string, MCPServerConfig>;
  coreTools?: string[];
  excludeTools?: string[];
  telemetry?: TelemetrySettings;
  showMemoryUsage?: boolean;
  checkpointing?: CheckpointingSettings;
  folderTrust?: boolean;

  // Git-aware file filtering settings
  fileFiltering?: {
    respectGitIgnore?: boolean;
    enableRecursiveFileSearch?: boolean;
  };
}

export interface SettingsError {
  message: string;
  path: string;
}

export interface CheckpointingSettings {
  enabled?: boolean;
}

/**
 * Loads settings from user and workspace directories.
 * Project settings override user settings.
 *
 * How is it different to gemini-cli/cli: Returns already merged settings rather
 * than `LoadedSettings` (unnecessary since we are not modifying users
 * settings.json).
 */
export function loadSettings(workspaceDir: string): Settings {
  let userSettings: Settings = {};
  let workspaceSettings: Settings = {};
  const settingsErrors: SettingsError[] = [];

  // Load user settings
  const userSettingsPath = getUserSettingsPath();
  try {
    if (fs.existsSync(userSettingsPath)) {
      const userContent = fs.readFileSync(userSettingsPath, 'utf-8');
      const parsedUserSettings = JSON.parse(
        stripJsonComments(userContent),
      ) as Settings;
      userSettings = resolveEnvVarsInObject(parsedUserSettings);
    }
  } catch (error: unknown) {
    settingsErrors.push({
      message: getErrorMessage(error),
      path: userSettingsPath,
    });
  }

  const workspaceSettingsPath = path.join(
    workspaceDir,
    SETTINGS_DIRECTORY_NAME,
    'settings.json',
  );

  // Load workspace settings
  try {
    if (fs.existsSync(workspaceSettingsPath)) {
      const projectContent = fs.readFileSync(workspaceSettingsPath, 'utf-8');
      const parsedWorkspaceSettings = JSON.parse(
        stripJsonComments(projectContent),
      ) as Settings;
      workspaceSettings = resolveEnvVarsInObject(parsedWorkspaceSettings);
    }
  } catch (error: unknown) {
    settingsErrors.push({
      message: getErrorMessage(error),
      path: workspaceSettingsPath,
    });
  }

  if (settingsErrors.length > 0) {
    debugLogger.error('Errors loading settings:');
    for (const error of settingsErrors) {
      debugLogger.error(`  Path: ${error.path}`);
      debugLogger.error(`  Message: ${error.message}`);
    }
  }

  // Merge settings: workspace settings override user settings for all keys
  // EXCEPT `folderTrust`, which is a security-sensitive setting that must be
  // derived from user-owned settings only. A workspace cannot self-elevate
  // folder trust by setting it in its own settings.json. However, a workspace
  // CAN RESTRICT trust (set folderTrust:false) — it just cannot ELEVATE it
  // (set folderTrust:true when the user has not).
  const { folderTrust: _workspaceFolderTrust, ...workspaceNonTrust } =
    workspaceSettings;

  const effectiveFolderTrust = resolveFolderTrust(
    userSettings.folderTrust,
    workspaceSettings.folderTrust,
  );

  return {
    ...userSettings,
    ...workspaceNonTrust,
    ...(effectiveFolderTrust !== undefined
      ? { folderTrust: effectiveFolderTrust }
      : {}),
  };
}

/**
 * Derive the effective folderTrust from user and workspace values.
 *
 * A workspace can RESTRICT trust (set false) but cannot ELEVATE trust
 * (set true when the user has not).
 * - If the user explicitly trusts (true), the workspace may restrict (false).
 * - If the user does not explicitly trust, the workspace can only restrict
 *   further (false); it cannot self-elevate to true.
 */
function resolveFolderTrust(
  userFolderTrust: boolean | undefined,
  workspaceFolderTrust: boolean | undefined,
): boolean | undefined {
  // Workspace can always restrict (false). It can never elevate to true.
  if (workspaceFolderTrust === false) {
    return false;
  }
  // Workspace did not restrict; effective trust is whatever the user set.
  return userFolderTrust;
}

function resolveEnvVarsInString(value: string): string {
  // Static regex pattern for $VAR or ${VAR} syntax - no user-controlled dynamic parts
  const envVarRegex = /\$(?:(\w+)|{([^}]+)})/g;
  return value.replace(envVarRegex, (match, varName1, varName2) => {
    // Regex guarantees exactly one of varName1/varName2 is defined based on $VAR vs ${VAR} syntax
    const varName = varName1 ?? varName2;
    if (typeof process.env[varName] === 'string') {
      return process.env[varName];
    }
    return match;
  });
}

function resolveEnvVarsInObject<T>(obj: T): T {
  if (
    obj === null ||
    obj === undefined ||
    typeof obj === 'boolean' ||
    typeof obj === 'number'
  ) {
    return obj;
  }

  if (typeof obj === 'string') {
    return resolveEnvVarsInString(obj) as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvVarsInObject(item)) as unknown as T;
  }

  if (typeof obj === 'object') {
    const newObj = { ...obj } as T;
    for (const key in newObj) {
      if (Object.prototype.hasOwnProperty.call(newObj, key)) {
        newObj[key] = resolveEnvVarsInObject(newObj[key]);
      }
    }
    return newObj;
  }

  return obj;
}
