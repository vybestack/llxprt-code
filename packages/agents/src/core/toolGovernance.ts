/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const SCOPE_LOCAL_EMIT_TOOL_NAME = 'self_emitvalue';

export {
  buildSubagentExcludedToolNames,
  buildToolGovernance,
  canonicalizeToolName,
  getToolNameCandidates,
  INVALID_TOOL_NAME,
  isSubagentExcludedToolName,
  isToolBlocked,
  SUBAGENT_EXCLUDED_TOOL_NAMES,
  type ToolGovernance,
  type ToolGovernanceConfig,
} from '@vybestack/llxprt-code-tools';
