/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  Config,
  type ConfigParameters,
  type RedactionConfig,
  ApprovalMode,
  type AccessibilitySettings,
  type BugCommandSettings,
  type ChatCompressionSettings,
  type SummarizeToolOutputSettings,
  type ComplexityAnalyzerSettings,
  type TelemetrySettings,
  MCPServerConfig,
  AuthProviderType,
  type SandboxConfig,
  type ActiveExtension,
  type GeminiCLIExtension,
  type FileFilteringOptions,
  DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
  DEFAULT_FILE_FILTERING_OPTIONS,
  type MCPOAuthConfig,
  DEFAULT_GEMINI_FLASH_MODEL,
} from './config.js';

export type { Config as ConfigInstance } from './config.js';

export { DEFAULT_GEMINI_FLASH_MODEL as DEFAULT_FLASH_MODEL } from './models.js';

/**
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P15
 * @requirement:REQ-010
 */
export { SubagentManager } from './subagentManager.js';
export type { SubagentConfig } from './types.js';
