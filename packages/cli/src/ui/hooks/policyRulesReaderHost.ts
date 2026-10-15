/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  listEditableRules,
  type ApprovalMode,
  type EditablePolicyRule,
} from '@vybestack/llxprt-code-core';
import type { AgentPolicyControl } from '@vybestack/llxprt-code-agents';

export type PolicyRulesReader = () => Promise<{
  rules: EditablePolicyRule[];
  engineRules: ReturnType<AgentPolicyControl['getRules']>;
}>;

export function bindPolicyRulesReader(
  policy: Pick<AgentPolicyControl, 'reloadUserRules' | 'getRules'>,
  readApprovalMode: () => ApprovalMode,
): PolicyRulesReader {
  return async () => {
    const rules = await listEditableRules();
    await policy.reloadUserRules(readApprovalMode());
    return { rules, engineRules: policy.getRules() };
  };
}
