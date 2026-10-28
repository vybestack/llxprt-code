/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionPolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { createMcpApprovalPolicy } from '@vybestack/llxprt-code-core/policy/mcp-approval.js';
import { persistPolicyToToml } from '@vybestack/llxprt-code-core/policy/config.js';
import { PolicyDecision } from '@vybestack/llxprt-code-policy';
import type { McpApprovalPolicy } from '@vybestack/llxprt-code-mcp/host/hostInterfaces.js';

export class SessionMcpApproval {
  private readonly writes = new Set<Promise<void>>();

  bind(
    policy: SessionPolicyOwner,
    upstream: SessionPolicyOwner['decisions']['evaluate'],
    assertActive: () => void,
  ): McpApprovalPolicy {
    const approval = createMcpApprovalPolicy(
      { ...policy.decisions, ...policy.confirmation },
      (message) => {
        const write = persistPolicyToToml(message);
        this.writes.add(write);
        void write.then(
          () => this.writes.delete(write),
          () => this.writes.delete(write),
        );
        return write;
      },
      assertActive,
    );
    return {
      ...approval,
      evaluate: (...args) => {
        const decision = upstream(
          args[0].serverName + '__' + args[0].toolName,
          args[1],
          args[0].serverName,
        );
        return decision === PolicyDecision.DENY
          ? decision
          : approval.evaluate(...args);
      },
    };
  }

  settleWrites(): Promise<Array<PromiseSettledResult<void>>> {
    return Promise.allSettled([...this.writes]);
  }
}
