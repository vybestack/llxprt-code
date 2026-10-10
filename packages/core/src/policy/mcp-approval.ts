/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpApprovalPolicy } from '@vybestack/llxprt-code-mcp/host/hostInterfaces.js';
import {
  MessageBusType,
  PolicyDecision,
  type PolicyEngine,
  type UpdatePolicy,
} from '@vybestack/llxprt-code-policy';

export const MCP_SESSION_APPROVAL_SOURCE = 'MCP Session Approval';

export function createMcpApprovalPolicy(
  engine: Pick<PolicyEngine, 'evaluate' | 'addRule'>,
  save: (message: UpdatePolicy) => Promise<void>,
  assertActive: () => void,
): McpApprovalPolicy {
  return {
    evaluate(target, args) {
      assertActive();
      return engine.evaluate(
        `${target.serverName}__${target.toolName}`,
        args,
        target.serverName,
      );
    },
    async approve(target, approval) {
      assertActive();
      const toolName = `${target.serverName}__${target.toolName}`;
      engine.addRule({
        ...(approval === 'server-session'
          ? { toolNamePrefix: `${target.serverName}__` }
          : { toolName }),
        decision: PolicyDecision.ALLOW,
        priority: 2.95,
        source: MCP_SESSION_APPROVAL_SOURCE,
      });
      if (approval === 'tool-saved') {
        await save({
          type: MessageBusType.UPDATE_POLICY,
          toolName,
          mcpName: target.serverName,
          persist: true,
        });
      }
    },
  };
}
