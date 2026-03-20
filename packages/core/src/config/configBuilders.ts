/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure builder functions extracted from Config constructor.
 * These are stateless functions that compute default values and normalize inputs.
 * No side effects, no service creation, no global mutation.
 */

import type { ShellReplacementMode, TelemetrySettings } from './configTypes.js';
import { DEFAULT_FILE_FILTERING_OPTIONS } from './constants.js';
import {
  DEFAULT_TELEMETRY_TARGET,
  DEFAULT_OTLP_ENDPOINT,
} from '../telemetry/index.js';

/**
 * Internal data shape for file filtering settings.
 * This is the constructor's resolved shape, not the DI interface.
 */
export interface FileFilteringState {
  respectGitIgnore: boolean;
  respectLlxprtIgnore: boolean;
  enableRecursiveFileSearch: boolean;
  disableFuzzySearch: boolean;
}

/**
 * Build fully-resolved telemetry settings from partial input.
 */
export function buildTelemetrySettings(
  params?: Partial<TelemetrySettings>,
): TelemetrySettings {
  return {
    enabled: params?.enabled ?? false,
    target: params?.target ?? DEFAULT_TELEMETRY_TARGET,
    otlpEndpoint: params?.otlpEndpoint ?? DEFAULT_OTLP_ENDPOINT,
    logPrompts: params?.logPrompts ?? true,
    outfile: params?.outfile,
    logConversations: params?.logConversations ?? false,
    logResponses: params?.logResponses ?? false,
    redactSensitiveData: params?.redactSensitiveData ?? true,
    redactFilePaths: params?.redactFilePaths ?? false,
    redactUrls: params?.redactUrls ?? false,
    redactEmails: params?.redactEmails ?? false,
    redactPersonalInfo: params?.redactPersonalInfo ?? false,
  };
}

/**
 * Normalize file filtering settings from partial input to full resolved shape.
 */
export function normalizeFileFilteringSettings(params?: {
  respectGitIgnore?: boolean;
  respectLlxprtIgnore?: boolean;
  enableRecursiveFileSearch?: boolean;
  disableFuzzySearch?: boolean;
}): FileFilteringState {
  return {
    respectGitIgnore:
      params?.respectGitIgnore ??
      DEFAULT_FILE_FILTERING_OPTIONS.respectGitIgnore,
    respectLlxprtIgnore:
      params?.respectLlxprtIgnore ??
      DEFAULT_FILE_FILTERING_OPTIONS.respectLlxprtIgnore,
    enableRecursiveFileSearch: params?.enableRecursiveFileSearch ?? true,
    disableFuzzySearch: params?.disableFuzzySearch ?? false,
  };
}

/**
 * Parse LSP config from the ConfigParameters input.
 * Handles boolean/object/undefined input normalization.
 *
 * @plan PLAN-20250212-LSP.P33
 * @requirement REQ-CFG-010, REQ-CFG-015, REQ-CFG-020
 */
export function parseLspConfig(
  lsp: import('../lsp/types.js').LspConfig | boolean | undefined,
): import('../lsp/types.js').LspConfig | undefined {
  if (lsp === false || lsp === undefined) {
    // Explicitly disabled or absent (absent = not configured)
    return undefined;
  }
  if (lsp === true) {
    // Boolean true = default enabled (REQ-CFG-015)
    return { servers: [] };
  }
  // Object presence = enabled (REQ-CFG-020), ensure servers field exists
  return lsp.servers === undefined ? { ...lsp, servers: [] } : lsp;
}

/**
 * Normalize shell-replacement setting to canonical mode.
 * Handles legacy boolean values for backward compatibility.
 */
export function normalizeShellReplacement(
  value: ShellReplacementMode | boolean | undefined,
): ShellReplacementMode {
  if (value === undefined) {
    return 'allowlist'; // Default to upstream behavior
  }
  if (value === true || value === 'all') {
    return 'all';
  }
  if (value === false || value === 'none') {
    return 'none';
  }
  if (value === 'allowlist') {
    return 'allowlist';
  }
  // Fallback for any unexpected value
  return 'allowlist';
}
