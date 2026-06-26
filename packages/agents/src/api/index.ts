/**
 * @plan:PLAN-20260617-COREAPI.P06
 * @requirement:REQ-001, REQ-017
 * @plan:PLAN-20260621-COREAPIREMED.P06
 * @plan:PLAN-20260621-COREAPIREMED.P16
 * @requirement:REQ-004
 * @pseudocode lines 10-15
 */

export * from './config-types.js';
export * from './event-types.js';
export * from './agent.js';
export * from './config-schema.js';
export * from './event-schema.js';
export { createAgent } from './createAgent.js';
export { fromConfig } from './fromConfig.js';
export { listProviders, listTools } from './discovery.js';
export { mapLoopStream, mapStreamEvent } from './eventAdapter.js';
export { toConfigParameters, AdapterError } from './agentConfig.adapter.js';
export type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';

/**
 * @plan:PLAN-20260622-COREAPIGAP.P17
 * @requirement:REQ-008
 * @pseudocode barrel-exports.md lines 1-9
 * @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-004
 */
export { PolicyDecision, ApprovalMode } from '@vybestack/llxprt-code-core';
export type {
  PolicyRuleView,
  AgentTaskInfo,
  HookInfo,
  AuthProviderDetail,
  AuthBucketStatus,
  McpServerAuthStatus,
  McpDetailStatus,
  McpServerDetail,
  McpDetailsOptions,
  McpPromptInfo,
  McpResourceInfo,
  McpBlockedServer,
  McpOAuthStatus, // @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-004
  ToolKeyInfo,
  ToolKeyStatus,
} from './agent.js';
