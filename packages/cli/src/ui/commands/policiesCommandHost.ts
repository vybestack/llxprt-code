/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { PolicyRuleView } from '@vybestack/llxprt-code-agents';
import type { PolicyDecision } from '@vybestack/llxprt-code-core';
import {
  toPolicyRuleDisplay,
  type PolicyInfo,
  type PoliciesCommandOperations,
} from './policiesCommand.js';

export function bindPoliciesCommand(
  readRules: () => readonly PolicyRuleView[] | null,
  readDefaultDecision: () => PolicyDecision,
  readNonInteractive: () => boolean,
): PoliciesCommandOperations {
  return {
    getPolicyInfo: (): PolicyInfo | null => {
      const rules = readRules();
      if (rules === null) return null;
      return {
        rules: rules.map((rule) =>
          toPolicyRuleDisplay(rule, (entry) => entry.argsPattern),
        ),
        defaultDecision: readDefaultDecision(),
        nonInteractive: readNonInteractive(),
      };
    },
  };
}
