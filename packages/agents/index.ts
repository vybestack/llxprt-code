/**
 * @plan:PLAN-20260610-ISSUE1592.P02
 * @requirement:REQ-PKG-001
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export * from './src/index.js';

export {
  assembleProviderSwitch,
  assembleAgentActivationBootstrap,
} from './src/api/providerSwitchAssembly.js';

export {
  captureAgentPreflightHostInput,
  requestAgentPreflightOAuth,
  openAgentPreflightBrowser,
  type AgentPreflightData,
  type AgentPreflightHostInput,
  type AgentPreflightOAuthRequest,
  type AgentPreflightOAuthHost,
  type AgentPreflightBrowserHost,
} from './src/api/preflight-host-input.js';

export {
  assembleProfileApplication,
  type AgentProfileApplication,
} from './src/api/profileApplicationAssembly.js';

export { McpRuntimeOwner } from './src/api/mcpRuntimeAssembly.js';

export {
  assembleProfileDefinitions,
  type AgentProfileDefinitions,
} from './src/api/profileDefinitions.js';

export {
  NO_ACTIVE_PROVIDER_ERROR_MESSAGE,
  SessionProviderReads,
  type SessionProviderStatus,
} from './src/api/session-provider-reads.js';

export {
  prepareAgentPreflight,
  AgentProfilePreflight,
  type AgentPostConfigSettings,
} from './src/api/profile-preflight.js';

export {
  switchActiveProvider,
  DEFAULT_PRESERVE_EPHEMERALS,
} from './src/api/provider-switch/provider-switch.js';
