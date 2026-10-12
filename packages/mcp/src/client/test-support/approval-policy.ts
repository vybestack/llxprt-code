/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { McpApprovalPolicy } from '../../host/hostInterfaces.js';

export function unsupportedApprovalPolicy(): McpApprovalPolicy {
  return {
    evaluate: () => 'ask_user',
    approve: async () => {
      throw new Error('Reusable MCP approval is unsupported by this host');
    },
  };
}
