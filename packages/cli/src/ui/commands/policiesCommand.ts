/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CommandKind,
  type MessageActionReturn,
  type OpenDialogActionReturn,
  type SlashCommand,
} from './types.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core';

function formatDecision(decision: PolicyDecision): string {
  switch (decision) {
    case PolicyDecision.ALLOW:
      return 'ALLOW';
    case PolicyDecision.DENY:
      return 'DENY';
    case PolicyDecision.ASK_USER:
      return 'ASK_USER';
    default:
      return String(decision);
  }
}

function getTierBand(priority: number): string {
  if (priority >= 3.0) {
    return 'Tier 3 (System / Admin)';
  } else if (priority >= 2.0) {
    return 'Tier 2 (User-defined)';
  } else if (priority >= 1.0) {
    return 'Tier 1 (Defaults)';
  }
  return 'Tier 0 (Base)';
}

export interface PolicyRuleDisplay {
  priority?: number;
  toolName?: string;
  toolNamePrefix?: string;
  decision: PolicyDecision;
  argsPatternSource?: string;
  source?: string;
}

export interface PolicyRuleBase {
  priority?: number;
  toolName?: string;
  toolNamePrefix?: string;
  decision: PolicyDecision;
  source?: string;
}

export function toPolicyRuleDisplay<T extends PolicyRuleBase>(
  rule: T,
  extractPattern: (r: T) => string | undefined,
): PolicyRuleDisplay {
  return {
    priority: rule.priority,
    toolName: rule.toolName,
    toolNamePrefix: rule.toolNamePrefix,
    decision: rule.decision,
    argsPatternSource: extractPattern(rule),
    source: rule.source,
  };
}

function formatPolicyOutput(
  rules: readonly PolicyRuleDisplay[],
  defaultDecision: PolicyDecision,
  nonInteractive: boolean,
): MessageActionReturn {
  if (rules.length === 0) {
    return {
      type: 'message',
      messageType: 'info',
      content: 'No policy rules configured.',
    };
  }

  const sortedRules = [...rules].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );

  const lines: string[] = ['Configured Policy Rules:', ''];

  const tierBands = new Map<string, typeof sortedRules>();

  for (const rule of sortedRules) {
    const priority = rule.priority ?? 0;
    const tier = getTierBand(priority);
    if (!tierBands.has(tier)) {
      tierBands.set(tier, []);
    }
    tierBands.get(tier)!.push(rule);
  }

  const tierOrder = [
    'Tier 3 (System / Admin)',
    'Tier 2 (User-defined)',
    'Tier 1 (Defaults)',
    'Tier 0 (Base)',
  ];

  for (const tier of tierOrder) {
    const tierRules = tierBands.get(tier);
    if (!tierRules || tierRules.length === 0) {
      continue;
    }

    lines.push(`${tier}:`);

    for (const rule of tierRules) {
      const toolName =
        rule.toolName ??
        (rule.toolNamePrefix !== undefined ? `${rule.toolNamePrefix}*` : '*');
      const decision = formatDecision(rule.decision);
      const priority = rule.priority ?? 0;
      const argsPattern = rule.argsPatternSource
        ? ` (pattern: ${rule.argsPatternSource})`
        : '';
      const source = rule.source ? ` [Source: ${rule.source}]` : '';

      lines.push(
        `  Priority ${priority.toFixed(3)}: ${toolName} \u2192 ${decision}${argsPattern}${source}`,
      );
    }

    lines.push('');
  }

  lines.push(`Default Decision: ${formatDecision(defaultDecision)}`);
  lines.push(
    `Non-Interactive Mode: ${nonInteractive ? 'true (ASK_USER \u2192 DENY)' : 'false'}`,
  );

  return {
    type: 'message',
    messageType: 'info',
    content: lines.join('\n'),
  };
}

export interface PolicyInfo {
  rules: PolicyRuleDisplay[];
  defaultDecision: PolicyDecision;
  nonInteractive: boolean;
}

export interface PoliciesCommandOperations {
  readonly getPolicyInfo: () => PolicyInfo | null;
}

/**
 * /policies list — renders a read-only tier-grouped table of all active rules.
 */
function listAction(
  operations: PoliciesCommandOperations,
): MessageActionReturn {
  const info = operations.getPolicyInfo();
  if (!info) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Configuration not available',
    };
  }

  return formatPolicyOutput(
    info.rules,
    info.defaultDecision,
    info.nonInteractive,
  );
}

/**
 * /policies menu — opens the interactive policy manager dialog.
 */
function menuAction(
  operations: PoliciesCommandOperations,
): OpenDialogActionReturn | MessageActionReturn {
  const info = operations.getPolicyInfo();
  if (!info) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Configuration not available',
    };
  }
  return {
    type: 'dialog',
    dialog: 'policies',
  };
}

export function createPoliciesCommand(
  operations: PoliciesCommandOperations,
): SlashCommand {
  const listCommand: SlashCommand = {
    name: 'list',
    description: 'display all policy rules in a read-only tier-grouped table',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: (): MessageActionReturn => listAction(operations),
  };

  const menuCommand: SlashCommand = {
    name: 'menu',
    description: 'open the interactive policy manager dialog',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: (): OpenDialogActionReturn | MessageActionReturn =>
      menuAction(operations),
  };

  return {
    name: 'policies',
    description: 'inspect and manage policy rules (list or interactive menu)',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    subCommands: [listCommand, menuCommand],
    action: (
      _invocation,
      args: string,
    ): MessageActionReturn | OpenDialogActionReturn => {
      const trimmed = args.trim();
      if (trimmed === 'menu') {
        return menuAction(operations);
      }
      return listAction(operations);
    },
  };
}
