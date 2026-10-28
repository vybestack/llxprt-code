import type { ApprovalMode } from '@vybestack/llxprt-code-policy';
/**
 * @plan:PLAN-20260622-COREAPIGAP.P06
 * @requirement:REQ-002
 */

import type { AgentPolicyControl, PolicyRuleView } from '../agent.js';
import type {
  PolicyDecision,
  WorkspacePolicyOperations,
} from '@vybestack/llxprt-code-core';

/**
 * @plan:PLAN-20260622-COREAPIGAP.P06
 * @requirement:REQ-002
 */
export class PolicyControl implements AgentPolicyControl {
  constructor(private readonly inspection: WorkspacePolicyOperations) {}

  async reloadUserRules(mode: ApprovalMode): Promise<void> {
    await this.inspection.reloadUserRules(mode);
  }

  /** @requirement:REQ-002 @pseudocode lines 1-18 */
  getRules(): readonly PolicyRuleView[] {
    const engine = this.inspection;
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
    return this.inspection.getDefaultDecision();
  }

  /** @requirement:REQ-002 @pseudocode lines 40-43 */
  isNonInteractive(): boolean {
    return this.inspection.isNonInteractive();
  }
}
