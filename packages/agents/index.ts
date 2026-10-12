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
  assembleProfileApplication,
  type AgentProfileApplication,
} from './src/api/profileApplicationAssembly.js';

export { McpRuntimeOwner } from './src/api/mcpRuntimeAssembly.js';
