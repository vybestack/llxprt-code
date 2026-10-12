/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SessionPolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { createMcpApprovalPolicy } from '@vybestack/llxprt-code-core/policy/mcp-approval.js';
import { persistPolicyToToml } from '@vybestack/llxprt-code-core/policy/config.js';
import { PolicyDecision } from '@vybestack/llxprt-code-policy';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';

interface SessionMcpApprovalInput {
  readonly policy: SessionPolicyOwner;
  /** The workspace-level session policy, whose DENY decisions outrank this session's approvals. */
  readonly upstream: Pick<SessionPolicyOwner, 'decisions'>;
  /** Tracks in-flight policy writes so session disposal can await them. */
  readonly writes: Set<Promise<void>>;
  readonly getClient: () => AgentClientContract;
}

/** MCP approval policy for one session: persists rules, and defers to an upstream DENY. */
export function createSessionMcpApproval(input: SessionMcpApprovalInput) {
  const { policy, upstream, writes, getClient } = input;
  const approval = createMcpApprovalPolicy(
    { ...policy.decisions, ...policy.confirmation },
    (message) => {
      const write = persistPolicyToToml(message);
      writes.add(write);
      void write.then(
        () => writes.delete(write),
        () => writes.delete(write),
      );
      return write;
    },
    getClient,
  );
  return {
    ...approval,
    evaluate: (...args: Parameters<typeof approval.evaluate>) => {
      const upstreamDecision = upstream.decisions.evaluate(
        args[0].serverName + '__' + args[0].toolName,
        args[1],
        args[0].serverName,
      );
      return upstreamDecision === PolicyDecision.DENY
        ? upstreamDecision
        : approval.evaluate(...args);
    },
  };
}
