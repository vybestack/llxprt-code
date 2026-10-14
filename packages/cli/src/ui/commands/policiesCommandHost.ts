/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  toPolicyRuleDisplay,
  type PolicyInfo,
  type PoliciesCommandOperations,
} from './policiesCommand.js';

export function bindPoliciesCommand(
  getAgent: () => Agent | null,
): PoliciesCommandOperations {
  return {
    getPolicyInfo: (): PolicyInfo | null => {
      const agent = getAgent();
      if (agent === null) return null;
      return {
        rules: agent.policy
          .getRules()
          .map((rule) =>
            toPolicyRuleDisplay(rule, (entry) => entry.argsPattern),
          ),
        defaultDecision: agent.policy.getDefaultDecision(),
        nonInteractive: agent.policy.isNonInteractive(),
      };
    },
  };
}
