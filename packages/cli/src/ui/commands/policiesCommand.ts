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
  if (priority >= 2.0) {
    return 'Tier 2 (User-defined)';
  } else if (priority >= 1.0) {
    return 'Tier 1 (Defaults)';
  }
  return 'Tier 0 (System)';
}

interface PolicyRuleDisplay {
  priority?: number;
  toolName?: string;
  decision: PolicyDecision;
  argsPatternSource?: string;
  source?: string;
}

function toPolicyRuleDisplay(
  rule: {
    priority?: number;
    toolName?: string;
    decision: PolicyDecision;
    source?: string;
  },
  extractPattern: (r: typeof rule) => string | undefined,
): PolicyRuleDisplay {
  return {
    priority: rule.priority,
    toolName: rule.toolName,
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

  const lines: string[] = ['Active Policy Rules:', ''];

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
      const argsPattern = rule.argsPatternSource
        ? ` (pattern: ${rule.argsPatternSource})`
        : '';
      const source = rule.source ? ` [Source: ${rule.source}]` : '';

      lines.push(
        `  Priority ${priority.toFixed(3)}: ${toolName} → ${decision}${argsPattern}${source}`,
      );
    }

    lines.push('');
  }

  lines.push(`Default Decision: ${formatDecision(defaultDecision)}`);
  lines.push(
    `Non-Interactive Mode: ${nonInteractive ? 'true (ASK_USER → DENY)' : 'false'}`,
  );

  return {
    type: 'message',
    messageType: 'info',
    content: lines.join('\n'),
  };
}

function handlePoliciesCommand(
  context: CommandContext,
  _args: string,
): MessageActionReturn {
  const agent = context.services.agent;

  if (agent) {
    const rules: PolicyRuleDisplay[] = agent.policy
      .getRules()
      .map((r) => toPolicyRuleDisplay(r, (rule) => rule.argsPattern));
    return formatPolicyOutput(
      rules,
      agent.policy.getDefaultDecision(),
      agent.policy.isNonInteractive(),
    );
  }

  // Fallback: Config path (tracked migration debt for null agent)
  const config = context.services.config;
  if (!config) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Configuration not available',
    };
  }

  const policyEngine = config.getPolicyEngine();
  const rules: PolicyRuleDisplay[] = policyEngine
    .getRules()
    .map((r) => toPolicyRuleDisplay(r, (rule) => rule.argsPattern?.source));
  return formatPolicyOutput(
    rules,
    policyEngine.getDefaultDecision(),
    policyEngine.isNonInteractive(),
  );
}

export const policiesCommand: SlashCommand = {
  name: 'policies',
  description: 'display active policy rules and their priorities',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: (context: CommandContext, args: string): MessageActionReturn | void =>
    handlePoliciesCommand(context, args),
};
