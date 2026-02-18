/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CommandKind,
  type CommandContext,
  type MessageActionReturn,
  type SlashCommand,
} from './types.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core';

/**
 * Formats a PolicyDecision enum value for display
 */
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

/**
 * Categorizes a priority into a tier band
 */
function getTierBand(priority: number): string {
  if (priority >= 2.0) {
    return 'Tier 2 (User-defined)';
  } else if (priority >= 1.0) {
    return 'Tier 1 (Defaults)';
  } else {
    return 'Tier 0 (System)';
  }
}

/**
 * Handle /policies command - displays active policy rules
 */
function handlePoliciesCommand(
  context: CommandContext,
  _args: string,
): MessageActionReturn {
  const config = context.services.config;

  if (!config) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Configuration not available',
    };
  }

  const policyEngine = config.getPolicyEngine();
  const rules = policyEngine.getRules();

  if (rules.length === 0) {
    return {
      type: 'message',
      messageType: 'info',
      content: 'No policy rules configured.',
    };
  }

  // Sort by priority (highest first)
  const sortedRules = [...rules].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );

  const lines: string[] = ['Active Policy Rules:', ''];

  // Group rules by tier
  const tierBands = new Map<string, typeof sortedRules>();

  for (const rule of sortedRules) {
    const priority = rule.priority ?? 0;
    const tier = getTierBand(priority);

    if (!tierBands.has(tier)) {
      tierBands.set(tier, []);
    }
    tierBands.get(tier)!.push(rule);
  }

  // Display rules grouped by tier
  const tierOrder = [
    'Tier 2 (User-defined)',
    'Tier 1 (Defaults)',
    'Tier 0 (System)',
  ];

  for (const tier of tierOrder) {
    const tierRules = tierBands.get(tier);
    if (!tierRules || tierRules.length === 0) {
      continue;
    }

    lines.push(`${tier}:`);

    for (const rule of tierRules) {
      const toolName = rule.toolName ?? '*';
      const decision = formatDecision(rule.decision);
      const priority = rule.priority ?? 0;
      const argsPattern = rule.argsPattern
        ? ` (pattern: ${rule.argsPattern.source})`
        : '';

      lines.push(
        `  Priority ${priority.toFixed(3)}: ${toolName} → ${decision}${argsPattern}`,
      );
    }

    lines.push('');
  }

  // Display default decision and mode
  lines.push(
    `Default Decision: ${formatDecision(policyEngine.getDefaultDecision())}`,
  );
  lines.push(
    `Non-Interactive Mode: ${policyEngine.isNonInteractive() ? 'true (ASK_USER → DENY)' : 'false'}`,
  );

  return {
    type: 'message',
    messageType: 'info',
    content: lines.join('\n'),
  };
}

/**
 * Policies command definition
 */
export const policiesCommand: SlashCommand = {
  name: 'policies',
  description: 'display active policy rules and their priorities',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: (context: CommandContext, args: string): MessageActionReturn | void =>
    handlePoliciesCommand(context, args),
};
