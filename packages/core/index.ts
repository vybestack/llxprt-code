/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export * from './src/index.js';
export type { HistoryService } from './src/services/history/HistoryService.js';
export {
  PLACEHOLDER_MODEL,
  UNCONFIGURED_PROVIDER,
} from './src/config/models.js';
export {
  isBrowserLaunchDisabledDuringTests,
  openBrowserSecurely,
  shouldLaunchBrowser,
} from './src/utils/secure-browser-launcher.js';
export {
  IDE_DEFINITIONS,
  detectIdeFromEnv,
} from '@vybestack/llxprt-code-ide-integration';

// IDE connection telemetry exports removed - telemetry disabled in llxprt
export {
  IdeConnectionEvent,
  IdeConnectionType,
} from './src/telemetry/types.js';
export { getIdeTrust } from './src/utils/ide-trust.js';
export * from './src/utils/pathReader.js';
export { createSessionSchedulerRegistry } from './src/session/sessionSchedulerRegistryImpl.js';
export { WorkspaceFilesystemOwner } from './src/services/workspace-filesystem-owner.js';
export type {
  WorkspaceIgnoreOperations,
  WorkspaceSearchOperations,
} from './src/services/workspace-filesystem-owner.js';

export type { RuntimePolicyOwner } from './src/policy/policy-owner.js';
export type { WorkspaceSkillOperations } from './src/skills/workspace-skill-owner.js';
export { parseOutputLimits } from './src/utils/toolOutputLimiter.js';
export {
  WorkspaceMcpCatalogOwner,
  type WorkspacePromptSelection,
  type WorkspaceResourceSelection,
} from './src/services/workspace-mcp-catalog-owner.js';
export { WorkspaceToolCatalogOwner } from './src/services/workspace-tool-catalog-owner.js';
export { ToolDispatchAdmission } from './src/services/tool-dispatch-admission.js';
export { SessionSettingsOwner } from './src/session/session-settings-owner.js';
