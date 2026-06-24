/**
 * @plan:PLAN-20260622-COREAPIGAP.P06
 * @requirement:REQ-002
 */

import type { AgentPolicyControl, PolicyRuleView } from '../agent.js';
import { type PolicyEngine, type PolicyDecision } from '@vybestack/llxprt-code-core';

/**
 * @plan:PLAN-20260622-COREAPIGAP.P06
 * @requirement:REQ-002
 */
export interface PolicyControlDeps {
  readonly getEngine: () => PolicyEngine;
}

/**
 * @plan:PLAN-20260622-COREAPIGAP.P06
 * @requirement:REQ-002
 */
export class PolicyControl implements AgentPolicyControl {
  constructor(private readonly deps: PolicyControlDeps) {}

  /** @requirement:REQ-002 @pseudocode lines 1-18 */
  getRules(): readonly PolicyRuleView[] {
    const engine = this.deps.getEngine();
    const rules = engine.getRules();
    const out: PolicyRuleView[] = [];
    for (const rule of rules) {
      out.push({
        priority: rule.priority,
        toolName: rule.toolName,
        decision: rule.decision,
        ...(rule.argsPattern !== undefined
          ? { argsPattern: rule.argsPattern.source }
          : {}),
        ...(rule.source !== undefined ? { source: rule.source } : {}),
      });
    }
    return out;
  }

  /** @requirement:REQ-002 @pseudocode lines 30-33 */
  getDefaultDecision(): PolicyDecision {
    return this.deps.getEngine().getDefaultDecision();
  }

  /** @requirement:REQ-002 @pseudocode lines 40-43 */
  isNonInteractive(): boolean {
    return this.deps.getEngine().isNonInteractive();
  }
}
