/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { PolicyEngine } from '@vybestack/llxprt-code-policy';
import type { PolicyDecisionPort } from '@vybestack/llxprt-code-policy/confirmation-bus/message-bus.js';

export interface OwnerPolicyEvaluation extends PolicyDecisionPort {
  bindPolicyEvaluation(evaluate: PolicyDecisionPort['evaluate']): void;
}

export function createOwnerPolicyEvaluation(): OwnerPolicyEvaluation {
  const defaultPolicy = new PolicyEngine();
  let evaluate: PolicyDecisionPort['evaluate'] = (name, args, server) =>
    defaultPolicy.evaluate(name, args, server);
  return {
    evaluate: (name, args, server) => evaluate(name, args, server),
    bindPolicyEvaluation: (next) => {
      evaluate = next;
    },
  };
}
